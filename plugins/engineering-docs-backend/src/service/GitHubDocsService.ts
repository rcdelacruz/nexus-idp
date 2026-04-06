import { LoggerService, CacheService } from '@backstage/backend-plugin-api';
import * as yaml from 'js-yaml';
import { compileMdxToHtml } from './MdxRenderer';

export interface DocSourceConfig {
  repoOwner: string;
  repoName: string;
  branch: string;
  contentBase: string;
}

export interface NavItem {
  label: string;
  path: string;
  type: 'page' | 'dir';
  children?: NavItem[];
}

export interface DocContent {
  path: string;
  content: string; // raw markdown (for TOC extraction)
  html: string;    // pre-rendered HTML (for display)
  title: string;
}

export class GitHubDocsService {
  private readonly apiBase: string;
  private readonly rawBase: string;
  private readonly contentBase: string;
  private readonly branch: string;
  private readonly cachePrefix: string;

  constructor(
    private readonly logger: LoggerService,
    private readonly token: string,
    sourceConfig: DocSourceConfig,
    private readonly cache: CacheService,
  ) {
    const { repoOwner, repoName, branch, contentBase } = sourceConfig;
    this.apiBase = `https://api.github.com/repos/${repoOwner}/${repoName}`;
    this.rawBase = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}`;
    this.contentBase = contentBase;
    this.branch = branch;
    this.cachePrefix = `${repoOwner}/${repoName}@${branch}:`;
  }

  private async cached<T>(key: string, fn: () => Promise<T>, skipCache = false): Promise<T> {
    const cacheKey = `${this.cachePrefix}${key}`;
    if (!skipCache) {
      const hit = await this.cache.get<any>(cacheKey);
      if (hit !== undefined) return hit as T;
    }
    const data = await fn();
    await this.cache.set(cacheKey, data as any);
    return data;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async fetchDirContents(githubPath: string): Promise<any[]> {
    const url = `${this.apiBase}/contents/${githubPath}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${githubPath}`);
    return res.json();
  }

  /**
   * Fetch the entire repo file tree in ONE GitHub API call using the Trees API.
   * Returns a flat list of all file/dir paths under contentBase.
   * Dramatically faster than recursive fetchDirContents for nav building.
   */
  private async fetchFullTree(): Promise<{ path: string; type: 'blob' | 'tree' }[]> {
    const url = `${this.apiBase}/git/trees/${this.branch}?recursive=1`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`GitHub Trees API ${res.status}`);
    const data = await res.json();
    if (data.truncated) {
      this.logger.warn(`[engineering-docs] Git tree truncated for ${this.apiBase} — repo may be too large`);
    }
    const prefix = this.contentBase ? `${this.contentBase}/` : '';
    return (data.tree as any[])
      .filter((node: any) => node.path.startsWith(prefix))
      .map((node: any) => ({
        path: node.path.slice(prefix.length),
        type: node.type as 'blob' | 'tree',
      }));
  }

  async fetchRawContent(githubPath: string): Promise<string> {
    const url = `${this.rawBase}/${githubPath}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Raw fetch ${res.status} for ${githubPath}`);
    return res.text();
  }

  private parseMeta(source: string): Record<string, string> {
    const result: Record<string, string> = {};
    const objMatch = source.match(/export\s+default\s+\{([\s\S]*)\}/);
    if (!objMatch) return result;
    // Matches: 'key', "key", or key  →  'value' or "value"
    // Handles unquoted identifiers (web, index) and hyphenated quoted keys ('ai-ml')
    const pairRegex = /(?:'([\w-]+)'|"([\w-]+)"|([\w-]+))\s*:\s*(?:'([^']*)'|"([^"]*)")/g;
    let m = pairRegex.exec(objMatch[1]);
    while (m !== null) {
      const key = m[1] ?? m[2] ?? m[3];
      const value = m[4] ?? m[5];
      // Skip inner object properties like title/label
      if (key && value && key !== 'title' && key !== 'label') {
        result[key] = value;
      }
      m = pairRegex.exec(objMatch[1]);
    }
    return result;
  }

  private keyToLabel(key: string): string {
    return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  async buildNav(skipCache = false): Promise<NavItem[]> {
    this.logger.info(`[engineering-docs] buildNav called for ${this.apiBase} / ${this.contentBase}`);
    return this.cached('nav', async () => {
      // Try MkDocs first (mkdocs.yml at repo root)

      try {
        const src = await this.fetchRawContent('mkdocs.yml');
        const cleanedSrc = src.replace(/!![a-zA-Z]+\/[a-zA-Z][a-zA-Z0-9:._]*/g, 'null');
        const config = yaml.load(cleanedSrc) as any;
        if (config?.nav && Array.isArray(config.nav)) {
          const items = this.convertMkDocsNav(config.nav);
          if (items.length > 0) {
            this.logger.info(`[engineering-docs] Using mkdocs.yml nav: ${items.length} top-level items`);
            return items;
          }
        }
      } catch {
        // No mkdocs.yml — continue
      }

      // Use GitHub Trees API (1 API call) to get the full file tree,
      // then fetch meta files in parallel. Much faster than recursive fetchDirContents.
      try {
        const tree = await this.fetchFullTree();
        const nav = await this.buildNavFromTree(tree);
        this.logger.info(`[engineering-docs] Nav built from Trees API: ${nav.length} top-level items`);
        return nav;
      } catch (e) {
        this.logger.warn(`[engineering-docs] Trees API failed, falling back to recursive traversal: ${e}`);
        return this.buildNavForDir(this.contentBase, '');
      }
    }, skipCache);
  }

  private convertMkDocsNav(navItems: any[]): NavItem[] {
    const result: NavItem[] = [];
    for (const item of navItems) {
      if (typeof item === 'string') {
        // Bare path string: e.g. "getting-started/index.md" — section overview page, no explicit label
        const path = item.replace(/\.(md|mdx)$/, '');
        const basename = path.split('/').pop()!;
        const label = basename === 'index' ? 'Overview' : this.keyToLabel(basename);
        result.push({ label, path, type: 'page' });
      } else if (typeof item === 'object' && item !== null) {
        const keys = Object.keys(item);
        if (keys.length !== 1) continue;
        const label = keys[0];
        const value = item[label];
        if (typeof value === 'string') {
          // Page entry: { "Label": "path/to/file.md" }
          const path = value.replace(/\.(md|mdx)$/, '');
          result.push({ label, path, type: 'page' });
        } else if (Array.isArray(value)) {
          // Section entry: { "Label": [...children] }
          const children = this.convertMkDocsNav(value);
          const dirPath = this.mkDocsDirPath(children, label);
          result.push({ label, path: dirPath, type: 'dir', children });
        }
      }
    }
    return result;
  }

  // Derive a dir path from children — must be a prefix of child page paths
  // so the sidebar open/close logic works (startsWith(dirPath + '/'))
  private mkDocsDirPath(children: NavItem[], fallbackLabel: string): string {
    const firstPage = this.firstPageDescendant(children);
    if (firstPage) {
      const parts = firstPage.split('/');
      if (parts.length > 1) return parts.slice(0, -1).join('/');
    }
    // Fallback: slugify label
    return fallbackLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Build nav from a flat file tree (from GitHub Trees API).
   * Fetches all _meta.js / _category_.json files in parallel (one batch),
   * then assembles the nav tree — no recursive sequential API calls.
   */
  private async buildNavFromTree(tree: { path: string; type: 'blob' | 'tree' }[]): Promise<NavItem[]> {
    const contentExts = /\.(md|mdx)$/;

    // Collect all meta file paths present in the tree
    const metaPaths = tree
      .filter(n => n.type === 'blob' && (
        n.path === '_meta.js' ||
        n.path.endsWith('/_meta.js') ||
        n.path.endsWith('/_category_.json') ||
        n.path.endsWith('/_category_.yml') ||
        n.path.endsWith('/_category_.yaml')
      ))
      .map(n => n.path);

    // Fetch all meta files in parallel
    const metaContents = new Map<string, string>();
    await Promise.allSettled(
      metaPaths.map(async p => {
        try {
          const content = await this.fetchRawContent(`${this.contentBase}/${p}`);
          metaContents.set(p, content);
        } catch { /* skip missing */ }
      })
    );

    // Parse meta into per-directory label/order maps
    const dirMeta = new Map<string, Record<string, string>>();
    for (const [p, content] of metaContents) {
      const dir = p.includes('/') ? p.split('/').slice(0, -1).join('/') : '';
      if (p === '_meta.js' || p.endsWith('/_meta.js')) {
        dirMeta.set(dir, this.parseMeta(content));
      } else if (p.endsWith('/_category_.json')) {
        try {
          const cat = JSON.parse(content);
          const existing = dirMeta.get(dir) ?? {};
          if (cat.label) existing.__dirLabel = cat.label;
          if (cat.position !== undefined) existing.__position = String(cat.position);
          dirMeta.set(dir, existing);
        } catch { /* skip */ }
      } else {
        const labelMatch = content.match(/^label:\s*['"]?(.+?)['"]?\s*$/m);
        const posMatch = content.match(/^position:\s*(\d+)/m);
        const existing = dirMeta.get(dir) ?? {};
        if (labelMatch) existing.__dirLabel = labelMatch[1].trim();
        if (posMatch) existing.__position = posMatch[1];
        dirMeta.set(dir, existing);
      }
    }

    // Build a nested structure from flat paths
    type DirNode = { files: string[]; dirs: Map<string, DirNode> };
    const root: DirNode = { files: [], dirs: new Map() };

    for (const node of tree) {
      if (node.type === 'blob' && contentExts.test(node.path) && !node.path.split('/').some(p => p.startsWith('_'))) {
        const parts = node.path.replace(contentExts, '').split('/');
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur.dirs.has(parts[i])) cur.dirs.set(parts[i], { files: [], dirs: new Map() });
          cur = cur.dirs.get(parts[i])!;
        }
        cur.files.push(parts[parts.length - 1]);
      }
    }

    const buildItems = (node: DirNode, pathPrefix: string): NavItem[] => {
      const meta = dirMeta.get(pathPrefix) ?? {};
      const items: NavItem[] = [];

      // Files
      for (const file of node.files) {
        const navPath = pathPrefix ? `${pathPrefix}/${file}` : file;
        const label = meta[file] ?? this.keyToLabel(file === 'index' ? 'Overview' : file);
        items.push({ label, path: navPath, type: 'page' });
      }

      // Subdirectories
      for (const [dirName, dirNode] of node.dirs) {
        const dirPath = pathPrefix ? `${pathPrefix}/${dirName}` : dirName;
        const dirMetaEntry = dirMeta.get(dirPath) ?? {};
        const label = meta[dirName] ?? dirMetaEntry.__dirLabel ?? this.keyToLabel(dirName);
        const children = buildItems(dirNode, dirPath);
        items.push({ label, path: dirPath, type: 'dir', children });
      }

      // Sort: _meta.js order takes priority (preserves Nextra ordering), then index first, then alphabetical
      const metaOrder = Object.keys(meta).filter(k => !k.startsWith('__'));
      return items.sort((a, b) => {
        const aKey = a.path.split('/').pop()!;
        const bKey = b.path.split('/').pop()!;
        if (metaOrder.length > 0) {
          const ai = metaOrder.indexOf(aKey);
          const bi = metaOrder.indexOf(bKey);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
        }
        if (a.path.endsWith('/index') || a.path === 'index') return -1;
        if (b.path.endsWith('/index') || b.path === 'index') return 1;
        return a.label.localeCompare(b.label);
      });
    };

    return buildItems(root, '');
  }

  private firstPageDescendant(items: NavItem[]): string | null {
    for (const item of items) {
      if (item.type === 'page') return item.path;
      if (item.children) {
        const found = this.firstPageDescendant(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  private async buildNavForDir(githubPath: string, navPrefix: string): Promise<NavItem[]> {
    let contents: any[];
    try {
      contents = await this.fetchDirContents(githubPath);
      this.logger.info(`[EH] listed ${githubPath}: ${contents.length} entries`);
    } catch (e) {
      this.logger.error(`[nav] FAILED to list ${githubPath}: ${e}`);
      return [];
    }

    let meta: Record<string, string> = {};
    const hasMetaJs = !!contents.find((f: any) => f.name === '_meta.js');

    if (hasMetaJs) {
      // Nextra: _meta.js defines label + order for all items in this directory
      try {
        const src = await this.fetchRawContent(`${githubPath}/_meta.js`);
        meta = this.parseMeta(src);
        this.logger.info(`[EH] _meta.js in ${githubPath}: keys=${JSON.stringify(Object.keys(meta))}`);
      } catch (e) {
        this.logger.warn(`[EH] FAILED to read _meta.js in ${githubPath}: ${e}`);
      }
    } else if (contents.find((f: any) => f.name === '_category_.json')) {
      // Docusaurus: _category_.json — provides label/position for THIS directory entry
      try {
        const src = await this.fetchRawContent(`${githubPath}/_category_.json`);
        const cat = JSON.parse(src);
        if (cat.label) meta.__dirLabel = cat.label;
        if (cat.position !== undefined) meta.__position = String(cat.position);
        this.logger.info(`[EH] _category_.json in ${githubPath}: label="${cat.label}" pos=${cat.position}`);
      } catch (e) {
        this.logger.warn(`[EH] FAILED to read _category_.json in ${githubPath}: ${e}`);
      }
    } else if (contents.find((f: any) => f.name === '_category_.yml' || f.name === '_category_.yaml')) {
      // Docusaurus: _category_.yml fallback
      try {
        const fname = contents.find((f: any) => f.name === '_category_.yml' || f.name === '_category_.yaml').name;
        const src = await this.fetchRawContent(`${githubPath}/${fname}`);
        const labelMatch = src.match(/^label:\s*['"]?(.+?)['"]?\s*$/m);
        const posMatch = src.match(/^position:\s*(\d+)/m);
        if (labelMatch) meta.__dirLabel = labelMatch[1].trim();
        if (posMatch) meta.__position = posMatch[1];
        this.logger.info(`[EH] _category_.yml in ${githubPath}: label="${meta.__dirLabel}" pos=${meta.__position}`);
      } catch (e) {
        this.logger.warn(`[EH] FAILED to read _category_.yml in ${githubPath}: ${e}`);
      }
    } else {
      this.logger.info(`[EH] no meta file found in ${githubPath} — will use frontmatter/filename fallback`);
    }

    // For repos without _meta.js: parallel-fetch subdir _category_.json (label + position)
    // and file frontmatter (sidebar_label/title + sidebar_position).
    const subdirPositions: Record<string, number> = {};
    const subdirLabels: Record<string, string> = {};
    const fileTitles: Record<string, string> = {};
    const filePositions: Record<string, number> = {};

    if (!hasMetaJs) {
      const subdirs = contents.filter((f: any) => f.type === 'dir' && !f.name.startsWith('_') && !f.name.startsWith('.'));
      const mdFiles = contents.filter((f: any) =>
        f.type === 'file' &&
        (f.name.endsWith('.mdx') || f.name.endsWith('.md')) &&
        !['index.mdx', 'index.md'].includes(f.name),
      );

      await Promise.all([
        // Subdir _category_.json: label + position
        ...subdirs.map(async (dir: any) => {
          try {
            const src = await this.fetchRawContent(`${githubPath}/${dir.name}/_category_.json`);
            const cat = JSON.parse(src);
            if (cat.label) subdirLabels[dir.name] = cat.label;
            if (cat.position !== undefined) subdirPositions[dir.name] = Number(cat.position);
            this.logger.info(`[EH] dir "${dir.name}" label="${cat.label}" pos=${cat.position}`);
          } catch {
            // try _category_.yml fallback
            try {
              const src2 = await this.fetchRawContent(`${githubPath}/${dir.name}/_category_.yml`);
              const lm = src2.match(/^label:\s*['"]?(.+?)['"]?\s*$/m);
              const pm = src2.match(/^position:\s*(\d+)/m);
              if (lm) subdirLabels[dir.name] = lm[1].trim();
              if (pm) subdirPositions[dir.name] = Number(pm[1]);
            } catch {
              this.logger.info(`[EH] dir "${dir.name}" has no _category_ file`);
            }
          }
        }),
        // File frontmatter: sidebar_label/title (label) + sidebar_position (order)
        ...mdFiles.map(async (file: any) => {
          try {
            const raw = await this.fetchRawContent(`${githubPath}/${file.name}`);
            const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
            if (fm) {
              const sidebarLabel = fm[1].match(/^sidebar_label:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim();
              const title = fm[1].match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim();
              const pos = fm[1].match(/^sidebar_position:\s*(\d+(?:\.\d+)?)/m)?.[1];
              if (sidebarLabel ?? title) fileTitles[file.name] = (sidebarLabel ?? title)!;
              if (pos) filePositions[file.name] = Number(pos);
              this.logger.info(`[EH] file "${file.name}" label="${fileTitles[file.name]}" pos=${pos}`);
            }
            if (!fileTitles[file.name]) {
              const h1 = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
              if (h1) fileTitles[file.name] = h1;
              this.logger.info(`[EH] file "${file.name}" no frontmatter, H1="${h1}"`);
            }
          } catch (e) {
            this.logger.warn(`[EH] FAILED to fetch ${githubPath}/${file.name}: ${e}`);
          }
        }),
      ]);
    }

    const items: NavItem[] = [];

    // Process in GitHub API order (alphabetical, files and dirs interleaved)
    for (const entry of contents) {
      if (entry.type === 'file') {
        if (!(entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) continue;
        if (['index.mdx', 'index.md'].includes(entry.name)) continue;
        const key = entry.name.replace(/\.(mdx|md)$/, '');
        const navPath = navPrefix ? `${navPrefix}/${key}` : key;
        // Priority: _meta.js label → frontmatter sidebar_label/title → H1 → filename
        items.push({ label: meta[key] ?? fileTitles[entry.name] ?? this.keyToLabel(key), path: navPath, type: 'page' });
      } else if (entry.type === 'dir') {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const childNavPrefix = navPrefix ? `${navPrefix}/${entry.name}` : entry.name;
        const children = await this.buildNavForDir(`${githubPath}/${entry.name}`, childNavPrefix);
        // Priority: _meta.js label → _category_.json label → filename
        items.push({
          label: meta[entry.name] ?? subdirLabels[entry.name] ?? this.keyToLabel(entry.name),
          path: childNavPrefix,
          type: 'dir',
          children,
        });
      }
    }

    // Sort: Nextra _meta.js order takes priority
    const metaOrder = Object.keys(meta).filter(k => !k.startsWith('__'));
    if (metaOrder.length > 0) {
      items.sort((a, b) => {
        const aKey = a.path.split('/').pop()!;
        const bKey = b.path.split('/').pop()!;
        const ai = metaOrder.indexOf(aKey);
        const bi = metaOrder.indexOf(bKey);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } else {
      const hasFilePositions = Object.keys(filePositions).length > 0;
      const hasDirPositions = Object.keys(subdirPositions).length > 0;
      if (hasFilePositions || hasDirPositions) {
        // Docusaurus: sort everything by sidebar_position / _category_.json position
        items.sort((a, b) => {
          const aKey = a.path.split('/').pop()!;
          const bKey = b.path.split('/').pop()!;
          const aPos = a.type === 'dir'
            ? (subdirPositions[aKey] ?? Infinity)
            : (filePositions[`${aKey}.mdx`] ?? filePositions[`${aKey}.md`] ?? Infinity);
          const bPos = b.type === 'dir'
            ? (subdirPositions[bKey] ?? Infinity)
            : (filePositions[`${bKey}.mdx`] ?? filePositions[`${bKey}.md`] ?? Infinity);
          return aPos - bPos;
        });
      }
    }

    return items;
  }

  private stripFrontmatter(raw: string): { content: string; frontmatterTitle?: string } {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { content: raw };
    const titleM = m[1].match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
    return { content: raw.slice(m[0].length), frontmatterTitle: titleM?.[1]?.trim() };
  }

  // Strip MDX import/export-from statements (including multi-line)
  // Handles Nextra (@nextra), Docusaurus (@theme/, @docusaurus/, @site/), and generic imports
  private stripMdxImports(content: string): string {
    return content
      // Multi-line and single-line: import ... from '...'
      .replace(/^import\s+(?:[\s\S]*?\bfrom\s+)?(['"])[^'"]*\1[^\n]*/gm, '')
      // export { ... } from '...' re-exports
      .replace(/^export\s+\{[^}]*\}\s+from\s+['"][^'"]*['"]\s*;?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimStart();
  }

  // Convert Docusaurus admonition syntax (:::type\ncontent\n:::) to <Callout type="type"> JSX
  private convertDocusaurusAdmonitions(content: string): string {
    return content.replace(
      /^:::(\w+)(?:\s+(.+?))?\n([\s\S]*?)^:::/gm,
      (_match, type: string, _title: string | undefined, body: string) => {
        // Map Docusaurus types to our Callout types
        const typeMap: Record<string, string> = {
          note: 'note',
          tip: 'tip',
          info: 'info',
          warning: 'warning',
          danger: 'caution',
          caution: 'caution',
        };
        const calloutType = typeMap[type.toLowerCase()] ?? 'note';
        return `<Callout type="${calloutType}">\n${body.trim()}\n</Callout>\n`;
      },
    );
  }

  // Convert MkDocs admonitions (!!! type "title"\n    content) to <Callout> JSX
  private convertMkDocsAdmonitions(content: string): string {
    const TYPE_MAP: Record<string, string> = {
      note: 'note', seealso: 'note', example: 'note', quote: 'note', cite: 'note',
      abstract: 'info', summary: 'info', tldr: 'info',
      info: 'info', todo: 'info', question: 'info', help: 'info', faq: 'info',
      tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
      warning: 'warning', attention: 'warning',
      failure: 'error', fail: 'error', missing: 'error', danger: 'error', error: 'error', bug: 'error',
      // 'important' is a valid MkDocs type too
      important: 'important',
    };

    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      // Match !!! type "optional title"  or  ??? type "optional title"  or  ???+ ...
      const admonMatch = line.match(/^[!?]{3}\+?\s+(\w+)(?:\s+"([^"]*)")?/);
      if (admonMatch) {
        const rawType = admonMatch[1].toLowerCase();
        const customTitle = admonMatch[2]; // optional quoted title, e.g. !!! note "Custom Title"
        const calloutType = TYPE_MAP[rawType] ?? 'note';
        i++;
        const bodyLines: string[] = [];
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === '') {
            // Empty line: continue only if next non-empty line is still indented
            const nextNonEmpty = lines.slice(i + 1).find(nl => nl.trim() !== '');
            if (nextNonEmpty && (nextNonEmpty.startsWith('    ') || nextNonEmpty.startsWith('\t'))) {
              bodyLines.push('');
              i++;
            } else {
              break;
            }
          } else if (l.startsWith('    ')) {
            bodyLines.push(l.slice(4));
            i++;
          } else if (l.startsWith('\t')) {
            bodyLines.push(l.slice(1));
            i++;
          } else {
            break;
          }
        }
        // Trim trailing blank lines
        while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
        const body = bodyLines.join('\n');
        const titleProp = customTitle ? ` title={\`${customTitle.replace(/`/g, "'")}\`}` : '';
        result.push(`<Callout type="${calloutType}"${titleProp}>\n${body}\n</Callout>`);
      } else {
        result.push(line);
        i++;
      }
    }

    return result.join('\n');
  }

  // Convert PyMdown tabs (=== "Label"\n    content) to <Tabs><Tab> JSX
  private convertMkDocsTabs(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const tabMatch = lines[i].match(/^===\s+"([^"]*)"/);
      if (tabMatch) {
        const tabs: Array<{ label: string; body: string }> = [];

        while (i < lines.length) {
          const tm = lines[i].match(/^===\s+"([^"]*)"/);
          if (!tm) break;
          const label = tm[1];
          i++;

          const bodyLines: string[] = [];
          while (i < lines.length) {
            const l = lines[i];
            if (l.trim() === '') {
              // Empty line: continue if next non-empty is indented content (not a new tab)
              const nextNonEmpty = lines.slice(i + 1).find(nl => nl.trim() !== '');
              if (nextNonEmpty && !nextNonEmpty.match(/^===\s+"/) && nextNonEmpty.startsWith('    ')) {
                bodyLines.push('');
                i++;
              } else {
                i++; // consume the empty line between tabs
                break;
              }
            } else if (l.startsWith('    ')) {
              bodyLines.push(l.slice(4));
              i++;
            } else if (l.startsWith('\t')) {
              bodyLines.push(l.slice(1));
              i++;
            } else {
              break;
            }
          }

          while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
          tabs.push({ label, body: bodyLines.join('\n') });
        }

        if (tabs.length > 0) {
          const inner = tabs.map(t => `<Tab label="${t.label}">\n${t.body}\n</Tab>`).join('\n');
          result.push(`<Tabs>\n${inner}\n</Tabs>`);
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  }

  // Strip MkDocs Material / FontAwesome / Octicons icon shortcodes that can't render in HTML
  private stripMkDocsIcons(content: string): string {
    return content.replace(/:(?:material|fontawesome|octicons?|simple|twemoji|emojione|gemoji)-[\w-]+:/g, '');
  }

  // Strip MkDocs heading ID anchors: ### Title {#my-anchor} → ### Title
  // Also strip inline attribute lists: {.class}, {: .class}, {attr="val"} etc.
  private stripMkDocsHeadingAnchors(content: string): string {
    return content
      // Heading anchors: {#id}
      .replace(/\s*\{#[\w-]+\}/g, '')
      // Inline attribute lists: {.class}, {: .class}, {#id .class attr="val"}
      // Only strip standalone attr lists on their own or at end of block element lines
      .replace(/\s*\{[:.#][^}]*\}/g, '');
  }

  // Escape `<` not followed by a tag name (letter, /, !) to avoid MDX JSX parse errors.
  // Affects patterns like <100ms, <500MB, < 10 in table cells and regular text.
  // Skips content inside fenced code blocks (triple backticks).
  private escapeMdxAngleBrackets(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inCode = false;
    for (const line of lines) {
      if (/^```/.test(line)) { inCode = !inCode; result.push(line); continue; }
      if (inCode) { result.push(line); continue; }
      // Escape < not followed by a letter, slash, or ! (valid HTML/JSX tag starters)
      result.push(line.replace(/<(?![a-zA-Z/!])/g, '&lt;'));
    }
    return result.join('\n');
  }

  // Strip remaining custom MkDocs div wrappers (e.g. .kafka-container) — keep inner content
  private stripCustomMkDocsDivs(content: string): string {
    const CUSTOM_DIV = /^<div\s+class="(?:kafka-container|capstone-card|success-box|info-box|warning-box|error-box|feature-box|card-item)">\s*$/;
    const lines = content.split('\n');
    const result: string[] = [];
    let depth = 0;
    let inCustomDiv = false;
    for (const line of lines) {
      if (!inCustomDiv && CUSTOM_DIV.test(line.trim())) {
        inCustomDiv = true;
        depth = 1;
        continue; // skip opening tag
      }
      if (inCustomDiv) {
        const opens = (line.match(/<div/g) ?? []).length;
        const closes = (line.match(/<\/div>/g) ?? []).length;
        depth += opens - closes;
        if (depth <= 0) {
          inCustomDiv = false;
          continue; // skip closing tag
        }
      }
      result.push(line);
    }
    return result.join('\n');
  }

  // Convert MkDocs card-grid divs (.card-grid with .success-box/.info-box/.kafka-container children)
  // to <Cards><Card title="...">body</Card></Cards> for rendering with our existing Card component.
  private convertMkDocsCardDivs(content: string): string {
    // Inner box divs don't nest further, so match the outer card-grid as a sequence of inner <div>...</div> blocks
    return content.replace(
      /<div\s+class="card-grid">((?:\s*<div[^>]*>[\s\S]*?<\/div>)*\s*)<\/div>/g,
      (_match, inner: string) => {
        const cardPattern = /<div[^>]*>([\s\S]*?)<\/div>/g;
        const cards: string[] = [];
        let m = cardPattern.exec(inner);
        while (m !== null) {
          const cardInner = m[1].trim();
          const titleMatch = cardInner.match(/^<strong>([^<]*)<\/strong>/);
          const title = titleMatch ? titleMatch[1].trim() : '';
          const body = titleMatch ? cardInner.slice(titleMatch[0].length).replace(/^<br\s*\/?>\s*/, '').trim() : cardInner;
          cards.push(`<Card title="${title}">${body}</Card>`);
          m = cardPattern.exec(inner);
        }
        if (cards.length === 0) return _match;
        return `<Cards>\n${cards.join('\n')}\n</Cards>`;
      },
    );
  }

  // Convert MkDocs definition lists (term\n:   definition) to HTML <dl>/<dt>/<dd>
  // Must run after admonition/tab conversion (those use 4-space indent, not `:   `)
  private findNextNonEmptyIdx(lines: string[], fromIdx: number): number {
    for (let j = fromIdx + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '') return j;
    }
    return -1;
  }

  private convertDefinitionLists(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      // Look ahead: current line is a term candidate (non-empty, no special prefix),
      // next non-empty line starts with `:` (definition marker)
      const line = lines[i];
      const nextIdx = this.findNextNonEmptyIdx(lines, i);

      const isNonSpecial = line.trim() !== '' &&
        !line.startsWith('#') &&
        !line.startsWith('>') &&
        !line.startsWith('|') &&
        !line.startsWith('-') &&
        !line.startsWith('*') &&
        !line.startsWith('<') &&
        !/^\d+\./.test(line);

      if (isNonSpecial && nextIdx !== -1 && /^:\s{1,3}/.test(lines[nextIdx])) {
        // Collect terms (may have consecutive term lines before definitions)
        const terms: string[] = [line.trim()];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '' && /^:\s{1,3}/.test(lines[j]) === false) {
          terms.push(lines[j].trim());
          j++;
        }
        // Collect definition lines
        const defs: string[][] = [];
        while (j < lines.length) {
          const defMatch = lines[j].match(/^:\s{1,3}(.*)/);
          if (!defMatch) break;
          const defLines = [defMatch[1]];
          j++;
          // Continuation lines (4-space indent after the `:   `)
          while (j < lines.length && /^ {4}/.test(lines[j])) {
            defLines.push(lines[j].slice(4));
            j++;
          }
          // Skip blank line between definitions
          if (j < lines.length && lines[j].trim() === '') j++;
          defs.push(defLines);
        }

        if (defs.length > 0) {
          result.push('<dl>');
          terms.forEach(t => result.push(`<dt>${t}</dt>`));
          defs.forEach(d => result.push(`<dd>${d.join(' ')}</dd>`));
          result.push('</dl>');
          i = j;
          continue;
        }
      }
      result.push(line);
      i++;
    }
    return result.join('\n');
  }

  // Convert GitHub-style callouts (> [!TYPE]\n> body) to <Callout type="type"> JSX
  // so MdxRenderer's Callout component can render them with proper styling
  private convertGitHubCallouts(content: string): string {
    return content.replace(
      /^> \[!(NOTE|INFO|TIP|WARNING|IMPORTANT|CAUTION|ERROR|DEFAULT)\]\n((?:>[ \t]?.*\n?)*)/gim,
      (_match, type: string, body: string) => {
        const inner = body
          .split('\n')
          .map((line: string) => line.replace(/^>[ \t]?/, ''))
          .join('\n')
          .trim();
        return `<Callout type="${type.toLowerCase()}">\n${inner}\n</Callout>\n`;
      },
    );
  }

  // Transform Nextra JSX components to plain markdown/HTML that react-markdown can render
  private transformMdxComponents(content: string): string {
    return content
      // <Callout type="X">...</Callout>  →  > [!X]\n> lines
      .replace(
        /<Callout\s+type="(\w+)"[^>]*>\s*([\s\S]*?)\s*<\/Callout>/g,
        (_match, type, inner) => {
          const t = type.toUpperCase();
          const body = inner.trim().split('\n')
            .map((l: string) => l.trim() ? `> ${l.trim()}` : '>')
            .join('\n');
          return `> [!${t}]\n>\n${body}\n`;
        },
      )
      // <Callout>...</Callout>  (no type)
      .replace(
        /<Callout[^>]*>\s*([\s\S]*?)\s*<\/Callout>/g,
        (_match, inner) => {
          const body = inner.trim().split('\n')
            .map((l: string) => l.trim() ? `> ${l.trim()}` : '>')
            .join('\n');
          return `> [!NOTE]\n>\n${body}\n`;
        },
      )
      // <Steps> / </Steps> — strip wrapper, content renders as markdown headings
      .replace(/<\/?Steps>/g, '')
      // <FileTree.Folder name="x"> / <FileTree.File name="x" /> / <FileTree>
      .replace(/<FileTree\.File\s+name="([^"]+)"[^/]*/g, '- 📄 $1')
      .replace(/<FileTree\.Folder\s+name="([^"]+)"[^>]*>/g, '- 📁 **$1**')
      .replace(/<\/FileTree\.Folder>/g, '')
      .replace(/<\/?FileTree>/g, '')
      // <Tabs items={...}> / <Tab label="x"> — strip wrappers
      .replace(/<Tabs[^>]*>/g, '')
      .replace(/<\/Tabs>/g, '')
      .replace(/<Tab\s+label="([^"]+)"[^>]*>/g, '\n**$1**\n')
      .replace(/<\/Tab>/g, '')
      // <Cards> / <Card title="x"> — strip wrappers
      .replace(/<Cards[^>]*>/g, '')
      .replace(/<\/Cards>/g, '')
      .replace(/<Card\s+title="([^"]+)"[^>]*>/g, '\n#### $1\n')
      .replace(/<\/Card>/g, '')
      // Docusaurus: <Admonition type="x">...</Admonition> → same as Callout
      .replace(
        /<Admonition\s+type="(\w+)"[^>]*>\s*([\s\S]*?)\s*<\/Admonition>/g,
        (_match, type, inner) => {
          const t = type.toUpperCase();
          const body = inner.trim().split('\n')
            .map((l: string) => l.trim() ? `> ${l.trim()}` : '>')
            .join('\n');
          return `> [!${t}]\n>\n${body}\n`;
        },
      )
      // Docusaurus: <TabItem value="x" label="y"> → <Tab label="y">
      .replace(/<TabItem\s[^>]*label="([^"]+)"[^>]*>/g, '\n**$1**\n')
      .replace(/<\/TabItem>/g, '')
      // Clean up leftover self-closing tags
      .replace(/<[A-Z][a-zA-Z.]*[^>]*\/>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimStart();
  }

  // Resolve relative image/asset paths to absolute GitHub raw URLs so they render in the browser
  private resolveRelativeImagePaths(content: string, docGithubDir: string): string {
    const base = `${this.rawBase}/${docGithubDir}`;
    // Markdown images: ![alt](./path) or ![alt](path) — not http/https/data
    const mdImg = content.replace(
      /!\[([^\]]*)\]\((?!https?:|\/\/|data:)([^)]+)\)/g,
      (_m, alt: string, src: string) => {
        const resolved = src.startsWith('/')
          ? `${this.rawBase}${src}`
          : `${base}/${src.replace(/^\.\//, '')}`;
        return `![${alt}](${resolved})`;
      },
    );
    // HTML img tags: <img src="./path"> — not http/https/data
    return mdImg.replace(
      /<img\s+([^>]*?)src="(?!https?:|\/\/|data:)([^"]+)"([^>]*?)>/g,
      (_m, pre: string, src: string, post: string) => {
        const resolved = src.startsWith('/')
          ? `${this.rawBase}${src}`
          : `${base}/${src.replace(/^\.\//, '')}`;
        return `<img ${pre}src="${resolved}"${post}>`;
      },
    );
  }

  async getDocContent(docPath: string): Promise<DocContent> {
    return this.cached(`doc:${docPath}`, () => this._fetchDocContent(docPath));
  }

  async refreshDocContent(docPath: string): Promise<DocContent> {
    return this.cached(`doc:${docPath}`, () => this._fetchDocContent(docPath), true);
  }

  async refreshNav(): Promise<NavItem[]> {
    return this.buildNav(true);
  }

  private async _fetchDocContent(docPath: string): Promise<DocContent> {
    const githubPath = `${this.contentBase}/${docPath}`;
    let raw: string;

    // Try .mdx first, then .md, then index files (supports both Nextra and Docusaurus)
    const attempts = [
      `${githubPath}.mdx`,
      `${githubPath}.md`,
      `${githubPath}/index.mdx`,
      `${githubPath}/index.md`,
    ];
    raw = '';
    for (const attempt of attempts) {
      try {
        raw = await this.fetchRawContent(attempt);
        break;
      } catch {
        // try next
      }
    }
    if (!raw) throw new Error(`No doc file found for path: ${docPath}`);

    // Resolve relative image paths to absolute GitHub raw URLs before any processing
    const docDir = githubPath.includes('/') ? githubPath.split('/').slice(0, -1).join('/') : this.contentBase;
    const rawWithImages = this.resolveRelativeImagePaths(raw, docDir);

    const { content: stripped, frontmatterTitle } = this.stripFrontmatter(rawWithImages);
    // For MDX compilation: strip imports, convert all callout/admonition/tab syntaxes to JSX
    const mdxForCompile = this.convertGitHubCallouts(
      this.convertDocusaurusAdmonitions(
        this.convertMkDocsTabs(
          this.convertMkDocsAdmonitions(
            this.convertDefinitionLists(
              this.stripCustomMkDocsDivs(
                this.convertMkDocsCardDivs(
                  this.escapeMdxAngleBrackets(
                    this.stripMkDocsHeadingAnchors(
                      this.stripMkDocsIcons(
                        this.stripMdxImports(stripped),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    // For TOC extraction: also strip MDX component tags to get clean markdown
    const content = this.transformMdxComponents(mdxForCompile);
    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = frontmatterTitle ?? h1Match?.[1]?.trim() ?? this.keyToLabel(docPath.split('/').pop()!);

    let html: string;
    try {
      html = await compileMdxToHtml(mdxForCompile);
    } catch (e) {
      this.logger.error(`MDX compile failed for ${docPath}: ${(e as Error).message}`);
      // Fallback: send empty html so frontend falls back to react-markdown
      html = '';
    }

    return { path: docPath, content, html, title };
  }
}
