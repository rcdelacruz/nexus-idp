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
     * Long-poll timeout in seconds — how long the agent's poll request may be held open
     * waiting for work before responding empty. Kept under Cloudflare's ~100s ceiling on how
     * long it holds a connection open waiting for an origin response.
     * @default 25
     */
    pollTimeoutSeconds?: number;

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
