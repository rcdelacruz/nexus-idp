export interface Config {
  scaffolder?: {
    engineeringStandards?: {
      /** Local filesystem path for skeleton templates (dev only — overrides githubUrl) */
      localPath?: string;
      /** GitHub URL for skeleton templates (production) */
      githubUrl?: string;
    };
    tofu?: {
      stateBackend?: {
        s3Bucket?: string;
        s3Region?: string;
        dynamoTable?: string;
      };
    };
    targets?: {
      kubernetes?: Array<{
        name?: string;
        displayName?: string;
        type?: string;
        /** @visibility backend */
        ingressDomain?: string;
        storageClass?: string;
        ingressClass?: string;
        /** @visibility backend */
        argocdUrl?: string;
        supportedFrameworks?: string[];
      }>;
      aws?: Array<{
        name?: string;
        displayName?: string;
        /** @visibility backend */
        accountId?: string;
        region?: string;
        /** @visibility backend */
        ecrRegistry?: string;
        targets?: {
          ecs?: Array<{
            name?: string;
            displayName?: string;
            clusterName?: string;
            supportedFrameworks?: string[];
          }>;
          ec2?: {
            enabled?: boolean;
            supportedFrameworks?: string[];
          };
          lambda?: {
            enabled?: boolean;
            supportedFrameworks?: string[];
          };
          appRunner?: {
            enabled?: boolean;
            supportedFrameworks?: string[];
          };
        };
      }>;
    };
  };
}
