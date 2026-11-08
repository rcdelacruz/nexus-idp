import { fetchRepoActivity, fetchRepoBrief, Fetch, GithubApiError } from './githubSummary';

type Route = { status?: number; body?: unknown; text?: string; link?: string };

/** Fake GitHub: routes keyed by path+query after /repos/o/r; records every request. */
function fakeGithub(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const key = url.replace('https://api.github.com/repos/o/r', '');
    const r = routes[key];
    if (!r) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === 'link' ? r.link ?? null : null) },
      json: async () => r.body,
      text: async () => r.text ?? '',
    };
  };
  return { fetchImpl, calls };
}

const commit = (sha: string, date: string, message = 'msg') => ({
  sha,
  author: { login: 'jane' },
  commit: { message, committer: { date }, author: { name: 'Jane', date } },
});
const NOW = new Date('2026-10-30T12:00:00Z');

describe('fetchRepoActivity', () => {
  it('summarises a worked-on repo: stage files, AI logs, parsed counts, PRs and CI', async () => {
    const { fetchImpl, calls } = fakeGithub({
      '': { body: { default_branch: 'main', html_url: 'https://github.com/o/r', pushed_at: '2026-10-30T10:00:00Z' } },
      '/commits?sha=main&per_page=100': {
        body: [commit('c3', '2026-10-30T10:00:00Z', 'fix: atomic stock update\n\nbody'), commit('c2', '2026-10-29T10:00:00Z'), commit('c1', '2026-10-20T10:00:00Z', 'Initial commit')],
      },
      '/git/trees/c3?recursive=1': {
        body: {
          tree: [
            { path: 'TRIAGE.md', type: 'blob', sha: 't2' },
            { path: 'CORRECTIONS.md', type: 'blob', sha: 'k2' },
            { path: 'DECISIONS.md', type: 'blob', sha: 'd1' },
            { path: 'PROGRESS.md', type: 'blob', sha: 'p2' },
            { path: 'ai-log/day1.md', type: 'blob', sha: 'a1' },
          ],
        },
      },
      '/git/trees/c1?recursive=1': {
        body: {
          tree: [
            { path: 'TRIAGE.md', type: 'blob', sha: 't1' },
            { path: 'CORRECTIONS.md', type: 'blob', sha: 'k1' },
            { path: 'DECISIONS.md', type: 'blob', sha: 'd1' },
            { path: 'PROGRESS.md', type: 'blob', sha: 'p1' },
          ],
        },
      },
      '/contents/CORRECTIONS.md?ref=c3': { text: '# Corrections\n\n1. reset proposed → refused\n2. await harder → updateMany\n' },
      '/contents/DECISIONS.md?ref=c3': { text: '## D-01: <title>\n' },
      '/contents/PROGRESS.md?ref=c3': { text: '- [x] one\n- [ ] two\n' },
      '/pulls?state=all&per_page=100': { body: [{ state: 'open' }, { state: 'closed', merged_at: '2026-10-29T00:00:00Z' }, { state: 'closed', merged_at: null }] },
      '/actions/runs?per_page=1': { body: { workflow_runs: [{ status: 'completed', conclusion: 'failure', updated_at: '2026-10-30T10:05:00Z', html_url: 'https://github.com/o/r/actions/runs/1' }] } },
    });

    const a = await fetchRepoActivity('o', 'r', 'tok', fetchImpl, NOW);

    expect(a).toMatchObject({
      empty: false,
      defaultBranch: 'main',
      commitCount: 3,
      lastCommit: { sha: 'c3', message: 'fix: atomic stock update', author: 'jane' },
      stageFilesWorked: ['CORRECTIONS', 'PROGRESS', 'TRIAGE'],
      aiLogFiles: 1,
      corrections: 2,
      decisions: 0,
      progress: { done: 1, total: 2 },
      pullRequests: { open: 1, merged: 1 },
      ci: { status: 'completed', conclusion: 'failure' },
    });
    expect(a.commitsPerDay.slice(-2)).toEqual([
      { date: '2026-10-29', count: 1 },
      { date: '2026-10-30', count: 1 },
    ]);
    // Token goes only to api.github.com, as a Bearer header.
    expect(calls.every(c => c.url.startsWith('https://api.github.com/repos/o/r'))).toBe(true);
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
  });

  it('treats an empty repository (409) as an empty row, not an error', async () => {
    const { fetchImpl } = fakeGithub({
      '': { body: { default_branch: 'main' } },
      '/commits?sha=main&per_page=100': { status: 409, body: { message: 'Git Repository is empty.' } },
    });
    const a = await fetchRepoActivity('o', 'r', 'tok', fetchImpl, NOW);
    expect(a.empty).toBe(true);
    expect(a.commitCount).toBe(0);
  });

  it('uses the real default branch and finds the first commit via the last page when there are 100+ commits', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => commit(`h${i}`, '2026-10-30T09:00:00Z'));
    const { fetchImpl, calls } = fakeGithub({
      '': { body: { default_branch: 'trunk' } },
      '/commits?sha=trunk&per_page=100': { body: hundred },
      '/commits?sha=trunk&per_page=1': {
        body: [hundred[0]],
        link: '<https://api.github.com/repos/o/r/commits?sha=trunk&per_page=1&page=2>; rel="next", <https://api.github.com/repos/o/r/commits?sha=trunk&per_page=1&page=257>; rel="last"',
      },
      '/commits?sha=trunk&per_page=1&page=257': { body: [commit('root', '2026-09-01T00:00:00Z')] },
      '/git/trees/h0?recursive=1': { body: { tree: [], truncated: true } },
      '/git/trees/root?recursive=1': { body: { tree: [] } },
      '/pulls?state=all&per_page=100': { body: [] },
      '/actions/runs?per_page=1': { body: { workflow_runs: [] } },
    });
    const a = await fetchRepoActivity('o', 'r', undefined, fetchImpl, NOW);
    expect(a.commitCount).toBe(257);
    expect(a.truncatedTree).toBe(true);
    expect(calls.some(c => c.url.endsWith('/git/trees/root?recursive=1'))).toBe(true);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('surfaces a missing or forbidden repo as a GithubApiError with its status', async () => {
    const { fetchImpl } = fakeGithub({});
    await expect(fetchRepoActivity('o', 'r', 'tok', fetchImpl, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(fetchRepoActivity('o', 'r', 'tok', fetchImpl, NOW)).rejects.toBeInstanceOf(GithubApiError);
  });
});

describe('fetchRepoBrief (the list level)', () => {
  const routes = (extra: Record<string, Route> = {}): Record<string, Route> => ({
    '': { body: { default_branch: 'main', html_url: 'https://github.com/o/r' } },
    '/commits?sha=main&per_page=100': {
      body: [commit('c3', '2026-10-30T10:00:00Z', 'fix: atomic stock update\n\nbody'), commit('c2', '2026-10-29T10:00:00Z'), commit('c1', '2026-10-20T10:00:00Z', 'Initial commit')],
    },
    '/contents/PROGRESS.md?ref=main': { text: '- [x] one\n- [x] two\n- [ ] three\n' },
    '/actions/runs?per_page=1': { body: { workflow_runs: [{ status: 'completed', conclusion: 'success', updated_at: '2026-10-30T10:05:00Z', html_url: 'https://github.com/o/r/actions/runs/1' }] } },
    ...extra,
  });

  it('is four calls in two round trips: the repo, then commits, PROGRESS.md and the latest run together', async () => {
    const { fetchImpl, calls } = fakeGithub(routes());
    const brief = await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW);
    expect(calls.map(c => c.url.replace('https://api.github.com/repos/o/r', ''))).toEqual([
      '',
      '/commits?sha=main&per_page=100',
      '/contents/PROGRESS.md?ref=main',
      '/actions/runs?per_page=1',
    ]);
    expect(brief).toMatchObject({
      owner: 'o',
      repo: 'r',
      htmlUrl: 'https://github.com/o/r',
      defaultBranch: 'main',
      empty: false,
      lastCommit: { sha: 'c3', message: 'fix: atomic stock update', date: '2026-10-30T10:00:00Z', author: 'jane' },
      progress: { done: 2, total: 3 },
      ci: { status: 'completed', conclusion: 'success', updatedAt: '2026-10-30T10:05:00Z', htmlUrl: 'https://github.com/o/r/actions/runs/1' },
    });
    expect(brief.commitsPerDay).toHaveLength(14);
    expect(brief.commitsPerDay.reduce((n, d) => n + d.count, 0)).toBe(3); // all three commits are inside the 14 days before NOW
  });

  it('has none of the full-level fields (the list never needs them)', async () => {
    const { fetchImpl } = fakeGithub(routes());
    const brief = (await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW)) as any;
    for (const field of ['commitCount', 'stageFilesWorked', 'aiLogFiles', 'corrections', 'decisions', 'pullRequests']) expect(brief[field]).toBeUndefined();
  });

  it('sends the token only to api.github.com', async () => {
    const { fetchImpl, calls } = fakeGithub(routes());
    await fetchRepoBrief('o', 'r', 'secret', fetchImpl, NOW);
    expect(calls.every(c => c.url.startsWith('https://api.github.com/repos/o/r') && c.headers.Authorization === 'Bearer secret')).toBe(true);
  });

  it('works without a PROGRESS.md and without any CI run', async () => {
    const { fetchImpl } = fakeGithub(routes({ '/contents/PROGRESS.md?ref=main': { status: 404 }, '/actions/runs?per_page=1': { body: { workflow_runs: [] } } }));
    const brief = await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW);
    expect(brief.progress).toBeUndefined();
    expect(brief.ci).toBeUndefined();
    expect(brief.lastCommit?.sha).toBe('c3');
  });

  it('an unreadable PROGRESS.md only means no progress figure', async () => {
    const { fetchImpl } = fakeGithub(routes({ '/contents/PROGRESS.md?ref=main': { status: 500 } }));
    expect((await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW)).progress).toBeUndefined();
  });

  it('a PROGRESS.md with no checklist gives no progress', async () => {
    const { fetchImpl } = fakeGithub(routes({ '/contents/PROGRESS.md?ref=main': { text: '# Progress\n\nnothing yet\n' } }));
    expect((await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW)).progress).toBeUndefined();
  });

  it('treats an empty repository (409) as empty, not an error', async () => {
    const { fetchImpl } = fakeGithub(routes({ '/commits?sha=main&per_page=100': { status: 409 } }));
    const brief = await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW);
    expect(brief.empty).toBe(true);
    expect(brief.lastCommit).toBeUndefined();
  });

  it('a repository with no commits is empty', async () => {
    const { fetchImpl } = fakeGithub(routes({ '/commits?sha=main&per_page=100': { body: [] } }));
    expect((await fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW)).empty).toBe(true);
  });

  it('surfaces a missing repository with its status', async () => {
    const { fetchImpl } = fakeGithub({});
    await expect(fetchRepoBrief('o', 'r', 'tok', fetchImpl, NOW)).rejects.toMatchObject({ status: 404, rateLimited: false });
  });

  it('flags a rate limit (429, or 403 with an exhausted quota or a Retry-After) but not a plain 403', async () => {
    const limited = (status: number, headers: Record<string, string>): Fetch => async () => ({ ok: false, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => ({}), text: async () => '' });
    await expect(fetchRepoBrief('o', 'r', 't', limited(429, {}), NOW)).rejects.toMatchObject({ status: 429, rateLimited: true });
    await expect(fetchRepoBrief('o', 'r', 't', limited(403, { 'x-ratelimit-remaining': '0' }), NOW)).rejects.toMatchObject({ status: 403, rateLimited: true });
    await expect(fetchRepoBrief('o', 'r', 't', limited(403, { 'retry-after': '30' }), NOW)).rejects.toMatchObject({ status: 403, rateLimited: true });
    await expect(fetchRepoBrief('o', 'r', 't', limited(403, { 'x-ratelimit-remaining': '4000' }), NOW)).rejects.toMatchObject({ status: 403, rateLimited: false });
    await expect(fetchRepoBrief('o', 'r', 't', limited(500, {}), NOW)).rejects.toMatchObject({ status: 500, rateLimited: false });
  });

  it('the full level flags a rate limit the same way', async () => {
    const limited: Fetch = async () => ({ ok: false, status: 403, headers: { get: (n: string) => (n.toLowerCase() === 'x-ratelimit-remaining' ? '0' : null) }, json: async () => ({}), text: async () => '' });
    await expect(fetchRepoActivity('o', 'r', 't', limited, NOW)).rejects.toMatchObject({ status: 403, rateLimited: true });
  });

  it('gives up on a call that does not answer in time, as a 504 that is not a rate limit', async () => {
    const hang: Fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
    const started = Date.now();
    await expect(fetchRepoBrief('o', 'r', 't', hang, NOW, 40)).rejects.toMatchObject({ status: 504, rateLimited: false });
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(fetchRepoActivity('o', 'r', 't', hang, NOW, 40)).rejects.toMatchObject({ status: 504 });
  });

  it('passes a signal on every call', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const { fetchImpl } = fakeGithub(routes());
    const spy: Fetch = async (url, init) => {
      signals.push(init?.signal);
      return fetchImpl(url, init);
    };
    await fetchRepoBrief('o', 'r', 'tok', spy, NOW);
    expect(signals).toHaveLength(4);
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true);
  });
});
