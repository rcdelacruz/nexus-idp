export interface Config {
  app?: {
    backstage?: {
      /**
       * Backstage release version, $included from backstage.json (Settings -> About).
       * @visibility frontend
       */
      version?: string;
    };
  };
  organization?: {
    /** @visibility frontend */
    domain?: string;
    /** @visibility frontend */
    githubOwner?: string;
  };
}
