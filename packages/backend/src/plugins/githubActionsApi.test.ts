/* eslint-disable no-script-url -- the point of these tests is hostile redirect locations such as javascript: URLs */
import request from 'supertest';
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import githubActionsApiPlugin, { createGithubActionsRouter, planRequest, FetchLike } from './githubActionsApi';

jest.setTimeout(60_000);

const OWNERS = ['example-org', 'example-team'];

describe('planRequest: only what the CI/CD tab reads, only for the configured organizations', () => {
  it.each([
    '/repos/example-org/my-app',
    '/repos/example-org/my-app/branches',
    '/repos/example-org/my-app/actions/workflows/12345',
    '/repos/example-org/my-app/actions/runs',
    '/repos/example-org/my-app/actions/runs/987',
    '/repos/example-org/my-app/actions/runs/987/jobs',
    '/repos/example-org/my-app/actions/jobs/55/logs',
    '/repos/EXAMPLE-TEAM/my.app_2',
  ])('allows %s', path => {
    expect(planRequest(path, {}, OWNERS)).toEqual({ url: `https://api.github.com${path}` });
  });

  it.each([
    '/repos/example-org/my-app/contents/.env',
    '/repos/example-org/my-app/contents',
    '/repos/example-org/my-app/git/blobs/abc',
    '/repos/example-org/my-app/zipball/main',
    '/repos/example-org/my-app/actions/secrets',
    '/repos/example-org/my-app/actions/runs/987/rerun',
    '/repos/example-org/my-app/actions/runs/987/artifacts',
    '/repos/example-org/my-app/actions/runs/abc',
    '/repos/example-org/my-app/branches/main/protection',
    '/repos/example-org/my-app/',
    '/user',
    '/user/repos',
    '/orgs/example-org/repos',
    '/search/code',
    '/repos/example-org',
    '/graphql',
    '/repos/example-org/my-app/actions/runs/../../contents/x',
    '/repos/example-org/%2e%2e/x',
  ])('refuses %s', path => {
    expect(planRequest(path, {}, OWNERS)).toMatchObject({ status: 404 });
  });

  it('refuses "." and ".." as owner or repo (URL normalization would step out of the allowed organization)', () => {
    expect(planRequest('/repos/example-org/../victim/secret', {}, OWNERS)).toMatchObject({ status: 404 });
    expect(planRequest('/repos/../victim/secret/actions/runs', {}, OWNERS)).toMatchObject({ status: 404 });
    expect(planRequest('/repos/example-org/../actions/runs', {}, OWNERS)).toMatchObject({ status: 404 });
    expect(planRequest('/repos/./x/actions/runs', {}, OWNERS)).toMatchObject({ status: 404 });
  });

  it('refuses an owner that is not a configured organization', () => {
    expect(planRequest('/repos/some-other-org/app/actions/runs', {}, OWNERS)).toMatchObject({ status: 403 });
  });

  it('passes only plain query parameters', () => {
    expect(planRequest('/repos/example-org/a/actions/runs', { per_page: '5', branch: 'main' }, OWNERS)).toEqual({
      url: 'https://api.github.com/repos/example-org/a/actions/runs?per_page=5&branch=main',
    });
    for (const bad of [{ 'a b': '1' }, { A: '1' }, { per_page: ['1', '2'] }, { x: 'y'.repeat(101) }, { 'x[]': '1' }, { 'a/b': '1' }]) {
      expect(planRequest('/repos/example-org/a/actions/runs', bad as any, OWNERS)).toMatchObject({ status: 400 });
    }
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, '1']));
    expect(planRequest('/repos/example-org/a/actions/runs', many, OWNERS)).toMatchObject({ status: 400 });
  });
});

describe('github-actions-api route (real plugin, test backend)', () => {
  const calls: Array<{ url: string; init: any }> = [];
  const answer = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  let server: any;
  // May the caller read a catalog entity for the repository? Controlled per test.
  const canRead = jest.fn<Promise<boolean>, [unknown, string]>();
  let clock = 1_000_000;

  beforeAll(async () => {
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    };
    const router = (httpAuth: any) => createGithubActionsRouter({ owners: OWNERS, token: 'gh-secret-token', canRead, now: () => clock, fetchImpl, httpAuth, logger: { warn: () => {} } });
    // The registered plugin is exercised by the last test; here the router gets the test backend's real httpAuth.
    const plugin = createBackendPlugin({
      pluginId: 'github-actions-api',
      register(env) {
        env.registerInit({
          deps: { httpRouter: coreServices.httpRouter, httpAuth: coreServices.httpAuth },
          async init({ httpRouter, httpAuth }) {
            httpRouter.use(router(httpAuth));
          },
        });
      },
    });
    ({ server } = await startTestBackend({ features: [plugin, mockServices.httpAuth.factory({ defaultCredentials: mockCredentials.none() })] }));
  });
  beforeEach(() => {
    calls.length = 0;
    answer.mockReset();
    canRead.mockReset();
    canRead.mockResolvedValue(true);
    clock += 10 * 60_000; // every test starts with nothing remembered
  });
  const user = () => ({ Authorization: mockCredentials.user.header() });
  const other = () => ({ Authorization: mockCredentials.user.header('user:default/someone-else') });

  describe('only repositories of a catalog entity the caller may read', () => {
    it('answers 404, exactly like a path that does not exist, and never calls GitHub, when the caller cannot see an entity for the repository', async () => {
      canRead.mockResolvedValue(false);
      const res = await request(server).get('/api/github-actions-api/repos/example-org/secret-repo/actions/runs').set(user());
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not available through this route' });
      expect(calls).toHaveLength(0);
      expect(canRead).toHaveBeenCalledWith(expect.anything(), 'example-org/secret-repo');
    });

    it('asks about the repository of every kind of allowed path, the job logs included, in lower case', async () => {
      canRead.mockResolvedValue(false);
      for (const p of ['', '/branches', '/actions/workflows/1', '/actions/runs', '/actions/runs/2', '/actions/runs/2/jobs', '/actions/jobs/3/logs']) {
        expect((await request(server).get(`/api/github-actions-api/repos/Example-Org/My-App${p}`).set(user())).status).toBe(404);
      }
      expect(calls).toHaveLength(0);
      expect(canRead.mock.calls.every(c => c[1] === 'example-org/my-app')).toBe(true);
    });

    it('does not check a path that was refused anyway (other organization, source files)', async () => {
      await request(server).get('/api/github-actions-api/repos/other-org/a/actions/runs').set(user());
      await request(server).get('/api/github-actions-api/repos/example-org/a/contents/x').set(user());
      expect(canRead).not.toHaveBeenCalled();
    });

    it('answers 503 and calls GitHub for nothing when the catalog cannot be asked (never "allowed" by default)', async () => {
      canRead.mockRejectedValue(new Error('catalog is down'));
      const res = await request(server).get('/api/github-actions-api/repos/example-org/app/actions/runs').set(user());
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain('catalog is down');
      expect(calls).toHaveLength(0);
    });

    it('remembers a yes for the same person and repository for a short time, so a tab load asks once', async () => {
      answer.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      for (let i = 0; i < 4; i++) {
        expect((await request(server).get('/api/github-actions-api/repos/example-org/cached-app/actions/runs').set(user())).status).toBe(200);
      }
      expect(canRead).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(4);
    });

    it('a remembered yes lasts 30 seconds: someone whose access was removed loses the view then', async () => {
      answer.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      const get = () => request(server).get('/api/github-actions-api/repos/example-org/expiring-app/actions/runs').set(user());
      expect((await get()).status).toBe(200);
      clock += 29_000;
      expect((await get()).status).toBe(200);
      expect(canRead).toHaveBeenCalledTimes(1);
      canRead.mockResolvedValue(false); // access removed in the catalog
      clock += 2_000; // 31 s after the first answer
      expect((await get()).status).toBe(404);
      expect(canRead).toHaveBeenCalledTimes(2);
    });

    it('does not share a yes between people', async () => {
      answer.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      await request(server).get('/api/github-actions-api/repos/example-org/shared-app/actions/runs').set(user());
      canRead.mockResolvedValue(false);
      const res = await request(server).get('/api/github-actions-api/repos/example-org/shared-app/actions/runs').set(other());
      expect(res.status).toBe(404);
    });

    it('never remembers a no: a repository registered a minute later is served at once', async () => {
      answer.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      canRead.mockResolvedValueOnce(false);
      expect((await request(server).get('/api/github-actions-api/repos/example-org/new-app/actions/runs').set(user())).status).toBe(404);
      expect((await request(server).get('/api/github-actions-api/repos/example-org/new-app/actions/runs').set(user())).status).toBe(200);
    });
  });

  it('refuses a request with no login, and a service credential', async () => {
    expect((await request(server).get('/api/github-actions-api/repos/example-org/a/actions/runs')).status).toBe(401);
    expect((await request(server).get('/api/github-actions-api/repos/example-org/a/actions/runs').set('Authorization', mockCredentials.service.header())).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('refuses %s (read-only) without calling GitHub', async method => {
    const res = await request(server)[method]('/api/github-actions-api/repos/example-org/a/actions/runs/1/rerun').set(user());
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('refuses private source and other organizations without calling GitHub', async () => {
    expect((await request(server).get('/api/github-actions-api/repos/example-org/a/contents/.env').set(user())).status).toBe(404);
    expect((await request(server).get('/api/github-actions-api/repos/other-org/a/actions/runs').set(user())).status).toBe(403);
    expect((await request(server).get('/api/github-actions-api/repos/example-org/../x/y').set(user())).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('forwards a run list with the portal token, and never returns the token or cookies', async () => {
    answer.mockResolvedValue(
      new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', link: '<https://api.github.com/x>; rel="next"', 'x-ratelimit-remaining': '4999', 'x-secret': 'no' } }),
    );
    const res = await request(server).get('/api/github-actions-api/repos/example-org/app/actions/runs?per_page=5').set(user());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workflow_runs: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/example-org/app/actions/runs?per_page=5');
    expect(calls[0].init.headers.Authorization).toBe('Bearer gh-secret-token');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.redirect).toBe('manual');
    expect(JSON.stringify(res.headers)).not.toContain('gh-secret-token');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-secret']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBe('4999');
  });

  it('passes a job-log redirect only when it points at GitHub\'s own log storage', async () => {
    answer.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://pipelines.actions.githubusercontent.com/abc/log.txt?sig=1' } }));
    const ok = await request(server).get('/api/github-actions-api/repos/example-org/app/actions/jobs/9/logs').set(user()).redirects(0);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('https://pipelines.actions.githubusercontent.com/abc/log.txt?sig=1');
    for (const location of ['https://evil.example/x', 'http://pipelines.actions.githubusercontent.com/x', 'javascript:alert(1)', '/relative']) {
      answer.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      const bad = await request(server).get('/api/github-actions-api/repos/example-org/app/actions/jobs/9/logs').set(user()).redirects(0);
      expect(bad.status).toBe(502);
    }
  });

  it('passes GitHub\'s own error status through and turns a network failure into 502 without detail', async () => {
    answer.mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    expect((await request(server).get('/api/github-actions-api/repos/example-org/app').set(user())).status).toBe(404);
    answer.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443'));
    const res = await request(server).get('/api/github-actions-api/repos/example-org/app').set(user());
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });
});

describe('the registered plugin reads its organizations and token from config', () => {
  // A catalog that knows exactly one repository, answering the by-query request the catalog client makes.
  const fakeCatalog = createBackendPlugin({
    pluginId: 'catalog',
    register(env) {
      env.registerInit({
        deps: { httpRouter: coreServices.httpRouter },
        async init({ httpRouter }) {
          httpRouter.addAuthPolicy({ path: '/', allow: 'unauthenticated' });
          httpRouter.use((req, res) => {
            const filter = String(req.query.filter ?? '');
            // exactly the question the route must ask: the entity whose project-slug annotation is this repository
            const known = filter === 'metadata.annotations.github.com/project-slug=example-org/seen-app';
            res.json({ items: known ? [{ metadata: { name: 'seen-app' } }] : [], totalItems: known ? 1 : 0, pageInfo: {} });
          });
        },
      });
    },
  });

  const start = () =>
    startTestBackend({
      features: [
        githubActionsApiPlugin,
        fakeCatalog,
        mockServices.rootConfig.factory({
          data: {
            organization: { githubOwner: 'example-org' },
            catalog: { providers: { github: { a: { organization: 'example-org' }, b: { organization: 'example-team' } } } },
            integrations: { github: [{ host: 'github.com', token: 'tok' }] },
          },
        }),
      ],
    });

  it('starts with the real config shape and serves the allowed repo only', async () => {
    const { server } = await start();
    const auth = { Authorization: mockCredentials.user.header() };
    expect((await request(server).get('/api/github-actions-api/repos/unknown-org/a/actions/runs').set(auth)).status).toBe(403);
    expect((await request(server).get('/api/github-actions-api/repos/example-org/a/contents/x').set(auth)).status).toBe(404);
  });

  it('asks the real catalog client: a repository with no entity is 404, one with an entity gets as far as GitHub', async () => {
    const realFetch = global.fetch;
    const githubCalls: string[] = [];
    const spy = jest.spyOn(global, 'fetch').mockImplementation(((url: any, init?: any) => {
      if (String(url).startsWith('https://api.github.com')) {
        githubCalls.push(String(url));
        return Promise.resolve(new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(url, init);
    }) as typeof fetch);
    try {
      const { server } = await start();
      const auth = { Authorization: mockCredentials.user.header() };
      expect((await request(server).get('/api/github-actions-api/repos/example-org/hidden-app/actions/runs').set(auth)).status).toBe(404);
      expect(githubCalls).toEqual([]);
      const seen = await request(server).get('/api/github-actions-api/repos/example-org/seen-app/actions/runs').set(auth);
      expect(seen.status).toBe(200);
      expect(githubCalls).toEqual(['https://api.github.com/repos/example-org/seen-app/actions/runs']);
    } finally {
      spy.mockRestore();
    }
  });
});
