export interface Config {
  /**
   * Local Provisioner plugin configuration
   */
  localProvisioner?: {
    /**
     * Enable or disable the local provisioning feature
     * @default true
     */
    enabled?: boolean;

    /**
     * SSE heartbeat interval in seconds
     * @default 30
     */
    sseHeartbeatInterval?: number;

    /**
     * Task retention period in days
     * @default 30
     */
    taskRetentionDays?: number;

    /**
     * List of supported resource types
     * @default ['kafka', 'postgres', 'redis', 'mongodb']
     */
    supportedResources?: string[];

    /**
     * Agent configuration
     */
    agent?: {
      /**
       * Minimum required agent version
       * @default '1.0.0'
       */
      minimumVersion?: string;
    };
  };
}
