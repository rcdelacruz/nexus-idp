import knexFactory, { Knex } from 'knex';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { createRouter, permissionForRequest } from './router';

/**
 * The URL's letter case must not change which permission a request needs (audit 2026-11-07): the permission mapping is
 * case-sensitive while Express routing is not, so `/Tasks/admin/all` and `/Capstones/enrollments/x/secrets` reached the handlers with no
 * permission asked at all. Here the REAL router runs on real Postgres with a permission service that DENIES everything, so any
 * success is a bypass.
 *
 * Skipped unless LP_TEST_PG_URL is set (see traineeRemovals.pg.test.ts). Uses its own schema.
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;
const SCHEMA = 'lp_router_case_test';

maybe('permission checks do not depend on the case of the URL (real router, real Postgres)', () => {
  let db: Knex;
  let server: http.Server;
  let base: string;
  const authorized: string[] = [];
  /** Permissions the stand-in permission service allows; empty = deny everything. */
  let allowed = new Set<string>();

  beforeAll(async () => {
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: [SCHEMA], pool: { min: 1, max: 5 } });
    const dir = path.join(__dirname, '..', 'database', 'migrations');
    for (const f of fs.readdirSync(dir).filter(n => /^\d{3}-.*\.js$/.test(n)).sort()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require(path.join(dir, f)).up(db);
    }
    const router = await createRouter({
      logger: mockServices.logger.mock(),
      database: { getClient: async () => db } as any,
      discovery: { getBaseUrl: async () => 'http://backend' } as any,
      config: new ConfigReader({ app: { baseUrl: 'https://portal.example.com' } }),
      httpAuth: { credentials: async () => ({ principal: { type: 'user', userEntityRef: 'user:default/trainee' } }) } as any,
      permissions: {
        authorize: async (requests: Array<{ permission: { name: string } }>) => {
          requests.forEach(r => authorized.push(r.permission.name));
          return requests.map(r => ({ result: allowed.has(r.permission.name) ? AuthorizeResult.ALLOW : AuthorizeResult.DENY }));
        },
      } as any,
    });
    const app = express();
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.closeAllConnections?.();
    await new Promise(r => server?.close(r));
    await db?.destroy();
  });
  beforeEach(() => {
    authorized.length = 0;
    allowed = new Set();
  });

  const send = (method: string, p: string) => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });

  // [method, path as the code spells it]; every one is permission-gated, so a deny-all policy must stop it.
  const GATED: Array<[string, string]> = [
    ['GET', '/tasks/admin/all'],
    ['GET', '/tasks/admin/trainees'],
    ['GET', '/tasks/admin/trainees/list'],
    ['GET', '/tasks/admin/trainees/detail'],
    ['POST', '/tasks/admin/trainees/activity'],
    ['POST', '/tasks/admin/trainees/remove'],
    ['GET', '/capstones/enrollments'],
    ['GET', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/secrets'],
    ['POST', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/handout'],
    ['POST', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/checks/grade'],
    ['DELETE', '/capstones/enrollments/00000000-0000-4000-8000-000000000000'],
    ['POST', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/complete'],
    ['GET', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/report'],
    ['POST', '/capstones/enrollments/00000000-0000-4000-8000-000000000000/reopen'],
    ['GET', '/tasks'],
    ['POST', '/tasks'],
  ];

  const variants = (p: string): string[] => {
    const parts = p.split('/'); // ['', 'tasks', 'admin', 'all']
    const out = new Set<string>([p]);
    out.add(['', parts[1].toUpperCase(), ...parts.slice(2)].join('/'));
    out.add(['', parts[1][0].toUpperCase() + parts[1].slice(1), ...parts.slice(2)].join('/'));
    if (parts[2]) out.add(['', parts[1], parts[2].toUpperCase(), ...parts.slice(3)].join('/'));
    if (parts[2]) out.add(['', parts[1], parts[2][0].toUpperCase() + parts[2].slice(1), ...parts.slice(3)].join('/'));
    out.add(`${p}/`);
    out.add(`${['', parts[1].toUpperCase(), ...parts.slice(2)].join('/')}/`);
    return [...out];
  };

  it.each(GATED)('%s %s: no spelling of the path gets past a deny-all policy', async (method, p) => {
    for (const spelled of variants(p)) {
      const res = await send(method, spelled);
      expect([403, 404]).toContain(res.status);
      // never a handler's answer: a 404 here must be "no such route", not a handler saying not found with data
      const body = await res.text();
      expect(body).not.toMatch(/"tasks"|"enrollments"|"secrets"|manifest|answerKey/i);
    }
  });

  describe('an instructor (allowed local-provisioner.trainees.read and nothing else)', () => {
    const instructor = () => {
      allowed = new Set(['local-provisioner.trainees.read']);
    };
    const json = (method: string, p: string, body?: unknown) =>
      fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

    it('reaches the list, the detail and the GitHub activity read', async () => {
      instructor();
      const list = await json('GET', '/tasks/admin/trainees/list');
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({ trainees: [] });
      // The handler answered (a 404 from the service, not a 403 from the permission check).
      expect((await json('GET', '/tasks/admin/trainees/detail?key=lab:a::b')).status).toBe(404);
      const activity = await json('POST', '/tasks/admin/trainees/activity', { keys: ['lab:a::b'] });
      expect(activity.status).toBe(200);
      expect(await activity.json()).toEqual({ activity: [] });
      expect([...new Set(authorized)]).toEqual(['local-provisioner.trainees.read']);
    });

    it('and still nothing wider: not the admin list, not Remove trainee, not the old list path, not other methods on the new paths', async () => {
      instructor();
      for (const [method, p] of [
        ['GET', '/tasks/admin/all'],
        ['POST', '/tasks/admin/trainees/remove'],
        ['GET', '/tasks/admin/trainees'],
        ['GET', '/tasks/admin/trainees/activity'],
        ['POST', '/tasks/admin/trainees/list'],
        ['POST', '/tasks/admin/trainees/detail'],
        ['DELETE', '/tasks/admin/trainees/activity'],
      ]) {
        expect({ method, p, status: (await json(method, p, method === 'GET' || method === 'DELETE' ? undefined : {})).status }).toEqual({ method, p, status: 403 });
      }
    });

    it('a different spelling of an allowed path is never answered with data', async () => {
      instructor();
      for (const spelled of ['/Tasks/Admin/Trainees/List', '/TASKS/ADMIN/TRAINEES/LIST', '/tasks/admin/trainees/LIST']) {
        const res = await json('GET', spelled);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toMatch(/"trainees"/);
      }
    });

    it('someone without the permission gets 403 on all three', async () => {
      for (const [method, p, body] of [['GET', '/tasks/admin/trainees/list', undefined], ['GET', '/tasks/admin/trainees/detail?key=lab:a::b', undefined], ['POST', '/tasks/admin/trainees/activity', { keys: ['lab:a::b'] }]] as const) {
        expect((await json(method, p, body)).status).toBe(403);
      }
    });
  });

  it('the exact lower-case spelling really is stopped by the permission, not by routing (the test can tell the two apart)', async () => {
    const res = await send('GET', '/tasks/admin/all');
    expect(res.status).toBe(403);
    expect(authorized).toContain('local-provisioner.task.read-all');
  });

  it('a different spelling is never answered by a handler', async () => {
    for (const spelled of ['/Tasks/admin/all', '/tasks/Admin/all', '/TASKS/ADMIN/ALL', '/Capstones/enrollments', '/CAPSTONES/enrollments']) {
      const res = await send('GET', spelled);
      expect(res.status).not.toBe(200);
    }
  });

  it('serves the installer script to anyone, without asking for any permission, and nothing else under /agent/install.sh', async () => {
    const res = await send('GET', '/agent/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toMatch(/^#!\/bin\/sh/);
    expect(authorized).toEqual([]);
    for (const [method, p] of [['POST', '/agent/install.sh'], ['GET', '/agent/install.sh/extra'], ['GET', '/Agent/install.sh'], ['GET', '/agent/Install.sh']]) {
      expect((await send(method, p)).status).not.toBe(200);
    }
  });

  describe('how much a request may carry (real router)', () => {
    const post = (p: string, body: string, method = 'POST') => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body });
    const pad = (bytes: number) => JSON.stringify({ pad: 'x'.repeat(bytes) });

    it('refuses 200 kb on the unauthenticated agent login routes with 413 (it used to buffer 10 MB for anyone)', async () => {
      for (const p of ['/agent/device/code', '/agent/device/token', '/agent/register']) {
        expect((await post(p, pad(200 * 1024))).status).toBe(413);
      }
    });

    it('still takes a 2 MB task up to the permission check (it is denied there, not turned away for size), and refuses 11 MB', async () => {
      expect((await post('/tasks', pad(2 * 1024 * 1024))).status).toBe(403);
      expect((await post('/tasks', pad(11 * 1024 * 1024))).status).toBe(413);
    });

    it('a body that is not JSON is a 400', async () => {
      expect((await post('/agent/device/code', '{"a":')).status).toBe(400);
    });

    it('the login-code route refuses a field that cannot be an agent id, and takes what a real agent sends', async () => {
      expect((await post('/agent/device/code', JSON.stringify({ agent_id: 'a b;c', hostname: 'h', platform: 'darwin', platform_version: 'v' }))).status).toBe(400);
      expect((await post('/agent/device/code', JSON.stringify({ agent_id: 'agent-mac-a1b2', hostname: 'mac.local', platform: 'darwin', platform_version: 'macOS 26.0 (arm64)' }))).status).toBe(200);
    });
  });

  describe('permissionForRequest itself', () => {
    it('asks for the same permission whatever the case of the path', () => {
      for (const [m, p] of GATED) {
        const expected = permissionForRequest(m, p);
        expect(expected).toBeDefined();
        for (const spelled of variants(p)) expect(permissionForRequest(m, spelled)).toBe(expected);
      }
    });
  });
});
