/**
 * API routes for agent management
 */

import { Router, Request } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AgentService } from '../service/AgentService';
import {
  AgentAuthRequest,
  AgentRegisterRequest,
} from '../types';
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
 * Validate service token from Authorization header
 * Returns user email or null if invalid
 */
function validateServiceToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const serviceToken = authHeader.substring(7);

  try {
    const payload = JSON.parse(Buffer.from(serviceToken, 'base64').toString());

    // Check token expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return payload.sub; // User email
  } catch (error) {
    return null; // Invalid token
  }
}

/**
 * Extract email from Backstage user entity reference
 * Example: "user:default/ronaldo.delacruz" -> "ronaldo.delacruz@stratpoint.com"
 */
function extractEmailFromEntityRef(entityRef: string): string {
  const parts = entityRef.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid user entity reference: ${entityRef}`);
  }

  const username = parts[1];

  // If already an email, return as-is
  if (username.includes('@')) {
    return username;
  }

  // Otherwise, append domain
  return `${username}@stratpoint.com`;
}

/**
 * Create agent-related API routes
 */
export function createAgentRoutes(agentService: AgentService, logger: LoggerService, httpAuth?: any): Router {
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
   * GET /agent/auth-callback
   * OAuth callback handler for CLI agent authentication
   *
   * This endpoint is invoked AFTER successful Google OAuth.
   * It generates a service token and displays it to the user for manual copy/paste.
   *
   * Flow:
   * 1. User runs: backstage-agent login --url http://localhost:7007
   * 2. CLI opens browser to: /api/local-provisioner/agent/auth-start
   * 3. User completes Google OAuth
   * 4. This callback displays the token in the browser
   * 5. User copies token and pastes it into CLI prompt
   */
  router.get('/auth-callback', async (req, res) => {
    try {
      // Try to get user credentials from httpAuth (handles cookie/session auth after OAuth)
      let userEntityRef: string | undefined;

      if (httpAuth) {
        try {
          const credentials = await httpAuth.credentials(req, {
            allow: ['user'],
            allowLimitedAccess: true
          });
          userEntityRef = credentials.principal.userEntityRef;
        } catch (error) {
          // Auth failed - will show error page below
        }
      } else {
        // Fallback: check if middleware already set req.user
        // @ts-ignore
        userEntityRef = req.user?.userEntityRef;
      }

      if (!userEntityRef) {
        return res.status(401).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Failed</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                max-width: 500px;
                text-align: center;
              }
              h1 { color: #e53e3e; margin-top: 0; }
              p { color: #4a5568; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⚠️ Authentication Required</h1>
              <p>You must be authenticated with Google to generate an agent token.</p>
              <p><a href="/api/local-provisioner/agent/auth-start">Click here to authenticate</a></p>
            </div>
          </body>
          </html>
        `);
      }

      // Generate agent token for this user
      const authResponse = await agentService.authenticateAgent({
        googleToken: userEntityRef, // Use userEntityRef as the identifier
      });

      // Display token to user for manual copy/paste
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Agent Token Generated</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 600px;
              width: 100%;
            }
            h1 {
              color: #48bb78;
              margin-top: 0;
              text-align: center;
            }
            .info {
              background: #f7fafc;
              border-left: 4px solid #4299e1;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .token-box {
              background: #2d3748;
              color: #68d391;
              padding: 20px;
              border-radius: 8px;
              font-family: 'Courier New', monospace;
              word-break: break-all;
              margin: 20px 0;
              position: relative;
            }
            .copy-btn {
              background: #4299e1;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              width: 100%;
              margin-top: 10px;
              transition: background 0.2s;
            }
            .copy-btn:hover {
              background: #3182ce;
            }
            .copy-btn:active {
              background: #2c5282;
            }
            .success {
              color: #48bb78;
              font-weight: bold;
              display: none;
              text-align: center;
              margin-top: 10px;
            }
            .instructions {
              color: #4a5568;
              line-height: 1.6;
              margin: 15px 0;
            }
            code {
              background: #edf2f7;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: 'Courier New', monospace;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Agent Token Generated</h1>

            <div class="info">
              <strong>Agent ID:</strong> ${authResponse.agentId}<br>
              <strong>User:</strong> ${userEntityRef}
            </div>

            <div class="instructions">
              <strong>Copy the token below and paste it into your terminal:</strong>
            </div>

            <div class="token-box" id="tokenBox">${authResponse.serviceToken}</div>

            <button class="copy-btn" onclick="copyToken()">
              📋 Copy Token to Clipboard
            </button>

            <div class="success" id="successMessage">✓ Token copied to clipboard!</div>

            <div class="instructions" style="margin-top: 30px;">
              <strong>Next steps:</strong>
              <ol style="text-align: left; padding-left: 20px;">
                <li>Return to your terminal</li>
                <li>Paste the token when prompted</li>
                <li>Run <code>backstage-agent start</code> to begin receiving tasks</li>
              </ol>
            </div>

            <p style="color: #718096; font-size: 12px; text-align: center; margin-top: 30px;">
              ⚠️ Keep this token secure. It provides access to your Backstage agent.
            </p>
          </div>

          <script>
            function copyToken() {
              const tokenBox = document.getElementById('tokenBox');
              const successMessage = document.getElementById('successMessage');

              // Copy to clipboard
              navigator.clipboard.writeText(tokenBox.textContent).then(() => {
                // Show success message
                successMessage.style.display = 'block';

                // Hide after 3 seconds
                setTimeout(() => {
                  successMessage.style.display = 'none';
                }, 3000);
              }).catch(err => {
                alert('Failed to copy token. Please select and copy manually.');
              });
            }
          </script>
        </body>
        </html>
      `);
    } catch (error: any) {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #e53e3e; margin-top: 0; }
            .error { color: #c53030; background: #fff5f5; padding: 15px; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authentication Failed</h1>
            <p>Failed to generate agent token.</p>
            <div class="error"><strong>Error:</strong> ${error.message}</div>
            <p style="margin-top: 20px;">
              <a href="/api/local-provisioner/agent/auth-start">Try again</a>
            </p>
          </div>
        </body>
        </html>
      `);
    }
  });

  /**
   * GET /agent/auth-start
   * Initiates the OAuth flow for CLI authentication
   * This is the entry point for the CLI login flow
   */
  router.get('/auth-start', async (req, res) => {
    // Redirect to Google OAuth with our callback URL
    const callbackUrl = `${req.protocol}://${req.get('host')}/api/local-provisioner/agent/auth-callback`;
    const googleAuthUrl = `/api/auth/google/start?redirect=${encodeURIComponent(callbackUrl)}&env=development`;

    res.redirect(googleAuthUrl);
  });

  /**
   * POST /agent/auth
   * Authenticate agent with Google OAuth token
   */
  router.post('/auth', async (req, res) => {
    try {
      const authRequest: AgentAuthRequest = req.body;

      if (!authRequest.googleToken) {
        return res.status(400).json({
          error: 'Missing googleToken in request body',
        });
      }

      const authResponse = await agentService.authenticateAgent(authRequest);

      return res.status(200).json(authResponse);
    } catch (error: any) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: error.message,
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
      // Extract and validate service token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid Backstage authentication required',
        });
      }

      const serviceToken = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Decode service token (base64-encoded JSON for MVP)
      let userEmail: string;
      try {
        const payload = JSON.parse(Buffer.from(serviceToken, 'base64').toString());
        userEmail = payload.sub;

        // Check token expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Token has expired',
          });
        }
      } catch (error) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid service token',
        });
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
      const userEmail = validateServiceToken(req);
      if (!userEmail) {
        if (!res.headersSent) {
          res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid service token required',
          });
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
      const userEmail = validateServiceToken(req);
      if (!userEmail) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid service token required',
        });
      }

      const { agentId } = req.body;

      if (!agentId) {
        return res.status(400).json({
          error: 'Missing agentId in request body',
        });
      }

      // Update agent last_seen timestamp
      await agentService.updateAgentHeartbeat(agentId, userEmail);

      return res.status(200).json({
        message: 'Heartbeat received',
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
      const userEmail = validateServiceToken(req);
      if (!userEmail) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid service token required',
        });
      }

      const { taskId } = req.params;
      const { status, metadata, error: errorMessage } = req.body;

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

      // Update task status via agent service
      await agentService.updateTaskStatus(taskId, status, metadata, errorMessage);

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

      // Add connection status to each agent
      const agentsWithStatus = agentRegistrations.map(agent => {
        const isConnected = agentService.isAgentConnected(agent.agent_id);
        console.log(`[AgentRoutes] Agent ${agent.agent_id}: isConnected=${isConnected}`);
        return {
          ...agent,
          is_connected: isConnected,
        };
      });

      console.log('[AgentRoutes] Returning agents:', JSON.stringify(agentsWithStatus, null, 2));

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
