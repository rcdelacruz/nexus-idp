/**
 * Service for agent management, SSE connections, and authentication
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { Response } from 'express';
import { TaskStore } from '../database/TaskStore';
import { TaskQueueService } from './TaskQueueService';
import {
  AgentRegistration,
  AgentAuthRequest,
  AgentAuthResponse,
  AgentRegisterRequest,
  SSETaskEvent,
} from '../types';

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

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

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
   * Authenticate agent with Google OAuth token (DEPRECATED - use device code flow)
   * NOTE: In full implementation, this would verify the Google token
   * For MVP, we'll do basic validation
   */
  async authenticateAgent(
    _request: AgentAuthRequest,
  ): Promise<AgentAuthResponse> {
    this.logger.info('Agent authentication requested');

    // TODO: Verify Google OAuth token via Backstage auth service
    // For MVP, we'll extract user email from token (simplified)
    // const userEmail = await this.verifyGoogleToken(request.googleToken);

    // TEMPORARY: For MVP, assume token validation succeeds
    const userEmail = 'developer@stratpoint.com'; // Replace with actual verification

    // Generate service token (in production, use proper JWT)
    const serviceToken = this.generateServiceToken(userEmail);

    // Get or create default agent for user
    const agents = await this.taskStore.getAgentsByUser(userEmail);
    let agentId: string;

    if (agents.length > 0) {
      // Use most recent agent
      agentId = agents[0].agent_id;
      this.logger.info(`Using existing agent: ${agentId}`, { userEmail });
    } else {
      // Create new agent
      const agent = await this.taskStore.registerAgent(userEmail);
      agentId = agent.agent_id;
      this.logger.info(`Created new agent: ${agentId}`, { userEmail });
    }

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    return {
      serviceToken,
      agentId,
      expiresAt,
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
   * Generate service token (simplified for MVP)
   * TODO: Use proper JWT with signing in production
   */
  private generateServiceToken(userEmail: string): string {
    // In production, use proper JWT with RSA/HMAC signing
    // For MVP, use base64-encoded JSON
    const payload = {
      sub: userEmail,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
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
   * Extract email from Backstage user entity reference
   * Example: "user:default/john.doe" -> "john.doe@stratpoint.com"
   */
  private extractEmailFromEntityRef(entityRef: string): string {
    // Format: "user:default/username" or "user:default/email@domain.com"
    const parts = entityRef.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid user entity reference: ${entityRef}`);
    }

    const username = parts[1];

    // If already an email, return as-is
    if (username.includes('@')) {
      return username;
    }

    // Otherwise, append domain (assuming Stratpoint domain)
    return `${username}@stratpoint.com`;
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
    errorMessage?: string
  ): Promise<void> {
    // Convert string to TaskStatus enum
    const taskStatus = status as any; // Type assertion since we validate in the route handler
    await this.taskQueueService.updateTaskStatus(taskId, taskStatus, metadata, errorMessage);

    this.logger.info('Task status updated', { taskId, status });
  }

  /**
   * Get agent by ID
   */
  async getAgentById(agentId: string): Promise<any | null> {
    return await this.taskStore.getAgentById(agentId);
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
