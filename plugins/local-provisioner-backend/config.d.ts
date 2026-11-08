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
     * How many days the rows of a REMOVED training lab (and its grade results) are kept before the nightly clean-up deletes them.
     * A lab that still exists is never deleted, whatever its age.
     * @default 365
     */
    trainingRetentionDays?: number;

    /**
     * How many days a capstone that an instructor marked done (it sits in the Archive of the Trainees view) is kept. After that the
     * nightly clean-up removes it the way "Remove trainee" does: its kept report is discarded and it leaves the list. The trainee's
     * GitHub repository and their lab are not touched. Values under 30 are raised to 30.
     * @default 365
     */
    archiveRetentionDays?: number;

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
