/**
 * Server-Sent Events (SSE) client for receiving tasks from Backstage backend
 */

import EventSource from 'eventsource';
import { SSEEventType, SSETaskEvent } from '../types';
import logger from '../utils/logger';

export type TaskCallback = (task: SSETaskEvent) => void;

export class SSEClient {
  private backstageUrl: string;
  private agentId: string;
  private serviceToken: string;
  private eventSource: EventSource | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // Start with 5 seconds
  private maxReconnectDelay: number = 60000; // Max 60 seconds
  private isConnected: boolean = false;
  private taskCallback: TaskCallback | null = null;

  constructor(backstageUrl: string, agentId: string, serviceToken: string) {
    this.backstageUrl = backstageUrl.replace(/\/$/, '');
    this.agentId = agentId;
    this.serviceToken = serviceToken;
  }

  /**
   * Connect to SSE endpoint
   */
  connect(taskCallback: TaskCallback): void {
    this.taskCallback = taskCallback;

    const sseUrl = `${this.backstageUrl}/api/local-provisioner/agent/events/${this.agentId}`;
    logger.info(`Connecting to SSE endpoint: ${sseUrl}`);

    this.eventSource = new EventSource(sseUrl, {
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
      },
    });

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 5000; // Reset delay
      logger.info('SSE connection established');
    };

    this.eventSource.addEventListener(SSEEventType.TASK, (event: any) => {
      try {
        const taskData = JSON.parse(event.data) as SSETaskEvent;
        logger.info(`Received task: ${taskData.taskId} (${taskData.type})`);

        if (this.taskCallback) {
          this.taskCallback(taskData);
        }
      } catch (error: any) {
        logger.error(`Failed to parse task event: ${error.message}`);
      }
    });

    this.eventSource.addEventListener(SSEEventType.HEARTBEAT, () => {
      logger.debug('Received heartbeat from server');
    });

    this.eventSource.onerror = (error: any) => {
      this.isConnected = false;

      if (error.status === 401) {
        logger.error('Authentication failed - service token may be expired. Please run "backstage-agent login" again.');
        this.disconnect();
        process.exit(1);
      } else {
        logger.warn(`SSE connection error: ${error.message || 'Connection lost'}`);
        this.handleReconnect();
      }
    };
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Exiting.`);
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, this.maxReconnectDelay);

    logger.info(`Reconnecting in ${delay / 1000} seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.eventSource) {
        this.eventSource.close();
      }

      if (this.taskCallback) {
        this.connect(this.taskCallback);
      }
    }, delay);
  }

  /**
   * Disconnect from SSE endpoint
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      logger.info('SSE connection closed');
    }
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }
}
