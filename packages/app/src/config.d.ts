export interface Config {
  organization?: {
    /** @visibility frontend */
    domain?: string;
    /** @visibility frontend */
    githubOwner?: string;
  };
}
