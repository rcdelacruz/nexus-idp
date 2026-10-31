import { CapstoneDefinition } from './definitions';

export type JsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const API = 'https://api.github.com';

/**
 * Day-4 handout (instructor guide §2.3): open the sabotaged PR against the trainee's `main`.
 * Idempotent: an existing branch is reused, the file is updated in place (with its sha), and an
 * existing open PR from the branch is returned instead of failing on GitHub's 422.
 *
 * `trainee` is `{owner, repo}` parsed by parseGithubRepoUrl (github.com only), so the integration
 * token never goes anywhere but api.github.com.
 */
export async function openHandoutPr(
  def: CapstoneDefinition,
  trainee: { owner: string; repo: string },
  token: string,
  fetchImpl: JsonFetch = fetch as unknown as JsonFetch,
): Promise<{ prUrl: string; created: boolean }> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nexus-idp-local-provisioner',
    'Content-Type': 'application/json',
  };
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { res, json: res.status === 204 ? undefined : await res.json().catch(() => undefined) };
  };
  const expectOk = (r: { res: { ok: boolean; status: number } }, what: string) => {
    if (!r.res.ok) throw new Error(`GitHub ${what} failed (${r.res.status})`);
  };

  const h = def.handout;
  const [srcOwner, srcRepo] = def.sourceRepo.split('/');
  const repoApi = `${API}/repos/${encodeURIComponent(trainee.owner)}/${encodeURIComponent(trainee.repo)}`;
  const srcApi = `${API}/repos/${srcOwner}/${srcRepo}/contents`;
  const ref = `?ref=${encodeURIComponent(def.branch)}`;

  // The handout, from the private capstone repo (never in the trainee template): one file, or every
  // file of one directory (Terraform's modules/vendor-cache).
  const src = await call('GET', `${srcApi}/${h.sourcePath}${ref}`);
  expectOk(src, `read ${def.sourceRepo}/${h.sourcePath}`);
  const files: { target: string; content: string }[] = [];
  if (Array.isArray(src.json)) {
    for (const entry of src.json.filter((e: any) => e.type === 'file')) {
      const f = await call('GET', `${srcApi}/${h.sourcePath}/${entry.name}${ref}`);
      expectOk(f, `read ${h.sourcePath}/${entry.name}`);
      files.push({ target: `${h.targetPath}/${entry.name}`, content: String(f.json.content ?? '').replace(/\n/g, '') });
    }
  } else {
    files.push({ target: h.targetPath, content: String(src.json.content ?? '').replace(/\n/g, '') });
  }

  // Base: the trainee repo's default branch.
  const meta = await call('GET', repoApi);
  expectOk(meta, 'read trainee repo');
  const base: string = meta.json.default_branch;
  const baseRef = await call('GET', `${repoApi}/git/ref/heads/${encodeURIComponent(base)}`);
  expectOk(baseRef, `read ${base}`);

  // Branch (reuse if it already exists).
  const branchRef = await call('GET', `${repoApi}/git/ref/heads/${h.branch}`);
  if (branchRef.res.status === 404) {
    const created = await call('POST', `${repoApi}/git/refs`, { ref: `refs/heads/${h.branch}`, sha: baseRef.json.object.sha });
    expectOk(created, `create ${h.branch}`);
  } else {
    expectOk(branchRef, `read ${h.branch}`);
  }

  // Files on the branch (create, or update with the existing blob sha).
  for (const f of files) {
    const existing = await call('GET', `${repoApi}/contents/${f.target}?ref=${encodeURIComponent(h.branch)}`);
    const put = await call('PUT', `${repoApi}/contents/${f.target}`, {
      message: h.commitMessage,
      content: f.content,
      branch: h.branch,
      ...(existing.res.ok && existing.json?.sha ? { sha: existing.json.sha } : {}),
    });
    expectOk(put, `write ${f.target}`);
  }

  // Branch-only handouts (Terraform's guide pushes a branch and says one line, no PR).
  const branchUrl = `https://github.com/${trainee.owner}/${trainee.repo}/tree/${h.branch}`;
  if (!h.prTitle) return { prUrl: branchUrl, created: branchRef.res.status === 404 };

  // PR (return the open one if it already exists).
  const open = await call('GET', `${repoApi}/pulls?state=open&head=${encodeURIComponent(`${trainee.owner}:${h.branch}`)}`);
  if (open.res.ok && Array.isArray(open.json) && open.json[0]?.html_url) {
    return { prUrl: open.json[0].html_url, created: false };
  }
  const pr = await call('POST', `${repoApi}/pulls`, { title: h.prTitle, head: h.branch, base, body: h.prBody ?? '' });
  expectOk(pr, 'open PR');
  return { prUrl: pr.json.html_url, created: true };
}

const ghHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nexus-idp-local-provisioner',
  'Content-Type': 'application/json',
});

/**
 * Commit one file to the trainee repo's default branch at a FIXED path chosen by the caller
 * (never by report content). Creates or updates it.
 */
export async function commitRepoFile(
  trainee: { owner: string; repo: string },
  filePath: string,
  content: string,
  message: string,
  token: string,
  fetchImpl: JsonFetch = fetch as unknown as JsonFetch,
): Promise<void> {
  const repoApi = `${API}/repos/${encodeURIComponent(trainee.owner)}/${encodeURIComponent(trainee.repo)}`;
  const headers = ghHeaders(token);
  const existing = await fetchImpl(`${repoApi}/contents/${filePath}`, { headers });
  const sha = existing.ok ? (await existing.json())?.sha : undefined;
  const put = await fetchImpl(`${repoApi}/contents/${filePath}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), ...(sha ? { sha } : {}) }),
  });
  if (!put.ok) throw new Error(`GitHub write ${filePath} failed (${put.status})`);
}

/** A self-hosted Actions runner registration token for the trainee repo (valid about 1 hour). */
export async function createRunnerRegistrationToken(
  trainee: { owner: string; repo: string },
  token: string,
  fetchImpl: JsonFetch = fetch as unknown as JsonFetch,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetchImpl(
    `${API}/repos/${encodeURIComponent(trainee.owner)}/${encodeURIComponent(trainee.repo)}/actions/runners/registration-token`,
    { method: 'POST', headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`GitHub runner registration token failed (${res.status})`);
  const body = await res.json();
  return { token: body.token, expiresAt: body.expires_at };
}
