/**
 * How a trainee gets their companion repo (task.config.githubRepoUrl / gitlabRepoUrl, forwarded by
 * the training templates) onto their laptop: a VS Code clone link and a copyable git command.
 *
 * The URL comes from task config, so only plain https GitHub/GitLab repo URLs are accepted, and the
 * folder name is the repo's last path segment restricted to safe characters — the command is meant
 * to be pasted into a shell.
 */
export interface CloneInfo {
  /** `vscode://vscode.git/clone?url=…`: VS Code asks for a parent folder, clones, offers to open. */
  vscodeHref: string;
  /** `git clone <url> && cd <dir>` */
  command: string;
  dir: string;
}

const REPO_URL = /^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._-]+){2,}\/?$/;

export function cloneInfo(repoUrl: string | undefined): CloneInfo | undefined {
  if (!repoUrl) return undefined;
  const url = repoUrl.trim().replace(/\/+$/, '');
  if (!REPO_URL.test(url)) return undefined;
  const dir = url.split('/').pop()!.replace(/\.git$/, '');
  if (!dir || dir === '.' || dir === '..') return undefined;
  const cloneUrl = url.endsWith('.git') ? url : `${url}.git`;
  return {
    vscodeHref: `vscode://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}`,
    command: `git clone ${cloneUrl} && cd ${dir}`,
    dir,
  };
}

/** What the agent reports in task.metadata.workspace after auto-cloning (agent ≥ 0.1.23). */
export interface AgentWorkspace {
  status: 'cloned' | 'existing' | 'failed' | 'skipped';
  path?: string;
  hint?: string;
}

export function agentWorkspace(metadata: unknown): AgentWorkspace | undefined {
  const w = (metadata as any)?.workspace;
  if (!w || typeof w !== 'object' || typeof w.status !== 'string') return undefined;
  if (w.status === 'skipped') return undefined;
  return {
    status: w.status,
    path: typeof w.path === 'string' ? w.path : undefined,
    hint: typeof w.hint === 'string' ? w.hint : undefined,
  };
}

/** `vscode://file/<abs path>` — opens the folder in VS Code (Windows paths get a leading slash). */
export function vscodeOpenFolderHref(absPath: string): string {
  const p = absPath.replace(/\\/g, '/');
  return `vscode://file${p.startsWith('/') ? '' : '/'}${encodeURI(p)}`;
}
