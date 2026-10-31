import { parseGithubRepoUrl } from './parsers';

export type JsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const ghHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nexus-idp-local-provisioner',
});

/** How far a trainee repo's creation may be from its lab/enrollment record (same scaffolder run). */
export const REPO_CREATED_WINDOW_MS = 2 * 60 * 60_000;

export interface TraineeRepoClaim {
  /** Repo URL from the stored record (never from the request). */
  repoUrl: string;
  /** Names the repo may have: a lab's resource name (+ `training-` form), or a capstone prefix. */
  names?: string[];
  prefix?: string;
  /** When the lab/enrollment record was created; the repo must have been created near it. */
  recordCreatedAt: Date;
  /** The org trainee repos are created in (organization.githubOwner). Unset → never delete. */
  allowedOwner?: string;
}

/**
 * Decide whether a repo is provably the trainee's own lab repo before the portal deletes it.
 *
 * The URL on a lab or enrollment is supplied by the trainee's scaffolder run (or a direct API
 * call), and trainee repos live in the same org as every production repo — so a URL alone proves
 * nothing. A repo qualifies only when it is in the trainee org, is named after the record, is
 * private and not a fork, and GitHub says it was created within two hours of the record. An
 * existing company repo was created long before any trainee record that names it.
 */
export async function checkTraineeRepo(
  claim: TraineeRepoClaim,
  token: string,
  fetchImpl: JsonFetch = fetch as unknown as JsonFetch,
): Promise<{ ok: true; owner: string; repo: string; gone?: boolean } | { ok: false; reason: string }> {
  const target = parseGithubRepoUrl(claim.repoUrl);
  if (!target) return { ok: false, reason: 'not a github.com repository' };
  const { owner, repo } = target;
  if (!claim.allowedOwner) return { ok: false, reason: 'organization.githubOwner is not configured' };
  if (owner.toLowerCase() !== claim.allowedOwner.toLowerCase()) {
    return { ok: false, reason: `${owner}/${repo} is not in the ${claim.allowedOwner} organization` };
  }
  const lower = repo.toLowerCase();
  const named =
    (claim.names ?? []).some(n => n && lower === n.toLowerCase()) ||
    (!!claim.prefix && lower.startsWith(`${claim.prefix.toLowerCase()}-`));
  if (!named) return { ok: false, reason: `${repo} is not named after this trainee's lab` };

  const res = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return { ok: true, owner, repo, gone: true };
  if (!res.ok) return { ok: false, reason: `GitHub returned ${res.status} reading ${owner}/${repo}` };
  const meta = await res.json();
  if (!meta.private) return { ok: false, reason: `${owner}/${repo} is public; trainee repos are private` };
  if (meta.fork) return { ok: false, reason: `${owner}/${repo} is a fork` };
  const created = Date.parse(meta.created_at);
  if (!Number.isFinite(created) || Math.abs(created - claim.recordCreatedAt.getTime()) > REPO_CREATED_WINDOW_MS) {
    return { ok: false, reason: `${owner}/${repo} was not created with this trainee's lab (created ${meta.created_at})` };
  }
  return { ok: true, owner, repo };
}

/** Delete a repo checked by checkTraineeRepo. Already gone counts as deleted. */
export async function deleteTraineeRepo(
  target: { owner: string; repo: string },
  token: string,
  fetchImpl: JsonFetch = fetch as unknown as JsonFetch,
): Promise<void> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
    { method: 'DELETE', headers: ghHeaders(token) },
  );
  if (res.ok || res.status === 404) return;
  if (res.status === 403) {
    throw new Error(
      "the portal's GitHub token is not allowed to delete repositories (it needs the delete_repo scope, or Administration: write)",
    );
  }
  throw new Error(`GitHub returned ${res.status}`);
}
