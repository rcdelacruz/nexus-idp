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

/**
 * Where a trainee accepts the GitHub invitation to their repo: `https://github.com/<owner>/<repo>/invitations`.
 * Every training template shares its private trainee repo with the trainee as a collaborator, so until
 * they accept, GitHub answers "not found" for their git login and the clone fails.
 *
 * The URL comes from task config: only a plain `https://github.com/<owner>/<repo>` (what publish:github
 * returns, optionally with `.git` or a trailing slash) is accepted. GitLab and everything else give none.
 */
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function invitationUrl(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) return undefined;
  const m = GITHUB_REPO.exec(repoUrl.trim());
  if (!m || m[2] === '.' || m[2] === '..') return undefined;
  return `https://github.com/${m[1]}/${m[2]}/invitations`;
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

/**
 * A lab that mounts the trainee's repo (config.workspaceMount) clones it before anything else, but the
 * agent only reports `metadata.workspace` when the whole task is done, minutes later (image pull, build,
 * start). Meanwhile the timeline tells: once it holds a step after "Getting your repo" / "Waiting for
 * access to your repo", the repo is on the laptop, so the invitation has been accepted. The portal's own
 * closing markers ("completed" / "failed") are not steps of the agent: a lab that failed while waiting ends
 * on one of them and is still waiting for the invitation.
 */
const REPO_STEPS = ['Getting your repo', 'Waiting for access to your repo'];
const CLOSING_MARKERS = ['completed', 'failed'];

export function repoReachedByMountedLab(task: { config?: unknown; metadata?: unknown }): boolean {
  if ((task.config as { workspaceMount?: unknown } | undefined)?.workspaceMount !== true) return false;
  const activity = (task.metadata as { activity?: unknown } | undefined)?.activity;
  if (!Array.isArray(activity)) return false;
  const steps = activity.map(e => (typeof (e as { step?: unknown })?.step === 'string' ? (e as { step: string }).step : ''));
  const lastRepoStep = Math.max(...REPO_STEPS.map(s => steps.lastIndexOf(s)));
  if (lastRepoStep < 0) return false;
  return steps.slice(lastRepoStep + 1).some(s => s !== '' && !CLOSING_MARKERS.includes(s));
}

/** `vscode://file/<abs path>` — opens the folder in VS Code (Windows paths get a leading slash). */
export function vscodeOpenFolderHref(absPath: string): string {
  const p = absPath.replace(/\\/g, '/');
  return `vscode://file${p.startsWith('/') ? '' : '/'}${encodeURI(p)}`;
}
