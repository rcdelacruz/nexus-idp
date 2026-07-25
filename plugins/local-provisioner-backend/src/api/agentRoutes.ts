/**
 * API routes for agent management
 */

import { Router, Request } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AgentService } from '../service/AgentService';
import { TaskQueueService } from '../service/TaskQueueService';
import { AgentRegisterRequest, ResourceState } from '../types';
import { extractEmailFromEntityRef } from '../util/identity';
import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for POST /device/code
 * 10 requests per IP per 15 minutes — one device flow needs 1 request.
 * TODO: swap MemoryStore for rate-limit-redis if replicaCount > 1.
 */
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
): Router {
  const router = Router();

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
      // Extract machine info from request body (sent by CLI)
      const { agent_id, hostname, platform, platform_version } = req.body || {};

      // DEBUG: Log what we received
      logger.info('[DEBUG] /device/code request body', { body: req.body });
      logger.info('[DEBUG] Extracted fields', { agent_id, hostname, platform, platform_version });

      let machineInfo: {
        agentId: string;
        hostname: string;
        platform: string;
        platformVersion: string;
      } | undefined;

      if (agent_id && hostname && platform && platform_version) {
        machineInfo = {
          agentId: agent_id,
          hostname,
          platform,
          platformVersion: platform_version,
        };
        logger.info('[DEBUG] Machine info created', { machineInfo });
      } else {
        logger.warn('[DEBUG] Machine info NOT created - missing fields', {
          agent_id,
          hostname,
          platform,
          platform_version,
          body: req.body,
        });
      }

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
   * GET /agent/events/:agentId
   * Server-Sent Events endpoint for task delivery
   * Accepts service token from agent CLI
   *
   * NOTE: This endpoint establishes a long-lived SSE connection
   * The response is managed by AgentService and doesn't follow standard REST patterns
   */
  router.get('/events/:agentId', async (req, res): Promise<void> => {
    try {
      const { agentId } = req.params;

      // Validate service token
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        if (!res.headersSent) {
          res.status(401).json(INVALID_TOKEN_RESPONSE);
        }
        return;
      }

      // Establish SSE connection
      await agentService.connectAgent(agentId, userEmail, res);

      // Connection will remain open until client disconnects
      // Response is handled by AgentService
      // This endpoint doesn't return a standard response
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to establish SSE connection',
          message: error.message,
        });
      }
      // If headers already sent, we can't send error response
      // Agent will detect connection failure
    }
  });

  /**
   * POST /agent/heartbeat
   * Agent heartbeat endpoint
   * Accepts service token from agent CLI
   */
  router.post('/heartbeat', async (req, res) => {
    try {
      // Validate service token
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        return res.status(401).json(INVALID_TOKEN_RESPONSE);
      }

      const { agentId } = req.body;

      if (!agentId) {
        return res.status(400).json({
          error: 'Missing agentId in request body',
        });
      }

      // Update agent last_seen timestamp
      await agentService.updateAgentHeartbeat(agentId, userEmail);

      // Piggyback pending tasks on the heartbeat response so the agent needs no separate poll.
      // The heartbeat already runs every 30s and is a short request/response that sails through
      // proxies (unlike SSE) — folding delivery in here removes ~2/3 of agent request volume and
      // the 100s-timeout / streaming risk entirely.
      let tasks: any[] = [];
      try {
        tasks = await agentService.getPendingTasksForOwnedAgent(agentId, userEmail);
      } catch (err: any) {
        // A pending-tasks failure must not break the heartbeat itself.
        logger.warn(`Heartbeat: failed to fetch pending tasks for ${agentId}: ${err.message}`);
      }

      return res.status(200).json({
        message: 'Heartbeat received',
        tasks,
        total: tasks.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to process heartbeat',
        message: error.message,
      });
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
   * GET /agent/tasks/pending?agentId=...
   * Polling fallback for task delivery. The agent polls this (plain request/response, which
   * survives proxies that buffer SSE) to fetch its pending tasks. Authed via service token.
   */
  router.get('/tasks/pending', async (req, res) => {
    try {
      const userEmail = validateServiceToken(req, agentService);
      if (!userEmail) {
        return res.status(401).json(INVALID_TOKEN_RESPONSE);
      }
      const agentId = String(req.query.agentId || '');
      if (!agentId) {
        return res.status(400).json({ error: 'Missing agentId query parameter' });
      }
      const tasks = await agentService.getPendingTasksForOwnedAgent(agentId, userEmail);
      return res.status(200).json({ tasks, total: tasks.length });
    } catch (error: any) {
      if (error.message?.includes('does not belong')) {
        return res.status(403).json({ error: 'Forbidden', message: error.message });
      }
      return res.status(500).json({ error: 'Failed to fetch pending tasks', message: error.message });
    }
  });

  /**
   * GET /debug/connections
   * Debug endpoint to see SSE connections
   */
  router.get('/debug/connections', async (_req, res) => {
    const connections = agentService.getActiveConnections();
    return res.status(200).json({ connections });
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

      // Add connection status + a SERVER-computed heartbeat age. Computing the age here (server
      // clock vs server-written last_seen) makes the UI immune to client clock skew — the chip
      // no longer subtracts a server timestamp from the browser's clock.
      const now = Date.now();
      const agentsWithStatus = agentRegistrations.map(agent => {
        const isConnected = agentService.isAgentConnected(agent.agent_id);
        const lastSeenMs = agent.last_seen ? new Date(agent.last_seen).getTime() : 0;
        const lastSeenAgeSeconds = lastSeenMs ? Math.floor((now - lastSeenMs) / 1000) : null;
        return {
          ...agent,
          is_connected: isConnected,
          last_seen_age_seconds: lastSeenAgeSeconds,
        };
      });

      return res.status(200).json({
        agents: agentsWithStatus,
        total: agentsWithStatus.length,
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

      const isConnected = agentService.isAgentConnected(agentId);

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
   * Send disconnect signal to agent (graceful stop via SSE)
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

      // Send disconnect command via SSE
      const success = agentService.disconnectAgent(agentId);

      if (success) {
        return res.status(200).json({
          message: 'Disconnect signal sent to agent',
          agent_id: agentId,
        });
      }
      return res.status(404).json({
        error: 'Agent not connected',
        message: 'Agent is not currently connected via SSE',
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
