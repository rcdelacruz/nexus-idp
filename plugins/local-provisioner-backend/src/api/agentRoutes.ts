/**
 * API routes for agent management
 */

import { Router, Request } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AgentService } from '../service/AgentService';
import { TaskQueueService } from '../service/TaskQueueService';
import { AgentCapabilities, AgentRegisterRequest, ResourceState } from '../types';
import { extractEmailFromEntityRef } from '../util/identity';
import rateLimit from 'express-rate-limit';
import { isOlderVersion, LatestAgentVersion } from '../service/latestAgentVersion';
import { parseDeviceCodeBody } from './deviceCodeInput';

/**
 * Rate limiter for POST /device/code
 * 10 requests per IP per 15 minutes — one device flow needs 1 request.
 * TODO: swap MemoryStore for rate-limit-redis if replicaCount > 1.
 */
/** An agent-reported version, accepted only as plain x.y.z (it is stored and compared). */
export function validAgentVersion(v: unknown): string | undefined {
  return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(v) ? v : undefined;
}

/** Machine capabilities from the poll query (arch, cpus, dockerMem, dockerOs), strictly validated; undefined when absent. */
export function parseCapabilities(q: Record<string, unknown>): AgentCapabilities | undefined {
  const caps: AgentCapabilities = {};
  if (typeof q.arch === 'string' && /^(x64|arm64|arm|ia32|ppc64|s390x|riscv64|loong64)$/.test(q.arch)) caps.arch = q.arch;
  const int = (v: unknown, max: number) => (typeof v === 'string' && /^\d{1,15}$/.test(v) && Number(v) > 0 && Number(v) <= max ? Number(v) : undefined);
  const cpus = int(q.cpus, 1024);
  if (cpus) caps.cpus = cpus;
  const mem = int(q.dockerMem, 2 ** 46); // ≤ 64 TiB
  if (mem) caps.dockerMemoryBytes = mem;
  if (q.dockerOs === 'linux' || q.dockerOs === 'windows') caps.dockerOs = q.dockerOs;
  return Object.keys(caps).length ? caps : undefined;
}

const deviceCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: 'Too many device code requests, please try again later.' },
});

/**
 * Rate limiter for POST /device/token
 * CLI polls every ~5s for up to 10 min = ~120 polls. 130 over 10 min window with buffer.
 * TODO: swap MemoryStore for rate-limit-redis if replicaCount > 1.
 */
const deviceTokenLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 130,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: 'Too many token poll requests, please try again later.' },
});

/**
 * Validate the service token in the Authorization header.
 * Returns the asserted user email, or null if the token is missing, malformed, unsigned,
 * incorrectly signed, or expired.
 *
 * Signature verification lives in AgentService because that is where the signing key
 * (backend.auth.keys[0].secret) is reachable.
 */
function validateServiceToken(
  req: Request,
  agentService: AgentService,
): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return agentService.verifyServiceToken(authHeader.substring(7));
}

/**
 * Standard 401 body for agent endpoints.
 *
 * The remedy is identical for every rejection reason (expired, forged, legacy-unsigned), so
 * the message states it plainly rather than leaking which check failed.
 */
const INVALID_TOKEN_RESPONSE = {
  error: 'Unauthorized',
  message:
    'Valid service token required. Run `backstage-agent login` to obtain a new token.',
};

/**
 * Extract email from Backstage user entity reference
 * Example: "user:default/jane.doe" -> "jane.doe@<configured-domain>"
 */
// extractEmailFromEntityRef now lives in ../util/identity (shared with router.ts)

/**
 * Create agent-related API routes
 */
export function createAgentRoutes(
  agentService: AgentService,
  logger: LoggerService,
  taskQueueService?: TaskQueueService,
  latestAgent: LatestAgentVersion = new LatestAgentVersion(),
): Router {
  const router = Router({ caseSensitive: true }); // see service/router.ts

  /**
   * POST /agent/device/code
   * Generate device code for CLI authentication (OAuth 2.0 Device Flow - RFC 8628)
   * This endpoint is PUBLIC - no authentication required
   *
   * Request body (optional):
   * {
   *   agent_id: string,        // Machine-based agent ID (e.g., "agent-macbook-pro-a1b2c3d4")
   *   hostname: string,         // Machine hostname (e.g., "macbook-pro.local")
   *   platform: string,         // OS platform (e.g., "darwin")
   *   platform_version: string  // OS version (e.g., "macOS 14.2")
   * }
   */
  router.post('/device/code', deviceCodeLimiter, async (req, res) => {
    try {
      // The body comes from an unauthenticated client: validated, bounded, and never logged.
      const parsed = parseDeviceCodeBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: 'invalid_request', error_description: parsed.error });
      }
      const machineInfo = parsed.machine;

      const deviceCodeResponse = await agentService.generateDeviceCode(machineInfo);

      return res.status(200).json(deviceCodeResponse);
    } catch (error: any) {
      logger.error('Failed to generate device code', { error: error.message });
      return res.status(500).json({
        error: 'Failed to generate device code',
        message: error.message,
      });
    }
  });

  /**
   * POST /agent/device/authorize
   * Authorize device code (called from browser after user enters code)
   * This endpoint REQUIRES authentication
   */
  router.post('/device/authorize', async (req, res) => {
    try {
      const { user_code } = req.body;

      if (!user_code) {
        return res.status(400).json({
          error: 'Missing user_code in request body',
        });
      }

      // Get user entity ref from authenticated request
      // @ts-ignore - req.user is added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Authentication required',
        });
      }

      await agentService.authorizeDeviceCode(user_code, userEntityRef);

      return res.status(200).json({
        message: 'Device authorized successfully',
      });
    } catch (error: any) {
      if (error.message.includes('Invalid') || error.message.includes('expired')) {
        return res.status(400).json({
          error: error.message,
        });
      }

      return res.status(500).json({
        error: 'Failed to authorize device',
        message: error.message,
      });
    }
  });

  /**
   * POST /agent/device/token
   * Poll for device authorization (called by CLI)
   * This endpoint is PUBLIC - no authentication required
   */
  router.post('/device/token', deviceTokenLimiter, async (req, res) => {
    try {
      const { device_code } = req.body;

      if (!device_code) {
        return res.status(400).json({
          error: 'Missing device_code in request body',
        });
      }

      const authResponse = await agentService.pollDeviceCode(device_code);

      if (!authResponse) {
        // Still pending authorization
        return res.status(400).json({
          error: 'authorization_pending',
          error_description: 'User has not yet authorized this device',
        });
      }

      // Authorization complete, return token
      return res.status(200).json({
        access_token: authResponse.serviceToken,
        token_type: 'Bearer',
        expires_in: Math.floor((authResponse.expiresAt - Date.now()) / 1000),
        agent_id: authResponse.agentId,
        reconnected: authResponse.reconnected || false,
      });
    } catch (error: any) {
      logger.error('Error polling device code', {
        error: error.message,
        stack: error.stack,
        deviceCode: `${req.body.device_code?.substring(0, 8)}...`,
      });

      if (error.message.includes('Invalid')) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: error.message,
        });
      }

      if (error.message.includes('expired')) {
        return res.status(400).json({
          error: 'expired_token',
          error_description: error.message,
        });
      }

      if (error.message.includes('denied')) {
        return res.status(400).json({
          error: 'access_denied',
          error_description: error.message,
        });
      }

      return res.status(500).json({
        error: 'server_error',
        error_description: error.message,
      });
    }
  });


  /**
   * POST /agent/register
   * Register a new agent with machine info
   * Accepts service token from device flow in Authorization header
   */
  router.post('/register', async (req, res) => {
    try {
      // Verify the signed service token from the Authorization header
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        return res.status(401).json(INVALID_TOKEN_RESPONSE);
      }

      const registerRequest: AgentRegisterRequest = req.body;

      const agent = await agentService.registerAgent(userEmail, registerRequest);

      return res.status(201).json({
        agent_id: agent.agent_id,
        message: 'Agent registered successfully',
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Agent registration failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /agent/poll?agentId=...
   * Long-poll endpoint: the single mechanism for task delivery, the shutdown signal, and
   * liveness (replaces SSE + the separate heartbeat entirely — see AgentService.longPoll's
   * doc comment for why). Accepts service token from agent CLI. Holds the request open until
   * either work exists or POLL_TIMEOUT_MS elapses, then responds; the agent immediately
   * reissues the request. Each call updates last_seen — no separate heartbeat needed.
   */
  router.get('/poll', async (req, res) => {
    try {
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        return res.status(401).json(INVALID_TOKEN_RESPONSE);
      }

      const agentId = req.query.agentId as string | undefined;
      if (!agentId) {
        return res.status(400).json({ error: 'Missing agentId query parameter' });
      }

      // Let the wait end early if the agent's own request times out/drops, instead of holding
      // a dead response object until POLL_TIMEOUT_MS.
      const controller = new AbortController();
      req.on('close', () => controller.abort());
      // The connection closed before we answered: the agent is gone (see markConnectionLost).
      // `res` 'close' after a normal response has writableEnded = true and is ignored.
      const pollStartedAt = Date.now();
      res.on('close', () => {
        if (res.writableEnded) return;
        controller.abort();
        // 'close' fires before longPoll's ownership check, so look the agent up here: only its
        // owner's dropped connection may mark it gone (otherwise any holder of a service token
        // could flag someone else's agent by polling its id and hanging up), and only the stored
        // id is logged, never the raw query value.
        agentService
          .getAgentById(agentId)
          .then(agent => {
            if (!agent || agent.user_id !== userEmail) return;
            agentService.markConnectionLost(agent.agent_id);
            // Tells us whether the proxy in front of the portal passes a stopped agent's
            // disconnect through: after `backstage-agent stop` this line should appear at once.
            logger.info(
              `Agent ${agent.agent_id}: poll connection closed before it was answered (open ${Math.round((Date.now() - pollStartedAt) / 1000)}s)`,
            );
          })
          .catch(() => undefined);
      });

      const { tasks, shouldShutdown } = await agentService.longPoll(
        agentId,
        userEmail,
        controller.signal,
        validAgentVersion(req.query.version),
        parseCapabilities(req.query),
      );

      if (res.writableEnded) return undefined; // client already gone (aborted)

      return res.status(200).json({
        message: 'Poll response',
        tasks,
        total: tasks.length,
        shouldShutdown,
      });
    } catch (error: any) {
      logger.error(`Failed to process poll for agent ${req.query.agentId}: ${error.message}`);
      if (!res.writableEnded) {
        return res.status(500).json({
          error: 'Failed to process poll',
          message: error.message,
        });
      }
      return undefined;
    }
  });

  /**
   * PUT /agent/tasks/:taskId/status
   * Update task status from agent
   * Accepts service token from agent CLI
   */
  router.put('/tasks/:taskId/status', async (req, res) => {
    try {
      // Validate service token
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        return res.status(401).json(INVALID_TOKEN_RESPONSE);
      }

      const { taskId } = req.params;
      const { status, metadata, error: errorMessage, logs, connectionDetails } = req.body;

      if (!status) {
        return res.status(400).json({
          error: 'Missing status in request body',
        });
      }

      // Verify valid status values
      const validStatuses = ['pending', 'in-progress', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }

      // The token proves WHO is calling, not that this task is theirs: without this check any agent token could rewrite any task's
      // status, logs and result (404 for both "no such task" and "not yours": no existence leak, and a 4xx makes the agent drop it).
      if (!(await agentService.isTaskOfAgentOwner(taskId, userEmail))) {
        logger.warn(`Refused a status update for task ${taskId}: it is not a task of ${userEmail}'s agents`);
        return res.status(404).json({ error: 'Task not found', taskId });
      }

      // Update task status via agent service (logs + connection details persisted for the UI)
      await agentService.updateTaskStatus(taskId, status, metadata, errorMessage, {
        logs,
        connectionDetails,
      });

      return res.status(200).json({
        message: 'Task status updated successfully',
        taskId,
        status,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to update task status',
        message: error.message,
      });
    }
  });

  /**
   * GET /agent/status/:agentId
   * Get agent status
   */
  router.get('/status/:agentId', async (req, res) => {
    try {
      const { agentId } = req.params;

      // Get user ID from Backstage auth
      // @ts-ignore - req.user will be added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const userId = extractEmailFromEntityRef(userEntityRef);
      const status = await agentService.getAgentStatus(agentId, userId);

      return res.status(200).json(status);
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to get agent status',
        message: error.message,
      });
    }
  });

  /**
   * GET /agents
   * Get all agents for current user with connection status
   */
  router.get('/', async (req, res) => {
    try {
      // Get user ID from Backstage auth
      // @ts-ignore - req.user will be added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const userId = extractEmailFromEntityRef(userEntityRef);
      const agentRegistrations = await agentService.getAgentsForUser(userId);

      // ?verify=1 — for a decision (the lab form's Next): don't trust the age, prove each
      // apparently-online agent is alive right now (AgentService.confirmAlive; wakes its poll).
      // The periodic status views leave it off.
      const verify = req.query.verify === '1' || req.query.verify === 'true';
      const confirmed = new Set<string>();
      if (verify) {
        await Promise.all(
          agentRegistrations
            .filter(a => agentService.isConnectedAt(a.agent_id, a.last_seen))
            .map(async a => {
              if (await agentService.confirmAlive(a.agent_id)) confirmed.add(a.agent_id);
            }),
        );
      }

      // Add connection status + a SERVER-computed heartbeat age. Computing the age here (server
      // clock vs server-written last_seen) makes the UI immune to client clock skew — the chip
      // no longer subtracts a server timestamp from the browser's clock.
      const now = Date.now();
      const latestAgentVersion = await latestAgent.get();
      const agentsWithStatus = agentRegistrations.map(agent => {
        const lastSeenMs = agent.last_seen ? new Date(agent.last_seen).getTime() : 0;
        const lastSeenAgeSeconds = lastSeenMs ? Math.floor((now - lastSeenMs) / 1000) : null;
        // The one liveness rule (AgentService.isConnectedAt): not known to have stopped, and
        // heard from within one poll + a little. After a verify, an agent that failed to answer
        // is already flagged, so it reads offline here too.
        const explicitlyDisconnected = agentService.isExplicitlyDisconnected(agent.agent_id);
        // When verifying, the probe's answer is the verdict (the row's age pre-dates it).
        const isConnected = verify
          ? confirmed.has(agent.agent_id)
          : agentService.isConnectedAt(agent.agent_id, agent.last_seen);
        return {
          ...agent,
          is_connected: isConnected,
          last_seen_age_seconds: lastSeenAgeSeconds,
          // Surfaced separately from is_connected so the frontend can treat it as permanent
          // (doesn't decay back to "degraded" as last_seen ages past the limit) rather than folding
          // it into a single boolean that collapses "just stopped" and "silently went stale"
          // into the same signal (found 2026-07-26 — see connectivity.ts).
          explicitly_disconnected: explicitlyDisconnected,
          // "update available" hint on My agents (npm's latest, cached hourly).
          latest_agent_version: latestAgentVersion ?? null,
          update_available: isOlderVersion(agent.agent_version, latestAgentVersion),
        };
      });

      // A status that can be a few seconds stale must never be served from a cache.
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({
        agents: agentsWithStatus,
        total: agentsWithStatus.length,
        verified: verify,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to get agents',
        message: error.message,
      });
    }
  });

  /**
   * GET /:agentId
   * Get detailed info for a specific agent
   */
  router.get('/:agentId', async (req, res) => {
    try {
      // Get user ID from Backstage auth
      // @ts-ignore - req.user will be added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const userId = extractEmailFromEntityRef(userEntityRef);
      const { agentId } = req.params;

      const agent = await agentService.getAgentById(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'Agent not found',
        });
      }

      // Verify agent belongs to user
      if (agent.user_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This agent belongs to another user',
        });
      }

      const isConnected = await agentService.isAgentOnline(agentId);

      return res.status(200).json({
        ...agent,
        is_connected: isConnected,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to get agent',
        message: error.message,
      });
    }
  });

  /**
   * POST /:agentId/disconnect
   * Request a graceful stop ("Stop Agent" in the UI). Delivered via the agent's next long-poll
   * response — always succeeds from this endpoint's perspective (the request is durably
   * recorded even if the agent isn't polling at this exact instant); see
   * AgentService.disconnectAgent.
   */
  router.post('/:agentId/disconnect', async (req, res) => {
    try {
      // Get user ID from Backstage auth
      // @ts-ignore - req.user will be added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const userId = extractEmailFromEntityRef(userEntityRef);
      const { agentId } = req.params;

      const agent = await agentService.getAgentById(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'Agent not found',
        });
      }

      // Verify agent belongs to user
      if (agent.user_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This agent belongs to another user',
        });
      }

      agentService.disconnectAgent(agentId);
      return res.status(200).json({
        message: 'Stop requested — will take effect on the agent\'s next poll',
        agent_id: agentId,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to disconnect agent',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /:agentId/revoke
   * Revoke agent (delete from database, disconnect if connected)
   */
  router.delete('/:agentId/revoke', async (req, res) => {
    try {
      // Get user ID from Backstage auth
      // @ts-ignore - req.user will be added by auth middleware
      const userEntityRef = req.user?.userEntityRef;

      if (!userEntityRef) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const userId = extractEmailFromEntityRef(userEntityRef);
      const { agentId } = req.params;

      const agent = await agentService.getAgentById(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'Agent not found',
        });
      }

      // Verify agent belongs to user
      if (agent.user_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This agent belongs to another user',
        });
      }

      // Refuse to revoke while the agent still owns active resources — deleting the
      // registration would orphan them (still running on the dev's machine, but the portal
      // loses track of them and the catalog entity dangles). Mirrors the deprovision safety
      // posture: irreversible actions default safe.
      if (taskQueueService) {
        const resources = await taskQueueService.getResourcesForUser(userId);
        const activeOnAgent = resources.filter(
          r => r.agent_id === agentId && r.state !== ResourceState.REMOVED,
        );
        if (activeOnAgent.length > 0) {
          return res.status(409).json({
            error: 'Agent has active resources',
            message:
              `Cannot revoke this agent — it still owns ${activeOnAgent.length} provisioned ` +
              `resource(s) (${activeOnAgent.map(r => r.resource_name).join(', ')}). Stop & ` +
              'remove them first.',
            resources: activeOnAgent.map(r => ({
              resourceName: r.resource_name,
              state: r.state,
            })),
          });
        }
      }

      // Disconnect if connected
      agentService.disconnectAgent(agentId);

      // Delete from database
      await agentService.deleteAgent(agentId);

      logger.info(`Agent revoked: ${agentId} by user ${userId}`);

      return res.status(200).json({
        message: 'Agent revoked successfully',
        agent_id: agentId,
      });
    } catch (error: any) {
      logger.error(`Failed to revoke agent: ${error.message}`);
      return res.status(500).json({
        error: 'Failed to revoke agent',
        message: error.message,
      });
    }
  });

  return router;
}
