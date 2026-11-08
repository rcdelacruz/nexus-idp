/**
 * Service for agent management, task delivery (long-poll), and authentication
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { TaskStore } from '../database/TaskStore';
import { TaskQueueService } from './TaskQueueService';
import {
  AgentRegistration,
  AgentAuthResponse,
  AgentRegisterRequest,
  ProvisioningTask,
  AgentCapabilities,
} from '../types';
import { extractEmailFromEntityRef as sharedExtractEmail, sameUser } from '../util/identity';
import { heardRecently } from './agentLiveness';

/** How long confirmAlive() waits for a woken agent to poll again before calling it gone. */
const CONFIRM_TIMEOUT_MS = 8_000;
/** A re-poll later than this after an answer is worth a log line (tunnel / network health). */
const SLOW_REPOLL_LOG_MS = 5_000;

/**
 * Device code authorization (OAuth 2.0 Device Authorization Grant - RFC 8628)
 */
interface DeviceCodeAuthorization {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  status: 'pending' | 'authorized' | 'denied' | 'expired';
  userEntityRef?: string; // Set when user authorizes
  createdAt: number;
  // Machine info from CLI (stored during device code generation)
  machineInfo?: {
    agentId: string;
    hostname: string;
    platform: string;
    platformVersion: string;
    /** Sent by agents ≥ 0.1.23. */
    agentVersion?: string;
  };
}

/**
 * AgentService manages agent lifecycle, authentication, and SSE connections
 */
/** A parked long-poll request waiting for work to arrive for one agent. */
interface PollWaiter {
  wake: () => void;
}

export class AgentService {
  private deviceCodes: Map<string, DeviceCodeAuthorization> = new Map(); // device_code -> authorization
  private userCodes: Map<string, string> = new Map(); // user_code -> device_code
  // agentIds with a pending "Stop Agent" request, delivered on the agent's next long-poll
  // response. Consumed one-shot by consumeShutdownPending().
  private pendingShutdowns: Set<string> = new Set();
  // agentIds that have actually received a shouldShutdown:true response and haven't polled
  // since. Overrides the last_seen-freshness check so "offline" is instant instead of waiting
  // for last_seen to go stale (~45 s). See isExplicitlyDisconnected().
  private explicitlyDisconnected: Set<string> = new Set();
  // Parked long-poll requests per agentId, woken by notifyAgent() when a task is queued or a
  // shutdown is requested — this is what makes long-polling event-driven rather than a fixed
  // interval: an agent waiting in a poll gets its response the instant work exists, not on its
  // next tick. Replaces SSE entirely (2026-07-26): SSE required one persistent connection held
  // open indefinitely, which Cloudflare's tunnel does not reliably keep alive; long-polling
  // uses many short-lived requests (bounded by POLL_TIMEOUT_MS, well under Cloudflare's ~100s
  // ceiling on how long it holds a connection open waiting for an origin response), so there is
  // no long-lived connection state to silently lose.
  private pollWaiters: Map<string, PollWaiter[]> = new Map();
  // Probes (confirmAlive) waiting for an agent to prove it is alive by parking a poll. Sets of
  // resolvers, not an EventEmitter: one entry per concurrent probe, always removed in settle().
  private aliveProbes: Map<string, Set<(alive: boolean) => void>> = new Map();
  private confirmInFlight: Map<string, Promise<boolean>> = new Map();
  // When each agent's last poll was answered (to log slow re-polls).
  private lastAnsweredAt: Map<string, number> = new Map();
  private readonly POLL_TIMEOUT_MS: number;
  private readonly DEVICE_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
  // Single source of truth for the service-token lifetime — the signed `exp` and the `expiresAt`
  // reported to the agent are both derived from this, so they can't drift apart.
  private readonly SERVICE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private readonly logger: LoggerService,
    private readonly taskStore: TaskStore,
    private readonly taskQueueService: TaskQueueService,
    private readonly config: Config,
    pollTimeoutSeconds: number = 25,
    /** How long confirmAlive() waits for a woken agent to poll again (tests shorten it). */
    private readonly confirmTimeoutMs: number = CONFIRM_TIMEOUT_MS,
  ) {
    this.POLL_TIMEOUT_MS = pollTimeoutSeconds * 1000;
  }

  /**
   * Generate device code for CLI authentication (OAuth 2.0 Device Flow - RFC 8628)
   * Returns device_code (for CLI polling) and user_code (for user to enter in browser)
   */
  async generateDeviceCode(machineInfo?: {
    agentId: string;
    hostname: string;
    platform: string;
    platformVersion: string;
    agentVersion?: string;
  }): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    // Generate random codes
    const deviceCode = this.generateRandomCode(32); // Long, secure code for API
    const userCode = this.generateUserFriendlyCode(); // Short code for user to type (e.g., "ABCD-1234")

    const expiresAt = Date.now() + this.DEVICE_CODE_EXPIRY_MS;

    // Store authorization request with machine info
    const authorization: DeviceCodeAuthorization = {
      deviceCode,
      userCode,
      expiresAt,
      status: 'pending',
      createdAt: Date.now(),
      machineInfo, // Store machine info for later use during token exchange
    };

    this.deviceCodes.set(deviceCode, authorization);
    this.userCodes.set(userCode, deviceCode);

    // Get frontend base URL from config
    // This ensures we return the correct URL for dev (localhost:3000) vs prod (actual domain)
    const appBaseUrl = this.config.getString('app.baseUrl');
    const verificationUri = `${appBaseUrl}/device`;

    this.logger.info('Device code generated', {
      userCode,
      verificationUri,
      expiresIn: this.DEVICE_CODE_EXPIRY_MS / 1000,
      machineInfo: machineInfo ? `${machineInfo.hostname} (${machineInfo.agentId})` : 'none',
    });

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri, // Full frontend URL (e.g., http://localhost:3000/device)
      expires_in: this.DEVICE_CODE_EXPIRY_MS / 1000, // seconds
      interval: 5, // CLI should poll every 5 seconds
    };
  }

  /**
   * Authorize device code (called when user enters code in browser)
   */
  async authorizeDeviceCode(
    userCode: string,
    userEntityRef: string,
  ): Promise<void> {
    const deviceCode = this.userCodes.get(userCode);
    if (!deviceCode) {
      throw new Error('Invalid or expired user code');
    }

    const authorization = this.deviceCodes.get(deviceCode);
    if (!authorization) {
      throw new Error('Invalid device code');
    }

    // Check expiration
    if (Date.now() > authorization.expiresAt) {
      authorization.status = 'expired';
      throw new Error('Device code has expired');
    }

    // Mark as authorized
    authorization.status = 'authorized';
    authorization.userEntityRef = userEntityRef;

    this.logger.info('Device code authorized', {
      userCode,
      userEntityRef,
    });
  }

  /**
   * Poll for device code authorization (called by CLI)
   */
  async pollDeviceCode(
    deviceCode: string,
  ): Promise<(AgentAuthResponse & { reconnected?: boolean }) | null> {
    const authorization = this.deviceCodes.get(deviceCode);
    if (!authorization) {
      throw new Error('Invalid device code');
    }

    // Check expiration
    if (Date.now() > authorization.expiresAt) {
      authorization.status = 'expired';
      this.deviceCodes.delete(deviceCode);
      this.userCodes.delete(authorization.userCode);
      throw new Error('Device code has expired');
    }

    // Check status
    if (authorization.status === 'denied') {
      throw new Error('User denied authorization');
    }

    if (authorization.status === 'pending') {
      // Still waiting for user to authorize
      return null;
    }

    // Authorized! Generate service token
    if (!authorization.userEntityRef) {
      throw new Error('Authorization missing user identity');
    }

    const userEmail = this.extractEmailFromEntityRef(authorization.userEntityRef);

    // Generate service token
    const serviceToken = this.generateServiceToken(userEmail);

    let agentId: string;
    let reconnected = false;

    // If machine info was provided, use machine-based agent ID (upsert)
    if (authorization.machineInfo) {
      const { agentId: machineAgentId, hostname, platform, platformVersion, agentVersion } = authorization.machineInfo;

      const result = await this.taskStore.upsertAgent(
        machineAgentId,
        userEmail,
        hostname,
        platform,
        platformVersion,
        hostname, // machine_name = hostname
        agentVersion ?? '0.1.0', // agents before 0.1.23 don't send it (they are older than that)
      );

      agentId = result.agent.agent_id;
      reconnected = result.reconnected;
      if (result.separatedFromUser) {
        // Another user's agent id was presented at login. The row stays theirs; this user got one of their own.
        this.logger.warn(
          `Login by ${userEmail} presented agent id ${machineAgentId}, which is registered to ${result.separatedFromUser}: registered ${agentId} for ${userEmail} instead of moving the agent`,
        );
      }

      this.logger.info(
        reconnected ? `Reconnected to existing agent: ${agentId}` : `Created new agent: ${agentId}`,
        { userEmail, hostname, platform }
      );
    } else {
      // Fallback: no machine info provided, use old logic
      const agents = await this.taskStore.getAgentsByUser(userEmail);
      if (agents.length > 0) {
        agentId = agents[0].agent_id;
        reconnected = true;
        this.logger.info(`Using existing agent: ${agentId}`, { userEmail });
      } else {
        const agent = await this.taskStore.registerAgent(userEmail);
        agentId = agent.agent_id;
        this.logger.info(`Created new agent: ${agentId}`, { userEmail });
      }
    }

    const expiresAt = Date.now() + this.SERVICE_TOKEN_TTL_SECONDS * 1000;

    // Clean up device code
    this.deviceCodes.delete(deviceCode);
    this.userCodes.delete(authorization.userCode);

    return {
      serviceToken,
      agentId,
      expiresAt,
      reconnected,
    };
  }

  /**
   * Register a new agent
   */
  async registerAgent(
    userId: string,
    request: AgentRegisterRequest,
  ): Promise<AgentRegistration> {
    this.logger.info('Registering new agent', {
      userId,
      machineName: request.machine_name,
      osPlatform: request.os_platform,
      agentVersion: request.agent_version,
    });

    const agent = await this.taskStore.registerAgent(
      userId,
      request.machine_name,
      request.os_platform,
      request.agent_version,
    );

    this.logger.info(`Agent registered: ${agent.agent_id}`, {
      agentId: agent.agent_id,
      userId,
    });

    return agent;
  }

  /**
   * Long-poll for work (tasks + shutdown signal). Holds the request open until either
   * something becomes available (woken by notifyAgent) or POLL_TIMEOUT_MS elapses. Every call
   * — whether it returns immediately, after a wake, or after timing out — proves the agent is
   * alive, so this single call replaces the old separate SSE-connect + heartbeat pair; there is
   * no other liveness signal.
   */
  async longPoll(
    agentId: string,
    userId: string,
    signal?: AbortSignal,
    agentVersion?: string,
    capabilities?: AgentCapabilities,
  ): Promise<{ tasks: ProvisioningTask[]; shouldShutdown: boolean }> {
    const agent = await this.taskStore.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (agent.user_id !== userId) {
      throw new Error(`Agent ${agentId} does not belong to user ${userId}`);
    }

    await this.taskStore.updateAgentLastSeen(agentId, agentVersion, capabilities);
    // The route aborts the signal when the connection closes. A client that vanished while we were
    // in the awaits above has nobody to answer: it must not clear the "connection lost" flag its
    // own close just set, and must not park a waiter nothing will ever read (which would make a
    // probe call a gone agent alive).
    if (signal?.aborted) return { tasks: [], shouldShutdown: false };
    // Any live poll proves the agent is up right now — clears a stale flag from a previous
    // shutdown if this is a freshly-restarted agent reusing the same ID.
    this.explicitlyDisconnected.delete(agentId);

    const answeredAt = this.lastAnsweredAt.get(agentId);
    if (answeredAt !== undefined && Date.now() - answeredAt > SLOW_REPOLL_LOG_MS) {
      this.logger.info(
        `Agent ${agentId} polled again ${Math.round((Date.now() - answeredAt) / 1000)}s after its last answer (a healthy agent takes about 1s)`,
      );
    }

    const collect = async () => {
      const shouldShutdown = this.consumeShutdownPending(agentId);
      if (shouldShutdown) {
        // Delivered — the agent will self-terminate within milliseconds of receiving this.
        // Mark offline now rather than waiting for last_seen to go stale; a probe waiting on
        // this agent has its answer too.
        this.explicitlyDisconnected.add(agentId);
        this.settleProbes(agentId, false);
      }
      // Only the polling user's own tasks. An agent id can be vacated (the hostname+user fallback renames an agent and leaves its old
      // tasks on the old id) and then registered by someone else, who must not be handed the previous owner's pending tasks.
      const pending = await this.taskQueueService.getPendingTasksForAgent(agentId);
      return {
        tasks: pending.filter(t => sameUser(t.user_id, userId)),
        shouldShutdown,
      };
    };

    const immediate = await collect();
    if (immediate.tasks.length > 0 || immediate.shouldShutdown) {
      this.lastAnsweredAt.set(agentId, Date.now());
      // A poll answered at once is as good a sign of life as a parked one (not after a shutdown:
      // that agent is leaving).
      if (!immediate.shouldShutdown) this.settleProbes(agentId, true);
      return immediate;
    }

    await new Promise<void>(resolve => {
      // Aborted during collect() above: don't park.
      if (signal?.aborted) {
        resolve();
        return;
      }
      let done = false;
      const box: { timer?: ReturnType<typeof setTimeout> } = {};
      const wake = () => {
        if (done) return;
        done = true;
        clearTimeout(box.timer);
        signal?.removeEventListener('abort', wake);
        const list = this.pollWaiters.get(agentId);
        if (list) {
          const idx = list.findIndex(w => w.wake === wake);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.pollWaiters.delete(agentId);
        }
        resolve();
      };
      box.timer = setTimeout(wake, this.POLL_TIMEOUT_MS);
      signal?.addEventListener('abort', wake);
      const list = this.pollWaiters.get(agentId) ?? [];
      list.push({ wake });
      this.pollWaiters.set(agentId, list);
      // A parked poll is a live agent. This also clears a flag that arrived late: the previous
      // process's connection-closed notice can reach us after the restarted agent has already
      // started (and cleared the flag at) its new poll, which would otherwise refuse a healthy
      // agent until that poll times out.
      this.explicitlyDisconnected.delete(agentId);
      // Signalled only once the poll can actually be woken: a probe that sees "alive" can queue
      // work and notifyAgent() without it landing in the gap before the waiter exists.
      this.settleProbes(agentId, true);
    });

    // Gone while parked: nobody to answer. Leave any pending shutdown for the agent's next poll
    // instead of consuming it into a response that is never read.
    if (signal?.aborted) return { tasks: [], shouldShutdown: false };
    this.lastAnsweredAt.set(agentId, Date.now());
    return collect();
  }

  /** Resolve every probe waiting on this agent. */
  private settleProbes(agentId: string, alive: boolean): void {
    const probes = this.aliveProbes.get(agentId);
    if (!probes) return;
    // Copy: each resolver removes itself from the set.
    for (const settle of [...probes]) settle(alive);
  }

  /** Wake any long-poll(s) currently parked for this agent — called when new work exists. */
  notifyAgent(agentId: string): void {
    const waiters = this.pollWaiters.get(agentId);
    if (!waiters || waiters.length === 0) return;
    // Copy first: each wake() mutates the underlying array (removes itself).
    for (const { wake } of [...waiters]) wake();
  }

  /**
   * Get agent status
   */
  async getAgentStatus(
    agentId: string,
    userId: string,
  ): Promise<{
    agent: AgentRegistration;
    isConnected: boolean;
  }> {
    const agent = await this.taskStore.getAgentById(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.user_id !== userId) {
      throw new Error(`Agent ${agentId} does not belong to user ${userId}`);
    }

    return { agent, isConnected: this.isConnectedAt(agentId, agent.last_seen) };
  }

  /**
   * Get all agents for a user
   */
  async getAgentsForUser(userId: string): Promise<AgentRegistration[]> {
    return this.taskStore.getAgentsByUser(userId);
  }

  /**
   * Signing key for agent service tokens.
   *
   * Reuses `backend.auth.keys[0].secret` (BACKEND_SECRET), which is already required in every
   * environment. Read lazily rather than in the constructor so a misconfiguration surfaces at
   * token issuance with a clear message rather than at plugin startup.
   */
  private getTokenSigningKey(): string {
    const keys = this.config.getOptionalConfigArray('backend.auth.keys');
    const secret = keys?.[0]?.getOptionalString('secret');

    if (!secret) {
      throw new Error(
        'Cannot issue agent service tokens: backend.auth.keys[0].secret is not configured. ' +
          'Set the BACKEND_SECRET environment variable.',
      );
    }

    return secret;
  }

  /**
   * Generate a signed service token.
   *
   * Format: `<base64url(payload)>.<base64url(HMAC-SHA256)>`
   *
   * Uses node:crypto rather than a JWT library deliberately — this plugin ships in a Docker
   * image that has previously broken on undeclared transitive dependencies, and the payload
   * ({sub, iat, exp}) does not need full JWT semantics.
   */
  private generateServiceToken(userEmail: string): string {
    const payload = {
      sub: userEmail,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.SERVICE_TOKEN_TTL_SECONDS,
    };

    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.getTokenSigningKey())
      .update(body)
      .digest('base64url');

    return `${body}.${signature}`;
  }

  /**
   * Verify a service token and return the user email it asserts, or null.
   *
   * Returns null for: malformed tokens, bad signatures, and expired tokens. Callers must not
   * distinguish between these in responses — the agent's remedy is the same in every case
   * (`backstage-agent login`).
   *
   * Unsigned legacy tokens (bare base64 JSON, no `.` separator) are rejected here. They were
   * forgeable by anyone, which is the whole reason for this change.
   */
  verifyServiceToken(token: string): string | null {
    const separator = token.lastIndexOf('.');
    if (separator <= 0) {
      return null; // No signature — legacy unsigned token or malformed
    }

    const body = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    let expected: string;
    try {
      expected = createHmac('sha256', this.getTokenSigningKey())
        .update(body)
        .digest('base64url');
    } catch (error: any) {
      this.logger.error(`Cannot verify service token: ${error.message}`);
      return null;
    }

    const provided = Buffer.from(signature);
    const computed = Buffer.from(expected);

    // timingSafeEqual throws on length mismatch, so compare lengths first.
    if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());

      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }

      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * Generate random secure code for device flow
   */
  private generateRandomCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomBytes = require('crypto').randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[randomBytes[i] % chars.length];
    }
    return result;
  }

  /**
   * Generate user-friendly code (e.g., "ABCD-1234")
   */
  private generateUserFriendlyCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (I, O, 0, 1)
    let code = '';
    const randomBytes = require('crypto').randomBytes(8);

    for (let i = 0; i < 4; i++) {
      code += chars[randomBytes[i] % chars.length];
    }
    code += '-';
    for (let i = 4; i < 8; i++) {
      code += chars[randomBytes[i] % chars.length];
    }

    return code;
  }

  /**
   * Extract email from a Backstage user entity reference.
   * Example: "user:default/john.doe" -> "john.doe@<configured-domain>".
   * Delegates to the shared helper (config-driven domain, no hardcoded org).
   */
  private extractEmailFromEntityRef(entityRef: string): string {
    return sharedExtractEmail(entityRef);
  }

  /**
   * Update agent heartbeat (last_seen timestamp)
   */
  async updateAgentHeartbeat(agentId: string, userEmail: string): Promise<void> {
    const agents = await this.taskStore.getAgentsByUser(userEmail);
    const agent = agents.find(a => a.agent_id === agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} not found for user ${userEmail}`);
    }

    await this.taskStore.updateAgentLastSeen(agentId);

    this.logger.debug('Agent heartbeat updated', { agentId, userEmail });
  }

  /**
   * Whether `taskId` is a task of an agent that belongs to `ownerEmail`: the same relation that decides who may receive the task
   * (`longPoll`). A status report for any other task is refused. A task whose agent row is gone (the hostname+user fallback in
   * `upsertAgent` renames an agent's id and leaves its old tasks on the old one) is the queuing user's alone, so the "interrupted"
   * reports of such tasks still land. Database errors propagate on purpose: the agent retries a 5xx, and a swallowed
   * error would silently drop the update.
   */
  async isTaskOfAgentOwner(taskId: string, ownerEmail: string): Promise<boolean> {
    // `task_id` is a uuid column: any other shape is not a task (and would be a 500 from Postgres, which the agent retries forever).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) return false;
    const task = await this.taskQueueService.getTask(taskId);
    if (!task) return false;
    // Both relations must hold: the task was queued by this user (a task on a vacated agent id that someone else later registered is
    // not theirs), and its agent, when it still exists, is theirs.
    if (!sameUser(task.user_id, ownerEmail)) return false;
    const agent = await this.taskStore.getAgentById(task.agent_id);
    return agent ? sameUser(agent.user_id, ownerEmail) : true;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: string,
    metadata?: Record<string, any>,
    errorMessage?: string,
    extra?: { logs?: string; connectionDetails?: Record<string, any> },
  ): Promise<void> {
    // Convert string to TaskStatus enum
    const taskStatus = status as any; // Type assertion since we validate in the route handler
    await this.taskQueueService.updateTaskStatus(taskId, taskStatus, metadata, errorMessage, extra);

    this.logger.info('Task status updated', { taskId, status });
  }

  /**
   * Get agent by ID
   */
  async getAgentById(agentId: string): Promise<any | null> {
    return await this.taskStore.getAgentById(agentId);
  }

  /**
   * THE liveness rule (list, status, trainee view, guards all use it): not known to have stopped,
   * and a poll started within one poll length + a little (agentLiveness.ts). `last_seen` is only
   * written at the START of a poll, so this lags by up to that long when the server never saw
   * the agent leave (laptop asleep, wifi gone, a proxy that hides the disconnect). Where a wrong
   * "online" is dangerous, use confirmAgentOnline() instead.
   */
  isConnectedAt(agentId: string, lastSeen: Date | string | null | undefined): boolean {
    if (this.explicitlyDisconnected.has(agentId)) return false;
    return heardRecently(lastSeen, this.POLL_TIMEOUT_MS);
  }

  /** Inferred online state (see isConnectedAt). */
  async isAgentOnline(agentId: string): Promise<boolean> {
    const agent = await this.taskStore.getAgentById(agentId);
    return this.isConnectedAt(agentId, agent?.last_seen);
  }

  /**
   * Proof, not inference: wake the agent's parked poll and require a fresh poll from it. A live
   * agent re-polls within about a second; one that has stopped — however it stopped, and whether
   * or not the server ever saw the connection drop — cannot. Used where acting on a wrong
   * "online" does damage: the lab's first step, queueing a task, the lab form's Next.
   *
   * Fails safe: any doubt (no answer within CONFIRM_TIMEOUT_MS, shutdown being delivered, agent
   * unknown) is "not alive", and the agent is then marked offline for every other view until its
   * next poll. Concurrent callers share one probe; nothing is cached, because a proof that
   * outlives the moment it was made is the very staleness this exists to remove.
   *
   * In-memory, like the rest of the connection state: it relies on this process holding the
   * agent's poll (one backend replica; during a rolling deploy a probe on the other pod fails
   * safe).
   */
  confirmAlive(agentId: string): Promise<boolean> {
    const inFlight = this.confirmInFlight.get(agentId);
    if (inFlight) return inFlight;
    const probe = this.probe(agentId).finally(() => this.confirmInFlight.delete(agentId));
    this.confirmInFlight.set(agentId, probe);
    return probe;
  }

  /** Inferred online AND confirmed alive: the check to gate a decision on. */
  async confirmAgentOnline(agentId: string): Promise<boolean> {
    if (!(await this.isAgentOnline(agentId))) return false; // already gone: no need to wait
    return this.confirmAlive(agentId);
  }

  private async probe(agentId: string): Promise<boolean> {
    if (this.explicitlyDisconnected.has(agentId)) return false;
    if (!(await this.taskStore.getAgentById(agentId))) return false;
    const started = Date.now();

    const alive = await new Promise<boolean>(resolve => {
      const box: { timer?: ReturnType<typeof setTimeout> } = {};
      const settle = (ok: boolean) => {
        clearTimeout(box.timer);
        const probes = this.aliveProbes.get(agentId);
        probes?.delete(settle);
        if (probes?.size === 0) this.aliveProbes.delete(agentId);
        resolve(ok);
      };
      box.timer = setTimeout(() => settle(false), this.confirmTimeoutMs);
      const probes = this.aliveProbes.get(agentId) ?? new Set();
      probes.add(settle);
      this.aliveProbes.set(agentId, probes);
      // Registered first, then woken: a poll that parks right after this can't be missed.
      this.notifyAgent(agentId);
    });

    if (alive) {
      this.logger.debug(`Agent ${agentId} confirmed alive in ${Date.now() - started}ms`);
    } else {
      this.logger.warn(
        `Agent ${agentId} did not poll again within ${this.confirmTimeoutMs / 1000}s of being woken: treating it as offline`,
      );
      // Same as a dropped connection: every view agrees until the agent's next poll clears it.
      this.markConnectionLost(agentId);
    }
    return alive;
  }

  /**
   * True once a shutdown has actually been delivered to the agent (i.e. it received
   * shouldShutdown:true in a poll response) and it hasn't polled again since. `last_seen`
   * alone can't answer this: it's only updated at the *start* of a poll, so it stays "fresh"
   * for ~45 s (it was 90 s) after an agent has genuinely exited, which is exactly the "still shows
   * online right after I stopped it" gap. This gives instant, authoritative offline status
   * instead of waiting on last_seen staleness. Cleared the moment the agent (or a
   * newly-started one with the same ID) polls again.
   */
  isExplicitlyDisconnected(agentId: string): boolean {
    return this.explicitlyDisconnected.has(agentId);
  }

  /**
   * The agent's parked long-poll closed before we answered it: its process stopped (Ctrl+C,
   * `backstage-agent stop`, a crash, laptop shutdown). A running agent always has a poll parked
   * or re-polls within milliseconds, so this is the earliest reliable "gone" signal — without it
   * a stopped agent read as online for up to 90 s (last_seen), long enough to start a lab
   * (2026-10-31). Marked like an explicit stop, unless another poll from it is still parked;
   * cleared by its next poll, so a network blip costs seconds.
   */
  markConnectionLost(agentId: string): void {
    if ((this.pollWaiters.get(agentId)?.length ?? 0) > 0) return;
    this.explicitlyDisconnected.add(agentId);
  }

  /**
   * Request that the agent shut itself down. Delivered via the long-poll response's
   * `shouldShutdown` flag — near-instant in practice, since notifyAgent() wakes a parked
   * poll immediately, but see isExplicitlyDisconnected() for why last_seen alone can't
   * reflect that instantly on its own.
   */
  disconnectAgent(agentId: string): boolean {
    // Mark pending — consumed and delivered by the agent's next long-poll response, at most
    // POLL_TIMEOUT_MS away. notifyAgent() below wakes it immediately if one happens to be
    // parked right now, but the pending flag is the actual source of truth: it's what
    // guarantees delivery even if nothing is parked at this exact instant.
    this.pendingShutdowns.add(agentId);
    this.notifyAgent(agentId);

    this.logger.info(`Agent ${agentId} disconnected by request`);
    return true;
  }

  /**
   * One-shot check-and-clear for a pending shutdown request. Called from longPoll() so
   * "Stop Agent" is delivered on the agent's next poll response.
   */
  consumeShutdownPending(agentId: string): boolean {
    return this.pendingShutdowns.delete(agentId);
  }

  /**
   * Delete agent from database (revoke)
   */
  async deleteAgent(agentId: string): Promise<void> {
    await this.taskStore.deleteAgent(agentId);
    this.lastAnsweredAt.delete(agentId);
    this.logger.info(`Agent ${agentId} deleted from database`);
  }

  /**
   * Cleanup on shutdown. No persistent connections to close anymore — waking any parked
   * long-polls just lets them return promptly instead of sitting until POLL_TIMEOUT_MS during
   * a redeploy; agents treat the resulting connection reset the same as any other network
   * blip and simply reconnect, no special "shutdown" signal required.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down AgentService');

    for (const agentId of [...this.aliveProbes.keys()]) {
      this.settleProbes(agentId, false);
    }
    for (const agentId of this.pollWaiters.keys()) {
      this.notifyAgent(agentId);
    }

    this.logger.info('AgentService shutdown complete');
  }
}
