import { ConfigReader } from '@backstage/config';
import { managedOwners, parseAdHocSource } from './router';

/**
 * Entity inline docs (`/docs/entity/*?repo=owner/repo`) read a repo with the portal's GitHub token for any signed-in user. They may
 * only point at the organizations the portal manages, never at the private capstone organization (instructor answer keys), and
 * every value must be a real name (audit 2026-11-07).
 */
const OWNERS = ['example-org', 'example-team'];

describe('parseAdHocSource', () => {
  it('accepts a repo of a managed organization, with the defaults the route always had', () => {
    expect(parseAdHocSource({ repo: 'example-org/my-app' }, OWNERS)).toEqual({
      ok: true,
      source: { repoOwner: 'example-org', repoName: 'my-app', branch: 'main', contentBase: 'docs' },
    });
    expect(parseAdHocSource({ repo: 'EXAMPLE-TEAM/App.v2_x', branch: 'release/1.0', base: 'docs/guide' }, OWNERS)).toMatchObject({
      ok: true,
      source: { branch: 'release/1.0', contentBase: 'docs/guide' },
    });
    expect(parseAdHocSource({ repo: 'example-org/a', base: '' }, OWNERS)).toMatchObject({ ok: true, source: { contentBase: '' } });
  });

  it.each(['example-training/python-training-capstone-a', 'example-training/kafka-local-provisioning', 'some-org/anything', 'example-org-evil/x'])(
    'refuses %s: not an organization the portal manages (403)',
    repo => {
      expect(parseAdHocSource({ repo }, OWNERS)).toMatchObject({ ok: false, status: 403 });
    },
  );

  it.each([undefined, '', 'example-org', 'example-org/', '/x', 'a/b/c', 'example-org/..', '../x', 'example-org/a b', 'example-org/a%2e', 5, ['a/b'], { x: 1 }])(
    'refuses the repo %j (400)',
    repo => {
      expect(parseAdHocSource({ repo }, OWNERS)).toMatchObject({ ok: false, status: 400 });
    },
  );

  it.each([
    [{ branch: '../main' }],
    [{ branch: 'a/../b' }],
    [{ branch: '' }],
    [{ branch: 'a b' }],
    [{ branch: ['main'] }],
    [{ base: '../..' }],
    [{ base: 'docs/../../x' }],
    [{ base: 'a b' }],
    [{ base: 'x'.repeat(201) }],
  ])('refuses %j (400)', extra => {
    expect(parseAdHocSource({ repo: 'example-org/a', ...extra }, OWNERS)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('managedOwners', () => {
  it('is the portal organization plus every discovered GitHub organization', () => {
    const config = new ConfigReader({
      organization: { githubOwner: 'example-org' },
      catalog: { providers: { github: { a: { organization: 'example-org' }, b: { organization: 'example-team' } } } },
    });
    expect(managedOwners(config).sort()).toEqual(['example-org', 'example-team']);
    expect(managedOwners(new ConfigReader({}))).toEqual([]);
  });
});

// The same rules through the real router: a refused request never reaches GitHub.
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { createRouter } from './router';

const memoryCache = (): any => {
  const store = new Map<string, unknown>();
  const cache: any = {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    withOptions: () => cache,
  };
  return cache;
};

// The test calls the portal with the REAL fetch, captured before any test replaces global.fetch (the portal's outbound calls use the mock).
const realFetch0 = global.fetch;

// GET `path` with a query object; returns { status, body } (this file avoids extra test dependencies).
const get = async (baseUrl: () => string, path: string, query: Record<string, string> = {}) => {
  const res = await realFetch0(baseUrl() + path + (Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

describe('GET /docs/entity/* through the real router', () => {
  const realFetch = global.fetch;
  let server: http.Server;
  let base: string;
  const calls: string[] = [];

  beforeAll(async () => {
    global.fetch = (async () => new Response(JSON.stringify({ tree: [], truncated: false }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      config: new ConfigReader({
        organization: { githubOwner: 'example-org' },
        integrations: { github: [{ host: 'github.com', token: 'portal-shared-token' }] },
        engineeringDocs: { sources: [{ id: 'public-training', repoOwner: 'example-training', repoName: 'kafka-local-provisioning', branch: 'main', contentBase: 'docs' }] },
      }),
      httpAuth: { credentials: async () => ({ principal: { type: 'user' } }) } as any,
      cache: memoryCache(),
    });
    server = http.createServer(express().use(router));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  });
  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (u: any) => {
      calls.push(String(u));
      return new Response(JSON.stringify({ tree: [], truncated: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it.each(['nav', 'content'])('refuses a private capstone repository for /%s without calling GitHub', async which => {
    const res = await get(() => base, `/docs/entity/${which}`, { repo: 'example-training/python-training-capstone-a', branch: 'main', base: '.', path: 'instructor/client-answers' });
    expect(res.status).toBe(403);
    expect(calls.filter(c => c.includes('python-training-capstone-a'))).toEqual([]);
  });

  it('refuses values that are paths or not names, before any GitHub call', async () => {
    const url = base;
    for (const q of [{ repo: 'example-org/..' }, { repo: 'example-org/a', branch: '../x' }, { repo: 'example-org/a', base: '../../x' }, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(() => url, '/docs/entity/nav', q as Record<string, string>);
      expect(res.status).toBe(400);
    }
    expect(calls.filter(c => c.includes('example-org'))).toEqual([]);
  });

  it('still answers for a repo of the managed organization (the request reaches GitHub with the portal token)', async () => {
    const res = await get(() => base, '/docs/entity/nav', { repo: 'example-org/my-app', branch: 'main', base: 'docs' });
    expect([403, 400]).not.toContain(res.status);
    const mine = calls.filter(c => c.includes('example-org/my-app'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every(c => /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(c))).toBe(true); // only GitHub, nothing else
  });

  it('the configured sources keep working, including the one in the other organization', async () => {
    const res = await get(() => base, '/docs/sources');
    expect(res.status).toBe(200);
    expect(res.body.sources.map((s: any) => s.id)).toContain('public-training');
  });

  it('a differently cased path matches no route (the routers are case-sensitive)', async () => {
    // A managed repo, so that a case-insensitive router WOULD have called GitHub for it.
    const res = await get(() => base, '/Docs/Entity/nav', { repo: 'example-org/my-app', branch: 'main', base: 'docs' });
    expect(res.status).not.toBe(200);
    expect(calls.filter(c => c.includes('my-app'))).toEqual([]);
  });
});
