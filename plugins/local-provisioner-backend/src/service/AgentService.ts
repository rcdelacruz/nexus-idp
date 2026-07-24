/**
 * Service for agent management, SSE connections, and authentication
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { TaskStore } from '../database/TaskStore';
import { TaskQueueService } from './TaskQueueService';
import {
  AgentRegistration,
  AgentAuthResponse,
  AgentRegisterRequest,
  SSETaskEvent,
} from '../types';
import { extractEmailFromEntityRef as sharedExtractEmail } from '../util/identity';

/**
 * SSE connection tracking
 */
interface SSEConnection {
  agentId: string;
  userId: string;
  response: Response;
  connectedAt: Date;
}

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
  };
}

/**
 * AgentService manages agent lifecycle, authentication, and SSE connections
 */
export class AgentService {
  private sseConnections: Map<string, SSEConnection> = new Map();
  private deviceCodes: Map<string, DeviceCodeAuthorization> = new Map(); // device_code -> authorization
  private userCodes: Map<string, string> = new Map(); // user_code -> device_code
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS: number;
  private readonly DEVICE_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
  // Single source of truth for the service-token lifetime — the signed `exp` and the `expiresAt`
  // reported to the agent are both derived from this, so they can't drift apart.
  private readonly SERVICE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private readonly logger: LoggerService,
    private readonly taskStore: TaskStore,
    private readonly taskQueueService: TaskQueueService,
    private readonly config: Config,
    heartbeatIntervalSeconds: number = 30,
  ) {
    this.HEARTBEAT_INTERVAL_MS = heartbeatIntervalSeconds * 1000;
    this.startHeartbeat();
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
      const { agentId: machineAgentId, hostname, platform, platformVersion } = authorization.machineInfo;

      const result = await this.taskStore.upsertAgent(
        machineAgentId,
        userEmail,
        hostname,
        platform,
        platformVersion,
        hostname, // machine_name = hostname
        '0.1.0', // agent_version - TODO: get from CLI
      );

      agentId = result.agent.agent_id;
      reconnected = result.reconnected;

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
   * Establish SSE connection for agent
   */
  async connectAgent(agentId: string, userId: string, res: Response): Promise<void> {
    this.logger.info(`Agent ${agentId} connecting via SSE`, { agentId, userId });

    // Verify agent exists and belongs to user
    const agent = await this.taskStore.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.user_id !== userId) {
      throw new Error(`Agent ${agentId} does not belong to user ${userId}`);
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Store connection
    this.sseConnections.set(agentId, {
      agentId,
      userId,
      response: res,
      connectedAt: new Date(),
    });

    // Update last seen
    await this.taskStore.updateAgentLastSeen(agentId);

    // Send initial connection event
    this.sendSSE(res, 'connected', { message: 'SSE connection established' });

    this.logger.info(`Agent ${agentId} connected via SSE`, {
      agentId,
      userId,
      totalConnections: this.sseConnections.size,
    });

    // Send any pending tasks
    await this.sendPendingTasks(agentId);

    // Handle connection close
    res.on('close', () => {
      this.logger.info(`Agent ${agentId} disconnected`, { agentId });
      this.sseConnections.delete(agentId);
    });
  }

  /**
   * Send pending tasks to agent via SSE
   */
  async sendPendingTasks(agentId: string): Promise<void> {
    this.logger.info(`[SSE] Checking pending tasks for agent ${agentId}`, { agentId });

    const tasks = await this.taskQueueService.getPendingTasksForAgent(agentId);

    this.logger.info(`[SSE] Query returned ${tasks.length} pending tasks for agent ${agentId}`, {
      agentId,
      taskCount: tasks.length,
      taskIds: tasks.map(t => t.task_id),
    });

    if (tasks.length === 0) {
      this.logger.info(`[SSE] No pending tasks to send for agent ${agentId}`, { agentId });
      return;
    }

    const connection = this.sseConnections.get(agentId);
    if (!connection) {
      this.logger.warn(`[SSE] Agent ${agentId} not connected, cannot send ${tasks.length} tasks`, {
        agentId,
        taskCount: tasks.length,
        taskIds: tasks.map(t => t.task_id),
      });
      return;
    }

    this.logger.info(`[SSE] Sending ${tasks.length} pending tasks to agent ${agentId}`, {
      agentId,
      taskCount: tasks.length,
      taskIds: tasks.map(t => t.task_id),
    });

    for (const task of tasks) {
      const event: SSETaskEvent = {
        taskId: task.task_id,
        type: task.task_type,
        config: task.config,
      };

      this.sendSSE(connection.response, 'task', event);

      this.logger.info(`[SSE] Sent task ${task.task_id} to agent ${agentId} via SSE`, {
        taskId: task.task_id,
        taskType: task.task_type,
        agentId,
      });
    }

    this.logger.info(`[SSE] Successfully sent all ${tasks.length} tasks to agent ${agentId}`, {
      agentId,
      taskCount: tasks.length,
    });
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

    const isConnected = this.sseConnections.has(agentId);

    return {
      agent,
      isConnected,
    };
  }

  /**
   * Get all agents for a user
   */
  async getAgentsForUser(userId: string): Promise<AgentRegistration[]> {
    return this.taskStore.getAgentsByUser(userId);
  }

  /**
   * Check if an agent is currently connected via SSE
   */
  isAgentConnected(agentId: string): boolean {
    return this.sseConnections.has(agentId);
  }

  /**
   * Get list of currently connected agent IDs (for debugging)
   */
  getActiveConnections(): string[] {
    return Array.from(this.sseConnections.keys());
  }

  /**
   * Send heartbeat to all connected agents
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const connectedAgents = Array.from(this.sseConnections.keys());

      if (connectedAgents.length === 0) {
        return;
      }

      this.logger.debug(`Sending heartbeat to ${connectedAgents.length} agents`, {
        agentCount: connectedAgents.length,
      });

      for (const [agentId, connection] of this.sseConnections.entries()) {
        try {
          this.sendSSE(connection.response, 'heartbeat', { timestamp: Date.now() });

          // Update last seen
          this.taskStore.updateAgentLastSeen(agentId).catch((err: Error) => {
            this.logger.error(`Failed to update last seen for agent ${agentId}`, err);
          });
        } catch (error) {
          this.logger.error(`Failed to send heartbeat to agent ${agentId}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          this.sseConnections.delete(agentId);
        }
      }
    }, this.HEARTBEAT_INTERVAL_MS);

    this.logger.info(`Heartbeat started (interval: ${this.HEARTBEAT_INTERVAL_MS}ms)`);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.info('Heartbeat stopped');
    }
  }

  /**
   * Send SSE event
   */
  private sendSSE(res: Response, event: string, data: any): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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
   * Whether an agent is currently online: an active SSE connection, or a heartbeat within the
   * last 90s. Used to refuse queuing tasks (provision or lifecycle) to a dead agent — which
   * would otherwise sit "pending" forever.
   */
  async isAgentOnline(agentId: string): Promise<boolean> {
    if (this.isAgentConnected(agentId)) return true;
    const agent = await this.taskStore.getAgentById(agentId);
    if (!agent?.last_seen) return false;
    const ageMs = Date.now() - new Date(agent.last_seen).getTime();
    return ageMs <= 90_000;
  }

  /**
   * Return pending tasks for an agent, verifying it belongs to the user (same ownership check as
   * the SSE connect). Backs the agent's polling fallback — reliable task delivery through proxies
   * (e.g. a Cloudflare tunnel) that buffer SSE streams.
   */
  async getPendingTasksForOwnedAgent(agentId: string, userId: string) {
    const agent = await this.taskStore.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (agent.user_id !== userId) {
      throw new Error(`Agent ${agentId} does not belong to user ${userId}`);
    }
    return this.taskQueueService.getPendingTasksForAgent(agentId);
  }

  /**
   * Disconnect agent (send disconnect signal via SSE)
   * Returns true if agent was connected and signal sent, false otherwise
   */
  disconnectAgent(agentId: string): boolean {
    const connection = this.sseConnections.get(agentId);

    if (!connection) {
      this.logger.warn(`Cannot disconnect agent ${agentId}: not connected`);
      return false;
    }

    // Send disconnect event
    this.sendSSE(connection.response, 'disconnect', {
      message: 'Disconnect requested by user',
      timestamp: new Date().toISOString(),
    });

    // Close connection
    connection.response.end();
    this.sseConnections.delete(agentId);

    this.logger.info(`Agent ${agentId} disconnected by request`);
    return true;
  }

  /**
   * Delete agent from database (revoke)
   */
  async deleteAgent(agentId: string): Promise<void> {
    await this.taskStore.deleteAgent(agentId);
    this.logger.info(`Agent ${agentId} deleted from database`);
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down AgentService');

    this.stopHeartbeat();

    // Close all SSE connections
    for (const [_agentId, connection] of this.sseConnections.entries()) {
      this.sendSSE(connection.response, 'shutdown', { message: 'Server shutting down' });
      connection.response.end();
    }

    this.sseConnections.clear();

    this.logger.info('AgentService shutdown complete');
  }
}
