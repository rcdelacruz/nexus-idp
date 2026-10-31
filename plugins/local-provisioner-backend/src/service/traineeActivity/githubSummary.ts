import {
  commitsPerDay,
  countCorrections,
  countDecisions,
  countProgress,
  diffWorkTree,
  TreeEntry,
} from './parsers';

/** What the instructor view shows about one trainee repo. All counts come from the default branch. */
export interface RepoActivity {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch?: string;
  pushedAt?: string;
  /** No commits at all yet (GitHub answers 409 for commit/tree reads). */
  empty: boolean;
  commitCount: number;
  lastCommit?: { sha: string; message: string; date: string; author: string };
  commitsPerDay: { date: string; count: number }[];
  /** Root stage files (TRIAGE, INVENTORY, …) added or changed since the first commit. */
  stageFilesWorked: string[];
  aiLogFiles: number;
  corrections: number;
  decisions: number;
  progress?: { done: number; total: number };
  pullRequests: { open: number; merged: number };
  ci?: { status: string; conclusion: string | null; updatedAt: string; htmlUrl: string };
  /** Set when the tree was too large for one recursive read — stage-file data may be partial. */
  truncatedTree?: boolean;
}

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export class GithubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const API = 'https://api.github.com';

/**
 * Builds a RepoActivity with ~10 GitHub REST calls. Only ever called with an owner/repo parsed by
 * `parseGithubRepoUrl` (github.com only), so the token is never sent to another host.
 */
export async function fetchRepoActivity(
  owner: string,
  repo: string,
  token: string | undefined,
  fetchImpl: Fetch,
  now: Date = new Date(),
): Promise<RepoActivity> {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nexus-idp-local-provisioner',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const get = async (path: string, accept?: string) => {
    const res = await fetchImpl(`${base}${path}`, { headers: accept ? { ...headers, Accept: accept } : headers });
    return res;
  };
  const json = async (path: string) => {
    const res = await get(path);
    if (!res.ok) throw new GithubApiError(`GitHub ${path || '/'} → ${res.status}`, res.status);
    return { body: await res.json(), res };
  };
  const rawFile = async (path: string, ref: string): Promise<string | undefined> => {
    const res = await get(`/contents/${path}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw');
    if (res.status === 404) return undefined;
    if (!res.ok) throw new GithubApiError(`GitHub contents ${path} → ${res.status}`, res.status);
    return res.text();
  };

  const { body: meta } = await json('');
  const defaultBranch: string = meta.default_branch;
  const activity: RepoActivity = {
    owner,
    repo,
    htmlUrl: meta.html_url ?? `https://github.com/${owner}/${repo}`,
    defaultBranch,
    pushedAt: meta.pushed_at,
    empty: false,
    commitCount: 0,
    commitsPerDay: commitsPerDay([], now),
    stageFilesWorked: [],
    aiLogFiles: 0,
    corrections: 0,
    decisions: 0,
    pullRequests: { open: 0, merged: 0 },
  };

  // Commits: the latest 100 for the per-day strip; the first commit and the exact total via a
  // per_page=1 read of the last page (no walking through every page).
  const commitsRes = await get(`/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=100`);
  if (commitsRes.status === 409) {
    activity.empty = true; // "Git Repository is empty"
    return activity;
  }
  if (!commitsRes.ok) throw new GithubApiError(`GitHub /commits → ${commitsRes.status}`, commitsRes.status);
  const commits: any[] = await commitsRes.json();
  if (commits.length === 0) {
    activity.empty = true;
    return activity;
  }
  activity.commitsPerDay = commitsPerDay(commits.map(c => c.commit?.committer?.date ?? c.commit?.author?.date), now);
  const head = commits[0];
  activity.lastCommit = {
    sha: head.sha,
    message: String(head.commit?.message ?? '').split('\n')[0],
    date: head.commit?.committer?.date ?? head.commit?.author?.date,
    author: head.author?.login ?? head.commit?.author?.name ?? '',
  };

  let firstSha: string = commits[commits.length - 1].sha;
  activity.commitCount = commits.length;
  if (commits.length === 100) {
    const pageRes = await get(`/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1`);
    const last = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(pageRes.headers.get('link') ?? '');
    if (last) {
      activity.commitCount = Number(last[1]);
      const { body: oldest } = await json(`/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1&page=${last[1]}`);
      if (oldest[0]?.sha) firstSha = oldest[0].sha;
    }
  }

  // Stage files: compare blob shas of HEAD vs the first commit (what the template generated).
  const [{ body: headTree }, { body: firstTree }] = await Promise.all([
    json(`/git/trees/${encodeURIComponent(head.sha)}?recursive=1`),
    json(`/git/trees/${encodeURIComponent(firstSha)}?recursive=1`),
  ]);
  const work = diffWorkTree((firstTree.tree ?? []) as TreeEntry[], (headTree.tree ?? []) as TreeEntry[]);
  activity.stageFilesWorked = work.stageFilesWorked;
  activity.aiLogFiles = work.aiLogFiles;
  if (headTree.truncated || firstTree.truncated) activity.truncatedTree = true;

  const rootFiles = new Set(((headTree.tree ?? []) as TreeEntry[]).filter(e => e.type === 'blob').map(e => e.path));
  const [corrections, decisions, progress] = await Promise.all([
    rootFiles.has('CORRECTIONS.md') ? rawFile('CORRECTIONS.md', head.sha) : undefined,
    rootFiles.has('DECISIONS.md') ? rawFile('DECISIONS.md', head.sha) : undefined,
    rootFiles.has('PROGRESS.md') ? rawFile('PROGRESS.md', head.sha) : undefined,
  ]);
  if (corrections) activity.corrections = countCorrections(corrections);
  if (decisions) activity.decisions = countDecisions(decisions);
  if (progress) {
    const p = countProgress(progress);
    if (p.total > 0) activity.progress = p;
  }

  // Pull requests (a trainee repo has few; 100 covers it) and the latest CI run.
  const [{ body: pulls }, runsRes] = await Promise.all([
    json('/pulls?state=all&per_page=100'),
    get('/actions/runs?per_page=1'),
  ]);
  activity.pullRequests = {
    open: (pulls as any[]).filter(p => p.state === 'open').length,
    merged: (pulls as any[]).filter(p => p.merged_at).length,
  };
  if (runsRes.ok) {
    const run = (await runsRes.json()).workflow_runs?.[0];
    if (run) {
      activity.ci = { status: run.status, conclusion: run.conclusion, updatedAt: run.updated_at, htmlUrl: run.html_url };
    }
  }
  return activity;
}
