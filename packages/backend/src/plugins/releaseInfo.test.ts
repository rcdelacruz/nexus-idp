import { CompareStatus, findRelease } from './releaseInfo';

// Releases newest first; `contains` = tags whose history contains the commit.
const answer = (releases: string[], contains: string[], diverged: string[] = []) => {
  const asked: string[] = [];
  const result = findRelease(releases, async tag => {
    asked.push(tag);
    if (diverged.includes(tag)) return 'diverged' as CompareStatus;
    return (contains.includes(tag) ? 'behind' : 'ahead') as CompareStatus;
  });
  return result.then(r => ({ ...r, asked }));
};

describe('findRelease', () => {
  it('a build deployed before v1.6.0 was tagged is "in v1.6.0" (the 2026-10-31 About tab)', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4', 'v1.5.3'], ['v1.6.0'])).toEqual({ includedIn: 'v1.6.0', asked: ['v1.6.0', 'v1.5.4'] });
  });

  it('a commit that shipped in an older release names that release, not a newer one', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4', 'v1.5.3'], ['v1.6.0', 'v1.5.4'])).toEqual({ includedIn: 'v1.5.4', asked: ['v1.6.0', 'v1.5.4', 'v1.5.3'] });
  });

  it('an unreleased build says which release it builds on, with one GitHub call', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4'], [])).toEqual({ after: 'v1.6.0', asked: ['v1.6.0'] });
  });

  it('a commit off the release line (diverged) claims nothing', async () => {
    expect(await answer(['v1.6.0'], [], ['v1.6.0'])).toEqual({ asked: ['v1.6.0'] });
  });

  it('no releases at all', async () => {
    expect(await answer([], [])).toEqual({ asked: [] });
  });
});

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { BoundedCache, createBudget, createReleaseRouter } from './releaseInfo';

describe('BoundedCache', () => {
  it('never holds more than its limit, dropping the oldest first', () => {
    const c = new BoundedCache<number>(3);
    for (const [i, k] of ['a', 'b', 'c', 'd', 'e'].entries()) c.set(k, i);
    expect(c.size).toBe(3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
    expect([c.get('c'), c.get('d'), c.get('e')]).toEqual([2, 3, 4]);
  });

  it('writing a key again makes it the newest, not a second entry', () => {
    const c = new BoundedCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 3); // a is now newer than b
    c.set('c', 4); // evicts b, not a
    expect(c.get('a')).toBe(3);
    expect(c.get('b')).toBeUndefined();
    expect(c.size).toBe(2);
  });
});

describe('createBudget', () => {
  it('allows the limit per window, then refuses until the window has passed', () => {
    let t = 1_000;
    const take = createBudget(3, 60_000, () => t);
    expect([take(), take(), take(), take(), take()]).toEqual([true, true, true, false, false]);
    t += 59_999;
    expect(take()).toBe(false);
    t += 1;
    expect([take(), take(), take(), take()]).toEqual([true, true, true, false]);
  });
});

describe('GET /release (the route, with a fake GitHub)', () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections?.();
    await new Promise(r => (server ? server.close(r) : r(undefined)));
    server = undefined;
  });

  const KNOWN = new Set(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40), 'e'.repeat(40), 'f'.repeat(40)]);
  const fakeGithub = () =>
    jest.fn(async (path: string) => {
      if (path.startsWith('/commits/')) {
        if (!KNOWN.has(decodeURIComponent(path.slice('/commits/'.length)))) throw new Error('GitHub /commits → 404');
        return {};
      }
      if (path.startsWith('/releases')) return [{ tag_name: 'v1.6.0', draft: false }];
      if (path.startsWith('/compare/')) return { status: 'behind' };
      throw new Error(`unexpected ${path}`);
    });
  const start = async (opts: Partial<Parameters<typeof createReleaseRouter>[0]> & { gh: ReturnType<typeof fakeGithub> }) => {
    const app = express();
    app.use(createReleaseRouter({ owner: 'o', repo: 'r', logger: { warn: jest.fn() }, ...opts }));
    server = http.createServer(app);
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (commit: string) => fetch(`${base}/release?commit=${commit}`).then(async r => ({ status: r.status, body: await r.json() }));
  };

  it('answers with the release that contains the commit', async () => {
    const gh = fakeGithub();
    const get = await start({ gh });
    expect(await get('a'.repeat(40))).toEqual({ status: 200, body: { includedIn: 'v1.6.0' } });
  });

  it('a commit id that is not a commit of the repository costs ONE GitHub call, not a walk through the releases', async () => {
    const gh = fakeGithub();
    const get = await start({ gh });
    expect(await get('9'.repeat(40))).toEqual({ status: 200, body: {} });
    expect(gh).toHaveBeenCalledTimes(1);
    expect(gh.mock.calls[0][0]).toMatch(/^\/commits\//);
  });

  it('asking again for the same commit does not ask GitHub again', async () => {
    const gh = fakeGithub();
    const get = await start({ gh });
    await get('a'.repeat(40));
    const calls = gh.mock.calls.length;
    await get('A'.repeat(40)); // letter case does not make a new key
    expect(gh.mock.calls.length).toBe(calls);
  });

  it('remembers only the last few commits: an old one is looked up again', async () => {
    const gh = fakeGithub();
    const get = await start({ gh, maxCachedCommits: 3, lookupsPerMinute: 1000 });
    for (const c of ['a', 'b', 'c', 'd']) await get(c.repeat(40));
    const calls = gh.mock.calls.length;
    await get('a'.repeat(40)); // evicted by d
    expect(gh.mock.calls.length).toBeGreaterThan(calls);
    const afterA = gh.mock.calls.length;
    await get('d'.repeat(40)); // still remembered
    expect(gh.mock.calls.length).toBe(afterA);
  });

  it('a flood of different commit ids reaches GitHub only a few times a minute, and every answer is still 200 {}', async () => {
    let t = 10_000;
    const gh = fakeGithub();
    const get = await start({ gh, lookupsPerMinute: 3, now: () => t });
    const answers = [];
    for (let i = 0; i < 40; i++) answers.push(await get(i.toString(16).padStart(40, '1')));
    expect(answers.every(a => a.status === 200)).toBe(true);
    expect(gh).toHaveBeenCalledTimes(3); // three unknown commits, one call each
    t += 60_000;
    await get('e'.repeat(40));
    expect(gh.mock.calls.length).toBeGreaterThan(3); // the budget came back after the minute
  });

  it('refuses something that is not a git sha, and answers {} when no repository is configured', async () => {
    const gh = fakeGithub();
    const get = await start({ gh });
    expect((await get('not-a-sha')).status).toBe(400);
    const none = await start({ gh, owner: undefined, repo: undefined });
    expect(await none('a'.repeat(40))).toEqual({ status: 200, body: {} });
  });
});
