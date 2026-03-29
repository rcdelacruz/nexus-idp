export interface NavItem {
  label: string;
  path: string;
  type: 'page' | 'dir';
  children?: NavItem[];
}

export interface DocContent {
  path: string;
  content: string; // raw markdown (for TOC)
  html: string;    // pre-rendered HTML (for display)
  title: string;
}

export interface DocSource {
  id: string;
  label: string;
  description?: string;
}

export interface EngineeringDocsApi {
  /** List all configured doc sources. */
  getSources(): Promise<DocSource[]>;

  /** Nav tree for a configured source (defaults to the first/only source). */
  getNav(sourceId?: string): Promise<NavItem[]>;

  /** Doc content for a configured source. */
  getContent(docPath: string, sourceId?: string): Promise<DocContent>;

  /** Nav tree for an entity-annotated inline repo. */
  getEntityNav(repo: string, branch: string, contentBase: string): Promise<NavItem[]>;

  /** Doc content for an entity-annotated inline repo. */
  getEntityContent(
    repo: string,
    branch: string,
    contentBase: string,
    docPath: string,
  ): Promise<DocContent>;

  /** Force-refresh a specific doc page from GitHub (bypasses cache, returns fresh content). */
  refreshDoc(docPath: string, sourceId?: string): Promise<DocContent>;

  /** Force-refresh the nav for a source from GitHub. */
  refreshNav(sourceId?: string): Promise<NavItem[]>;
}
