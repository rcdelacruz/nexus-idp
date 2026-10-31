/**
 * Auto-clone: after a lab is provisioned, put the trainee's companion repo (task.config
 * githubRepoUrl / gitlabRepoUrl, forwarded by the template) on their machine and tell the portal
 * where it is.
 *
 * Rules (training-platform Phase 5):
 * - Clone with the trainee's OWN git login (they are a collaborator); no portal token ever comes to
 *   the laptop. `GIT_TERMINAL_PROMPT=0` so a missing login fails fast instead of hanging.
 * - Never overwrite: an existing clone of the same repo is reused; any other folder makes us pick
 *   `<repo>-2`, `<repo>-3`, …
 * - Never commit or push for the trainee; never delete the folder (Remove only tears down the lab).
 * - A failed clone never fails the provision: the lab still comes up and the portal shows the fix.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface WorkspaceResult {
  status: 'cloned' | 'existing' | 'failed' | 'skipped';
  path?: string;
  repoUrl?: string;
  /** Shown in the portal when status is failed. */
  hint?: string;
  error?: string;
}

const REPO_URL = /^https:\/\/(github\.com|gitlab\.[A-Za-z0-9.-]+)\/([A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+?(\.git)?\/?$/;

export type GitRunner = (args: string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const runGit: GitRunner = (args, cwd) =>
  new Promise(resolve => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 5 * 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      },
      (err: any, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
  });

/** Where workspaces go: BACKSTAGE_AGENT_WORKSPACE, else ~/stratpoint. */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BACKSTAGE_AGENT_WORKSPACE || path.join(os.homedir(), 'stratpoint');
}

/** Safe folder name from the repo URL's last segment, or undefined for anything unexpected. */
export function repoDirName(repoUrl: string): string | undefined {
  if (!REPO_URL.test(repoUrl)) return undefined;
  const name = repoUrl.replace(/\/+$/, '').split('/').pop()!.replace(/\.git$/, '');
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..' ? name : undefined;
}

/** What to tell the trainee, from git's error. */
export function cloneFailureHint(stderr: string): string {
  if (/repository .* not found|not found/i.test(stderr)) {
    // Private repo you can't see yet: usually the collaborator invitation hasn't been accepted.
    return 'GitHub says the repository is not found for your git login. Accept the repository invitation first (email, or github.com/notifications), make sure `gh auth login` is the account you linked in the portal, then clone with the button in the portal.';
  }
  if (/authentication|could not read username|terminal prompts disabled|403|permission denied/i.test(stderr)) {
    return "Your git isn't logged in to this host. Run `gh auth login` (GitHub) or `glab auth login` (GitLab), then clone with the button in the portal.";
  }
  return 'The clone failed. Clone it yourself with the button in the portal.';
}

const sameRepo = (a: string, b: string) => a.trim().replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();

export async function ensureWorkspace(
  repoUrl: string | undefined,
  opts: { root?: string; git?: GitRunner } = {},
): Promise<WorkspaceResult> {
  if (!repoUrl) return { status: 'skipped' };
  const dir = repoDirName(repoUrl);
  if (!dir) return { status: 'skipped', repoUrl, error: 'Not a recognised https repository URL' };
  const git = opts.git ?? runGit;
  const root = opts.root ?? workspaceRoot();
  fs.mkdirSync(root, { recursive: true });

  for (let i = 1; i <= 20; i++) {
    const candidate = path.join(root, i === 1 ? dir : `${dir}-${i}`);
    if (!fs.existsSync(candidate)) {
      const r = await git(['clone', '--', repoUrl, candidate]);
      if (r.code === 0) return { status: 'cloned', path: candidate, repoUrl };
      fs.rmSync(candidate, { recursive: true, force: true }); // only a folder WE just tried to create
      return { status: 'failed', repoUrl, error: r.stderr.trim().split('\n').pop(), hint: cloneFailureHint(r.stderr) };
    }
    // Existing folder: reuse it only if it is already a clone of this repo.
    const origin = await git(['-C', candidate, 'remote', 'get-url', 'origin']);
    if (origin.code === 0 && sameRepo(origin.stdout, repoUrl)) return { status: 'existing', path: candidate, repoUrl };
  }
  return { status: 'failed', repoUrl, hint: `Too many folders named ${dir}-N in ${root}. Clone it yourself.` };
}
