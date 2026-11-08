import express from 'express';
import { AddressInfo } from 'net';
import { allowAutoLinkAttempt, createRouter } from './router';

/**
 * A trainee's linked GitHub account is shared on every repo the portal creates for them. The
 * organization's own account (organization.githubOwner) owns those repos and GitHub refuses it as a
 * collaborator — linking it left a Linux capstone repo with no one invited (2026-10-31).
 */
describe('user-management router — linking GitHub', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  const linked: string[] = [];

  beforeAll(async () => {
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user', userEntityRef: 'user:default/jane.doe' } }) } as any,
      userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/jane.doe', ownershipEntityRefs: [] }) } as any,
      userStore: { updateGithubUsername: async (_n: string, u: string) => { linked.push(u); } } as any,
      revocationStore: {} as any,
      orgDomain: 'example.com',
      githubOwner: 'example-org',
    });
    const app = express().use(router).use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'InputError' ? 400 : 500).json({ error: err.message }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("refuses the organization's own account, whatever its case, and saves nothing", async () => {
    for (const githubUsername of ['example-org', 'Example-Org ']) {
      const res = await fetch(`${base}/link-github`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubUsername }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/organization's own GitHub account, not yours.*Sign in to github.com with your personal GitHub account/);
    }
    expect(linked).toEqual([]);
  });
});

/**
 * Instructor role: an admin grants/revokes membership of the `instructors` group (synced to the
 * catalog by UserEntityProvider). Admin-only, independent of the department team, and never
 * touched by /assign.
 */
describe('user-management router — instructor role', () => {
  const ADMIN = ['user:default/jane.doe', 'group:default/backstage-admins'];
  const ENGINEER = ['user:default/ann.cruz', 'group:default/web-team'];

  const users: Record<string, any> = {
    'ann.cruz': { name: 'ann.cruz', display_name: 'Ann Cruz', teams: ['web-team'], is_admin: false, is_instructor: false },
    'trainee.only': { name: 'trainee.only', display_name: 'Tess Trainee', teams: ['general-engineers'], is_admin: false, is_instructor: false },
    'admin.only': { name: 'admin.only', display_name: 'Ada Admin', teams: [], is_admin: true, is_instructor: false },
    ghost: { name: 'ghost', display_name: 'Gus Ghost', teams: [], is_admin: false, is_instructor: false },
    // An admin with no department team who was made an instructor and later demoted: no team, no
    // admin flag, still an instructor (the provider keeps emitting them because of the flag).
    'former.admin': { name: 'former.admin', display_name: 'Fay Former', teams: [], is_admin: false, is_instructor: true },
  };

  let server: ReturnType<express.Express['listen']>;
  let base: string;
  let caller: string[];
  let calls: Array<[string, boolean]>;
  let upserts: any[];
  let invalidated: string[];
  let adminCalls: Array<[string, boolean]>;

  beforeAll(async () => {
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user' } }) } as any,
      userInfo: { getUserInfo: async () => ({ userEntityRef: caller[0], ownershipEntityRefs: caller }) } as any,
      userStore: {
        getByName: async (n: string) => users[n],
        setInstructor: async (n: string, v: boolean) => { calls.push([n, v]); },
        setAdmin: async (n: string, v: boolean) => { adminCalls.push([n, v]); },
        upsert: async (u: any) => { upserts.push(u); },
      } as any,
      revocationStore: { invalidateSessionsBefore: async (ref: string) => { invalidated.push(ref); } } as any,
      orgDomain: 'example.com',
    });
    server = express().use(router).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    caller = ADMIN;
    calls = [];
    adminCalls = [];
    upserts = [];
    invalidated = [];
  });

  const post = (body: unknown) =>
    fetch(`${base}/instructor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('lets an admin grant and revoke the role and names the person in the answer', async () => {
    const grant = await post({ userName: 'ann.cruz', isInstructor: true });
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ ok: true, message: 'Ann Cruz is now an instructor.' });

    const revoke = await post({ userName: 'ann.cruz', isInstructor: false });
    expect(revoke.status).toBe(200);
    expect((await revoke.json()).message).toBe('Ann Cruz is no longer an instructor.');

    expect(calls).toEqual([['ann.cruz', true], ['ann.cruz', false]]);
    // Their old token carries the old groups: it is refused after each change (a demoted instructor must not keep the role).
    expect(invalidated).toEqual(['user:default/ann.cruz', 'user:default/ann.cruz']);
  });

  it('works for a trainee-only user and for an admin with no department team', async () => {
    expect((await post({ userName: 'trainee.only', isInstructor: true })).status).toBe(200);
    expect((await post({ userName: 'admin.only', isInstructor: true })).status).toBe(200);
    expect(calls).toEqual([['trainee.only', true], ['admin.only', true]]);
  });

  it('refuses everyone who is not a platform admin and saves nothing', async () => {
    caller = ENGINEER;
    const res = await post({ userName: 'ann.cruz', isInstructor: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only platform admins/);

    caller = ['user:default/ann.cruz', 'group:default/instructors'];
    expect((await post({ userName: 'ann.cruz', isInstructor: true })).status).toBe(403);
    expect(calls).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it('rejects a missing name, a non-boolean flag and an unknown user', async () => {
    expect((await post({ isInstructor: true })).status).toBe(400);
    for (const isInstructor of ['true', 1, null, undefined]) {
      expect((await post({ userName: 'ann.cruz', isInstructor })).status).toBe(400);
    }
    const unknown = await post({ userName: 'nobody', isInstructor: true });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("User 'nobody' not found");
    expect(calls).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it('refuses a user who has not finished onboarding (the catalog would never show the role)', async () => {
    const res = await post({ userName: 'ghost', isInstructor: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Gus Ghost has not finished onboarding/);
    expect(calls).toEqual([]);
  });

  it('always lets an admin REVOKE the role, even from someone who has no team and is not an admin', async () => {
    const revoke = await post({ userName: 'former.admin', isInstructor: false });
    expect(revoke.status).toBe(200);
    expect((await revoke.json()).message).toBe('Fay Former is no longer an instructor.');
    expect(calls).toEqual([['former.admin', false]]);
    // granting to that same kind of row stays refused: it would never reach the catalog
    expect((await post({ userName: 'ghost', isInstructor: true })).status).toBe(400);
    expect(calls).toEqual([['former.admin', false]]);
  });

  it('is not touched by assigning a team (assign never sends the flag)', async () => {
    const res = await fetch(`${base}/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: 'ann.cruz', teams: ['web-team', 'cloud-team'], isLead: true }),
    });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).not.toHaveProperty('isInstructor');
    expect(calls).toEqual([]);
    expect(invalidated).toEqual(['user:default/ann.cruz']);
  });

  it('demoting or promoting an admin refuses that person\'s old tokens; a refused request changes and refuses nothing', async () => {
    const promote = (body: unknown) => fetch(`${base}/promote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await promote({ userName: 'ann.cruz', isAdmin: false })).status).toBe(200);
    expect((await promote({ userName: 'ann.cruz', isAdmin: true })).status).toBe(200);
    expect(adminCalls).toEqual([['ann.cruz', false], ['ann.cruz', true]]);
    expect(invalidated).toEqual(['user:default/ann.cruz', 'user:default/ann.cruz']);
    invalidated.length = 0;
    caller = ENGINEER;
    expect((await promote({ userName: 'ann.cruz', isAdmin: false })).status).toBe(403);
    expect(invalidated).toEqual([]);
  });
});

/**
 * Self sign-up (POST /register, open to every signed-in @example.com user) may only put a person in general-engineers.
 * The onboarding page hides the other teams, but the server is what decides (audit 2026-11-07).
 */
describe('user-management router — self sign-up team', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  const saved: any[] = [];

  beforeAll(async () => {
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user', userEntityRef: 'user:default/new.hire' } }) } as any,
      userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/new.hire', ownershipEntityRefs: [] }) } as any,
      userStore: { upsert: async (row: any) => { saved.push(row); } } as any,
      revocationStore: {} as any,
      orgDomain: 'example.com',
      githubOwner: 'example-org',
    });
    const app = express().use(express.json()).use(router).use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'InputError' ? 400 : 500).json({ error: err.message }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => { saved.length = 0; });

  const register = (team: unknown) =>
    fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'New Hire', team }) });

  it.each(['cloud-team', 'pm-team', 'web-team', 'sa-team', 'backstage-admins', 'instructors', 'x-lead', ''])(
    'refuses %j and saves nothing',
    async team => {
      const res = await register(team);
      expect(res.status).toBe(400);
      expect(saved).toEqual([]);
    },
  );

  it('accepts general-engineers', async () => {
    const res = await register('general-engineers');
    expect(res.status).toBe(200);
    expect(saved).toEqual([{ name: 'new.hire', displayName: 'New Hire', email: 'new.hire@example.com', teams: ['general-engineers'] }]);
  });
});

/**
 * Linking a GitHub or GitLab account needs proof that the account is the caller's, and the shared-token search is rate limited
 * (audit 2026-11-07).
 */
const statusFor = (err: { name: string }) => {
  if (err.name === 'InputError') return 400;
  return err.name === 'NotAllowedError' ? 429 : 500;
};

describe('user-management router — account linking proof', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  const linked: Array<[string, string]> = [];
  const realFetch = global.fetch;

  beforeAll(async () => {
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user' } }) } as any,
      userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ann.cruz', ownershipEntityRefs: [] }) } as any,
      userStore: {
        updateGithubUsername: async (n: string, u: string) => { linked.push([n, u]); },
        updateGitlabUsername: async (n: string, u: string) => { linked.push([n, u]); },
      } as any,
      revocationStore: {} as any,
      orgDomain: 'example.com',
      githubOwner: 'example-org',
      githubToken: 'portal-shared-token',
    } as any);
    server = express().use(express.json()).use(router).use((err: any, _req: any, res: any, _next: any) => res.status(statusFor(err)).json({ error: err.message })).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => { linked.length = 0; });
  afterEach(() => { global.fetch = realFetch; });

  const post = (path: string, body: unknown) => {
    const real = realFetch;
    return real(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };

  it('refuses to link a GitHub or GitLab account without the proof token, and never calls GitHub with the portal token for it', async () => {
    const spy = jest.fn();
    global.fetch = ((...args: any[]) => (String(args[0]).startsWith(base) ? realFetch(args[0], args[1]) : (spy(...args), Promise.resolve(new Response('{}')))) ) as any;
    const gh = await post('/link-github', { githubUsername: 'a-colleague' });
    expect(gh.status).toBe(400);
    expect((await gh.json()).error).toMatch(/Sign in with GitHub/);
    const gl = await post('/link-gitlab', { gitlabUsername: 'a-colleague' });
    expect(gl.status).toBe(400);
    expect((await gl.json()).error).toMatch(/Sign in with GitLab/);
    expect(spy).not.toHaveBeenCalled();
    expect(linked).toEqual([]);
  });

  it('still links when the proof token belongs to the account', async () => {
    global.fetch = ((...args: any[]) =>
      String(args[0]).startsWith(base)
        ? realFetch(args[0], args[1])
        : Promise.resolve(new Response(JSON.stringify({ login: 'ann-cruz' }), { status: 200, headers: { 'content-type': 'application/json' } }))) as any;
    const res = await post('/link-github', { githubUsername: 'ann-cruz', oauthToken: 'ann-own-token' });
    expect(res.status).toBe(200);
    expect(linked).toEqual([['ann.cruz', 'ann-cruz']]);
  });

  it('refuses a token that belongs to a different account than the one named', async () => {
    global.fetch = ((...args: any[]) =>
      String(args[0]).startsWith(base)
        ? realFetch(args[0], args[1])
        : Promise.resolve(new Response(JSON.stringify({ login: 'someone-else' }), { status: 200, headers: { 'content-type': 'application/json' } }))) as any;
    const res = await post('/link-github', { githubUsername: 'a-colleague', oauthToken: 'ann-own-token' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(linked).toEqual([]);
  });

  it('allows a few auto-link searches per person, then asks them to wait; other people and later windows are unaffected', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(allowAutoLinkAttempt('rate.user', t0 + i)).toBe(true);
    expect(allowAutoLinkAttempt('rate.user', t0 + 10)).toBe(false);
    expect(allowAutoLinkAttempt('someone.else', t0 + 10)).toBe(true);
    expect(allowAutoLinkAttempt('rate.user', t0 + 10 * 60 * 1000 + 100)).toBe(true);
  });
});
