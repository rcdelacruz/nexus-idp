import express from 'express';
import request from 'supertest';
import knexFactory, { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { createCapstoneRoutes } from './capstoneRoutes';
import { CapstoneStore } from './CapstoneStore';

const migration = require('../database/migrations/006-create-capstone-enrollments.js');
const completion = require('../database/migrations/010-capstone-completion.js');

describe('capstone routes', () => {
  let db: Knex;
  let app: express.Express;
  let caller = 'trainee@example.com';
  const logger = mockServices.logger.mock();
  const seed = jest.fn(async (_def: any, no: string) => ({
    files: { 'HANDOVER.md': Buffer.from(`handover ${no}`).toString('base64') },
    manifest: { trainee: no },
    credentials: `secret-pw-${no}`,
    answerKey: `answers-${no}`,
  }));
  const handout = jest.fn(async () => ({ prUrl: 'https://github.com/example-org/r/pull/1', created: true }));
  const runnerToken = jest.fn(async () => ({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' }));
  const commitHandover = jest.fn(async () => false);
  // The older tests link placeholder repos (r, tf): they stand in for a repo that has been proven. The real proof is tested in
  // 'the repository is proven before the portal acts on it'.
  const okRepo = (async () => ({ ok: true, owner: 'example-org', repo: 'x' })) as any;

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    await completion.up(db);
    caller = 'trainee@example.com';
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: caller };
      next();
    });
    app.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', checkRepo: okRepo, externalBaseUrl: async () => 'https://portal.example/api/local-provisioner', seed: seed as any, handout: handout as any, runnerToken: runnerToken as any, commitHandover: commitHandover as any }));
  });
  afterEach(() => db.destroy());

  it('enrolls the caller and returns only the trainee files', async () => {
    const res = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
    expect(res.status).toBe(201);
    expect(res.body.enrollment).toMatchObject({ capstone: 'nodejs-b', traineeEmail: 'trainee@example.com', traineeNo: '01', status: 'seeded' });
    expect(res.body.files['HANDOVER.md']).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/secret-pw|answers-|"manifest"/);
  });

  it('rejects an unknown capstone (including prototype keys)', async () => {
    expect((await request(app).post('/capstones/enrollments').send({ capstone: 'nope' })).status).toBe(400);
    expect((await request(app).post('/capstones/enrollments').send({ capstone: 'constructor' })).status).toBe(400);
  });

  it('lets only the enrolled trainee link a github.com repo, once', async () => {
    const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
    const id = body.enrollment.id;
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://gitlab.com/a/b' })).status).toBe(400);
    caller = 'someone-else@example.com';
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/example-org/r' })).status).toBe(404);
    caller = 'trainee@example.com';
    const ok = await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/example-org/r' });
    expect(ok.status).toBe(200);
    expect(ok.body.enrollment.status).toBe('active');
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/example-org/x' })).status).toBe(404);
  });

  it('reveals secrets (audit-logged) and opens the handout on the linked repo', async () => {
    const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
    const id = body.enrollment.id;
    expect((await request(app).post(`/capstones/enrollments/${id}/handout`)).status).toBe(409); // no repo yet
    await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/example-org/r' });

    caller = 'instructor@example.com';
    const secrets = await request(app).get(`/capstones/enrollments/${id}/secrets`);
    expect(secrets.status).toBe(200);
    expect(secrets.body).toMatchObject({ credentials: 'secret-pw-01', answerKey: 'answers-01', seedManifest: { trainee: '01' } });
    expect(secrets.body.gradeCommand).toMatch(/grade\.mjs/);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/secrets revealed by instructor@example.com/), expect.objectContaining({ audit: true }));

    const h = await request(app).post(`/capstones/enrollments/${id}/handout`);
    expect(h.status).toBe(200);
    expect(handout).toHaveBeenCalledWith(expect.objectContaining({ id: 'nodejs-b' }), { owner: 'example-org', repo: 'r' }, 'tok');
    const listed = await request(app).get('/capstones/enrollments');
    expect(listed.body.enrollments[0]).toMatchObject({ handoutPrUrl: 'https://github.com/example-org/r/pull/1' });
    expect(JSON.stringify(listed.body)).not.toMatch(/secret-pw|answers-/);
  });

  describe('laptop-seeded capstone (terraform)', () => {
    beforeEach(() => {
      seed.mockImplementationOnce(async () => ({
        files: { 'README.md': Buffer.from('tf').toString('base64') },
        laptopSeedFiles: { 'seed_prod.py': Buffer.from('print(1)').toString('base64') },
      }) as any);
    });

    it('returns a single-use seed token, the report URL and the seed script, and stores only the hash', async () => {
      const res = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-b' });
      expect(res.status).toBe(201);
      expect(res.body.enrollment).toMatchObject({ capstone: 'terraform-b', awaitingSeedReport: true });
      expect(res.body.laptopSeed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body.laptopSeed.reportUrl).toBe(`https://portal.example/api/local-provisioner/capstones/seed-report/${res.body.enrollment.id}`);
      expect(Object.keys(res.body.laptopSeed.files)).toEqual(['seed_prod.py']);
      const row = await db('capstone_enrollments').where({ id: res.body.enrollment.id }).first();
      expect(row.seed_token_hash).toHaveLength(64);
      expect(row.seed_token_hash).not.toContain(res.body.laptopSeed.token);
      expect(row.credentials).toBeNull();
    });

    it('mints a runner registration token and tries the handover when the repo is linked', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-b' });
      const res = await request(app).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/example-org/tf' });
      expect(res.status).toBe(200);
      expect(res.body.runner).toEqual({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' });
      expect(runnerToken).toHaveBeenCalledWith({ owner: 'example-org', repo: 'tf' }, 'tok');
      expect(commitHandover).toHaveBeenCalled();
    });

    it('Capstone A (nothing to seed, CI on the laptop): the runner token is minted without a laptop seed or a handover note', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-a' });
      expect(body.laptopSeed).toBeUndefined(); // server-seeded: no seed token to report back with
      commitHandover.mockClear();
      const res = await request(app).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/example-org/tfa' });
      expect(res.status).toBe(200);
      expect(res.body.runner).toEqual({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' });
      expect(runnerToken).toHaveBeenCalledWith({ owner: 'example-org', repo: 'tfa' }, 'tok');
      expect(commitHandover).not.toHaveBeenCalled(); // there is no HANDOVER.md for a capstone with no seed
    });

    it('a server-seeded capstone without a runner (Node.js) still gets no runner token', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-a' });
      runnerToken.mockClear();
      const res = await request(app).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/example-org/nja' });
      expect(res.status).toBe(200);
      expect(res.body.runner).toBeUndefined();
      expect(runnerToken).not.toHaveBeenCalled();
    });

    it('remove: hides the enrollment, frees its trainee number, cancels the seed token (audit-logged)', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-b' });
      const id = body.enrollment.id;
      await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/example-org/tf' });
      caller = 'instructor@example.com';
      const del = await request(app).delete(`/capstones/enrollments/${id}`);
      expect(del.status).toBe(200);
      expect(del.body.enrollment).toMatchObject({ status: 'withdrawn', awaitingSeedReport: false });
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/enrollment removed by instructor@example.com/), expect.objectContaining({ audit: true }));
      expect((await request(app).get('/capstones/enrollments')).body.enrollments).toEqual([]);
      const row = await db('capstone_enrollments').where({ id }).first();
      expect(row.seed_token_hash).toBeNull(); // a late seed report from the removed lab is refused
      expect((await request(app).delete(`/capstones/enrollments/${id}`)).status).toBe(404);
      expect((await request(app).delete('/capstones/enrollments/no-such-id')).status).toBe(404);
      // the number is free again for the next enrollment
      seed.mockImplementationOnce(async () => ({ files: {}, laptopSeedFiles: {} }) as any);
      const again = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-b' });
      expect(again.body.enrollment.traineeNo).toBe(body.enrollment.traineeNo);
    });

    it('has no instructor data until the laptop reports', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform-b' });
      expect((await request(app).get(`/capstones/enrollments/${body.enrollment.id}/secrets`)).status).toBe(404);
    });
  });

  describe('marking a capstone done (instructor)', () => {
    const REPORT = (trainee: string) => ({ version: 1, trainee, course: 'nodejs-b', lab: 'lab', summary: ['s'], checks: [], history: [] });
    /** The trainee enrolls and links a repo (active); then the instructor acts. */
    const activeFor = async (email = 'trainee@example.com', repo = 'r') => {
      caller = email;
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      await request(app).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: `https://github.com/example-org/${repo}` });
      caller = 'teacher@example.com';
      return body.enrollment.id as string;
    };
    const complete = (id: string, report: unknown) => request(app).post(`/capstones/enrollments/${id}/complete`).send({ report });

    it('marks it done, stamps the instructor, keeps the report, and the list shows it without the report', async () => {
      const id = await activeFor();
      const res = await complete(id, REPORT('trainee@example.com'));
      expect(res.status).toBe(200);
      expect(res.body.enrollment).toMatchObject({ id, status: 'completed', completedBy: 'teacher@example.com', hasReport: true });
      const kept = await request(app).get(`/capstones/enrollments/${id}/report`);
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({ report: REPORT('trainee@example.com'), completedBy: 'teacher@example.com' });
      const listed = (await request(app).get('/capstones/enrollments')).body.enrollments.find((e: any) => e.id === id);
      expect(listed).toMatchObject({ status: 'completed', hasReport: true });
      expect(JSON.stringify(listed)).not.toContain('"summary"');
    });

    it('refuses what cannot be marked done: twice, no repository yet, unknown, withdrawn', async () => {
      const id = await activeFor();
      expect((await complete(id, REPORT('trainee@example.com'))).status).toBe(200);
      const twice = await complete(id, REPORT('trainee@example.com'));
      expect(twice.status).toBe(409);
      expect(twice.body.error).toMatch(/already marked done/);
      caller = 'noRepo@example.com';
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      caller = 'teacher@example.com';
      expect((await complete(body.enrollment.id, REPORT('norepo@example.com'))).status).toBe(409);
      expect((await complete('00000000-0000-4000-8000-000000000000', REPORT('x@x.com'))).status).toBe(404);
      const other = await activeFor('other@example.com', 'r2');
      await request(app).delete(`/capstones/enrollments/${other}`);
      expect((await complete(other, REPORT('other@example.com'))).status).toBe(404);
    });

    it.each([
      ['no report', undefined],
      ['a list instead of a report', []],
      ['a text', 'report'],
      ['an unknown version', { ...{ version: 1, trainee: 'trainee@example.com', course: 'c', lab: 'l', summary: [], checks: [], history: [] }, version: 2 }],
      ['a report about someone else', { version: 1, trainee: 'someone.else@example.com', course: 'c', lab: 'l', summary: [], checks: [], history: [] }],
      ['a report without its parts', { version: 1, trainee: 'trainee@example.com', course: 'c', lab: 'l' }],
      ['a report whose parts are not lists', { version: 1, trainee: 'trainee@example.com', course: 'c', lab: 'l', summary: 'x', checks: {}, history: 3 }],
    ])('refuses %s and keeps nothing', async (_label, report) => {
      const id = await activeFor();
      expect((await complete(id, report)).status).toBe(400);
      expect((await request(app).get(`/capstones/enrollments/${id}/report`)).status).toBe(404);
      expect((await new CapstoneStore(db).get(id))?.status).toBe('active');
    });

    it('the trainee in the report is compared without regard to letter case', async () => {
      const id = await activeFor('Mixed.Case@example.com', 'r3');
      expect((await complete(id, REPORT('mixed.case@example.com'))).status).toBe(200);
    });

    it('a report over the size limit is 413 and nothing is kept', async () => {
      const big = express();
      big.use(express.json({ limit: '2mb' }));
      big.use((req, _res, next) => {
        (req as any).user = { email: 'teacher@example.com' };
        next();
      });
      const store = new CapstoneStore(db);
      big.use('/capstones', createCapstoneRoutes({ store, logger, getGithubToken: async () => 'tok', checkRepo: okRepo, externalBaseUrl: async () => 'x', seed: seed as any }));
      const id = await activeFor('big@example.com', 'r4');
      const res = await request(big).post(`/capstones/enrollments/${id}/complete`).send({ report: { ...REPORT('big@example.com'), summary: ['x'.repeat(600 * 1024)] } });
      expect(res.status).toBe(413);
      expect((await store.get(id))?.status).toBe('active');
    });

    it('reopening undoes it: the report is gone and the capstone is active again; reopening what is not done is refused', async () => {
      const id = await activeFor();
      await complete(id, REPORT('trainee@example.com'));
      const reopened = await request(app).post(`/capstones/enrollments/${id}/reopen`);
      expect(reopened.status).toBe(200);
      expect(reopened.body.enrollment).toMatchObject({ status: 'active', hasReport: false });
      expect((await request(app).get(`/capstones/enrollments/${id}/report`)).status).toBe(404);
      expect((await request(app).post(`/capstones/enrollments/${id}/reopen`)).status).toBe(409);
    });

    it('marking done and reopening are audit-logged with who did it and for whom', async () => {
      const id = await activeFor();
      await complete(id, REPORT('trainee@example.com'));
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/marked done by teacher@example\.com: trainee@example\.com/),
        expect.objectContaining({ audit: true, enrollmentId: id }),
      );
      await request(app).post(`/capstones/enrollments/${id}/reopen`);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/reopened by teacher@example\.com: trainee@example\.com/),
        expect.objectContaining({ audit: true, enrollmentId: id }),
      );
    });

    it('a capstone that is not done has no report', async () => {
      const id = await activeFor();
      expect((await request(app).get(`/capstones/enrollments/${id}/report`)).status).toBe(404);
    });

    it('running the template again after it was marked done starts a NEW enrollment beside it: the finished record and its report stay', async () => {
      const id = await activeFor();
      await complete(id, REPORT('trainee@example.com'));
      caller = 'trainee@example.com';
      const again = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      expect(again.status).toBe(201);
      expect(again.body.enrollment.id).not.toBe(id);
      expect(again.body.enrollment.traineeNo).not.toBe((await new CapstoneStore(db).get(id))!.traineeNo);
      const old = await new CapstoneStore(db).get(id);
      expect(old).toMatchObject({ status: 'completed', hasReport: true });
      expect((await request(app).get(`/capstones/enrollments/${id}/report`)).status).toBe(200);
    });
  });

  describe('the repository is proven before the portal acts on it', () => {
    const ORG = 'example-org';
    let gh: jest.Mock;
    let runner: jest.Mock;
    let handoutFn: jest.Mock;
    const repoMeta = (over: Record<string, unknown> = {}) => ({ private: true, fork: false, created_at: new Date().toISOString(), ...over });
    const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const build = (opts: { allowedOwner?: string | null } = {}) => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).user = { email: caller };
        next();
      });
      a.use(
        '/capstones',
        createCapstoneRoutes({
          store: new CapstoneStore(db),
          logger,
          getGithubToken: async () => 'tok',
          externalBaseUrl: async () => 'x',
          seed: seed as any,
          runnerToken: runner as any,
          handout: handoutFn as any,
          commitHandover: commitHandover as any,
          repoFetch: gh as any,
          ...(opts.allowedOwner === null ? {} : { allowedOwner: opts.allowedOwner ?? ORG }),
        }),
      );
      return a;
    };
    const enroll = async (a: express.Express, capstone = 'nodejs-b') => (await request(a).post('/capstones/enrollments').send({ capstone })).body.enrollment.id as string;
    const link = (a: express.Express, id: string, repo: string) => request(a).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: `https://github.com/${repo}` });
    const statusOf = async (id: string) => (await new CapstoneStore(db).get(id))?.status;

    beforeEach(() => {
      gh = jest.fn(async () => reply(200, repoMeta()));
      runner = jest.fn(async () => ({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' }));
      handoutFn = jest.fn(async () => ({ prUrl: 'https://github.com/x/y/pull/1', created: true }));
    });

    it('links the trainee\'s own fresh private lab repo, after reading it from GitHub', async () => {
      const a = build();
      const id = await enroll(a);
      const res = await link(a, id, `${ORG}/nodejs-capstone-b-trainee-20261107-1000`);
      expect(res.status).toBe(200);
      expect(gh).toHaveBeenCalledTimes(1);
      expect(gh.mock.calls[0][0]).toBe(`https://api.github.com/repos/${ORG}/nodejs-capstone-b-trainee-20261107-1000`);
      expect(await statusOf(id)).toBe('active');
    });

    it('refuses a repo of another organization without asking GitHub, and mints no runner token for it', async () => {
      const a = build();
      const id = await enroll(a, 'terraform-a');
      const res = await link(a, id, 'some-company/terraform-capstone-a-victim-20261107-1000');
      expect(res.status).toBe(400);
      expect(gh).not.toHaveBeenCalled();
      expect(runner).not.toHaveBeenCalled();
      expect(await statusOf(id)).toBe('seeded');
    });

    it('refuses a company repo of the trainee organization (wrong name) without asking GitHub, and mints no runner token', async () => {
      const a = build();
      const id = await enroll(a, 'terraform-a');
      for (const repo of ['engineering-standards', 'backstage-main', 'terraform-capstone-a']) {
        const res = await link(a, id, `${ORG}/${repo}`);
        expect(res.status).toBe(400);
      }
      expect(gh).not.toHaveBeenCalled();
      expect(runner).not.toHaveBeenCalled();
      expect(await statusOf(id)).toBe('seeded');
    });

    it('refuses a repo with the right name that was not created with this enrollment, a public one, a fork, one that does not exist, and everything when no organization is configured', async () => {
      const repo = `${ORG}/nodejs-capstone-b-trainee-20261107-1000`;
      const a = build();
      const id = await enroll(a);
      gh.mockResolvedValueOnce(reply(200, repoMeta({ created_at: '2026-01-01T00:00:00Z' })));
      expect((await link(a, id, repo)).status).toBe(400);
      gh.mockResolvedValueOnce(reply(200, repoMeta({ private: false })));
      expect((await link(a, id, repo)).status).toBe(400);
      gh.mockResolvedValueOnce(reply(200, repoMeta({ fork: true })));
      expect((await link(a, id, repo)).status).toBe(400);
      gh.mockResolvedValueOnce(reply(404));
      expect((await link(a, id, repo)).status).toBe(400);
      expect(await statusOf(id)).toBe('seeded');
      const none = build({ allowedOwner: null });
      expect((await link(none, id, repo)).status).toBe(400);
      expect(await statusOf(id)).toBe('seeded');
    });

    it('does not tell the caller why (no creation dates of private repos), and a GitHub outage is a 502, not "not yours"', async () => {
      const repo = `${ORG}/nodejs-capstone-b-trainee-20261107-1000`;
      const a = build();
      const id = await enroll(a);
      gh.mockResolvedValueOnce(reply(200, repoMeta({ created_at: '2026-01-01T00:00:00Z' })));
      const refused = await link(a, id, repo);
      expect(JSON.stringify(refused.body)).not.toMatch(/2026|created/);
      gh.mockResolvedValueOnce(reply(500));
      expect((await link(a, id, repo)).status).toBe(502);
      expect(await statusOf(id)).toBe('seeded');
    });

    it("someone else's fresh repo cannot be linked to my enrollment (its name carries the other person's name)", async () => {
      const a = build();
      caller = 'attacker@example.com';
      const mine = await enroll(a);
      for (const repo of ['nodejs-capstone-b-trainee-20261107-1000', 'nodejs-capstone-b-bob-lee-20261107-1000']) {
        expect((await link(a, mine, `${ORG}/${repo}`)).status).toBe(400);
      }
      expect(gh).not.toHaveBeenCalled();
      expect(runner).not.toHaveBeenCalled();
      expect(await statusOf(mine)).toBe('seeded');
      // ...but my own repo, named after me, is fine
      expect((await link(a, mine, `${ORG}/nodejs-capstone-b-attacker-20261107-1000`)).status).toBe(200);
    });

    it('a repo that already belongs to another enrollment (linked before the proof existed) cannot be linked a second time (any letter case, .git or trailing slash)', async () => {
      const a = build();
      // an older row of another person holds this trainee's repo
      caller = 'attacker@example.com';
      const older = await enroll(a);
      await new CapstoneStore(db).linkRepo(older, caller, `https://github.com/${ORG}/nodejs-capstone-b-trainee-20261107-1000`);
      caller = 'trainee@example.com';
      const second = await enroll(a);
      for (const variant of [`${ORG}/nodejs-capstone-b-trainee-20261107-1000`, `${ORG}/Nodejs-Capstone-B-Trainee-20261107-1000`, `${ORG}/nodejs-capstone-b-trainee-20261107-1000.git`]) {
        expect((await link(a, second, variant)).status).toBe(409);
      }
      expect(await statusOf(second)).toBe('seeded');
    });

    it('a repo stored with .git or a trailing slash is recognised too', async () => {
      const a = build();
      for (const [i, stored] of [['1', '.git'], ['2', '/']]) {
        caller = `first${i}@example.com`;
        const first = await enroll(a);
        await new CapstoneStore(db).linkRepo(first, caller, `https://github.com/${ORG}/nodejs-capstone-b-user${i}-20261107-1000${stored}`);
        caller = `user${i}@example.com`;
        const second = await enroll(a);
        expect((await link(a, second, `${ORG}/nodejs-capstone-b-user${i}-20261107-1000`)).status).toBe(409);
      }
    });

    it('the instructor\'s handout is not opened on a repo that was linked before the proof existed', async () => {
      const a = build();
      const id = await enroll(a);
      await new CapstoneStore(db).linkRepo(id, caller, `https://github.com/${ORG}/engineering-standards`);
      caller = 'instructor@example.com';
      const res = await request(a).post(`/capstones/enrollments/${id}/handout`).send({});
      expect(res.status).toBe(400);
      expect(handoutFn).not.toHaveBeenCalled();
    });

    it('the instructor\'s handout still opens on a proven lab repo', async () => {
      const a = build();
      const id = await enroll(a);
      expect((await link(a, id, `${ORG}/nodejs-capstone-b-trainee-20261107-1000`)).status).toBe(200);
      const res = await request(a).post(`/capstones/enrollments/${id}/handout`).send({});
      expect(res.status).toBe(200);
      expect(handoutFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('one enrollment per trainee per capstone', () => {
    let labState: string | undefined;
    const labs: any = {
      findLabTask: jest.fn(async () => ({ task_id: 't1', agent_id: 'a1', user_id: 'u', resource_name: 'lab' })),
      resourceState: jest.fn(async () => labState),
    };
    const build = () => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).user = { email: caller };
        next();
      });
      a.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', checkRepo: okRepo, externalBaseUrl: async () => 'x', seed: seed as any, labs }));
      return a;
    };
    const enrollAndLink = async (a: express.Express) => {
      const { body } = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      await request(a).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/example-org/r1' });
      return body.enrollment;
    };

    it('a re-run after a failed run replaces the dead enrollment and keeps the trainee number', async () => {
      const a = build();
      labState = undefined; // the scaffolder failed before the lab was provisioned
      const first = await enrollAndLink(a);
      const again = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      expect(again.status).toBe(201);
      expect(again.body.enrollment.traineeNo).toBe(first.traineeNo);
      const listed = (await request(a).get('/capstones/enrollments')).body.enrollments;
      expect(listed.map((e: any) => e.id)).toEqual([again.body.enrollment.id]);
    });

    it('starting over keeps the trainee number even when a lower one is free', async () => {
      const a = build();
      labState = undefined;
      caller = 'first@example.com';
      const first = await enrollAndLink(a); // #01
      caller = 'trainee@example.com';
      const mine = await enrollAndLink(a); // #02
      caller = 'instructor@example.com';
      await request(a).delete(`/capstones/enrollments/${first.id}`); // #01 free again
      caller = 'trainee@example.com';
      const again = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      expect(mine.traineeNo).toBe('02');
      expect(again.body.enrollment.traineeNo).toBe('02');
    });

    it('a removed or failed lab does not block starting over', async () => {
      const a = build();
      for (const state of ['removed', 'error']) {
        labState = state;
        await enrollAndLink(a);
        expect((await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' })).status).toBe(201);
      }
    });

    it('refuses a second enrollment while the first lab still exists (running or stopped)', async () => {
      const a = build();
      for (const state of ['running', 'stopped', 'provisioning']) {
        labState = undefined;
        await enrollAndLink(a);
        labState = state;
        const res = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/already enrolled .*remove the lab/);
        expect((await request(a).get('/capstones/enrollments')).body.enrollments).toHaveLength(1);
        await db('capstone_enrollments').del();
      }
    });

    it('asks for the lab of the CALLER (a task of someone else that names the repo is not their lab)', async () => {
      const a = build();
      labState = undefined;
      await enrollAndLink(a);
      labs.findLabTask.mockClear();
      labState = 'running';
      await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' });
      expect(labs.findLabTask).toHaveBeenCalledWith('https://github.com/example-org/r1', caller);
    });

    it('only looks at the caller\'s own enrollments in that capstone', async () => {
      const a = build();
      labState = 'running';
      await enrollAndLink(a);
      caller = 'other@example.com';
      expect((await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs-b' })).status).toBe(201);
      caller = 'trainee@example.com';
      seed.mockImplementationOnce(async () => ({ files: {}, laptopSeedFiles: {} }) as any);
      expect((await request(a).post('/capstones/enrollments').send({ capstone: 'terraform-b' })).status).toBe(201);
      expect((await request(a).get('/capstones/enrollments')).body.enrollments).toHaveLength(3);
    });
  });

  describe('instructor lab checks', () => {
    const build = (labs: any) => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).user = { email: 'trainer@example.com' };
        next();
      });
      a.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', checkRepo: okRepo, externalBaseUrl: async () => 'x', labs }));
      return a;
    };
    const seedTerraform = async () => {
      const store = new CapstoneStore(db);
      const { enrollment } = await store.enroll('terraform-b', 'tf@example.com', async () => ({
        seedManifest: { resources: { vpc: { id: 'vpc-1' } } },
        credentials: 'c',
        answerKey: 'k',
      }));
      await store.linkRepo(enrollment.id, 'tf@example.com', 'https://github.com/example-org/tf');
      return enrollment;
    };
    const lab = { task_id: 'prov-1', agent_id: 'agent-9', user_id: 'tf@example.com', resource_name: 'terraform-capstone-tf' };

    it('queues the predefined check against the trainee lab, built from the instructor-only manifest', async () => {
      const e = await seedTerraform();
      const queueCheck = jest.fn(async () => ({ task_id: 'chk-1' }));
      const app2 = build({ findLabTask: async () => lab, resourceState: async () => 'running', isAgentOnline: async () => true, agentVersion: async () => '0.1.23', queueCheck });
      const res = await request(app2).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`);
      expect(res.status).toBe(202);
      const call = (queueCheck.mock.calls[0] as any)[0];
      expect(call).toMatchObject({ userId: 'tf@example.com', agentId: 'agent-9', resourceName: 'terraform-capstone-tf' });
      expect(call.config).toMatchObject({ targetTaskId: 'prov-1', checkName: 'seeded-resources', service: 'ministack' });
      expect(call.config.argv.slice(0, 2)).toEqual(['python3', '-c']);
      expect(JSON.parse(call.config.argv[3])).toEqual({ key: `1110000000${e.traineeNo}`, resources: { vpc: { id: 'vpc-1' } } });
    });

    it('looks for the lab of the ENROLLED trainee only: an instructor check never goes to a task of someone else that names the same repo', async () => {
      const e = await seedTerraform();
      const asked: Array<[string, string]> = [];
      const queueCheck = jest.fn(async () => ({ task_id: 'chk-1' }));
      // A store that, like the real one, finds nothing when the owner is not the enrolled trainee.
      const findLabTask = jest.fn(async (repoUrl: string, owner: string) => {
        asked.push([repoUrl, owner]);
        return owner === 'tf@example.com' ? lab : undefined;
      });
      const app2 = build({ findLabTask, resourceState: async () => 'running', isAgentOnline: async () => true, agentVersion: async () => '0.1.23', queueCheck });
      expect((await request(app2).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`)).status).toBe(202);
      expect(asked).toEqual([['https://github.com/example-org/tf', 'tf@example.com']]);
      // The enrollment's owner has no lab (only someone else's task names the repo): nothing is queued.
      findLabTask.mockImplementation(async () => undefined);
      queueCheck.mockClear();
      const res = await request(app2).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`);
      expect(res.status).toBe(409);
      expect(queueCheck).not.toHaveBeenCalled();
    });

    it('refuses unknown checks, stopped labs and offline agents', async () => {
      const e = await seedTerraform();
      const base = { findLabTask: async () => lab, agentVersion: async () => '0.1.23', queueCheck: jest.fn() };
      expect((await request(build({ ...base, resourceState: async () => 'running', isAgentOnline: async () => true })).post(`/capstones/enrollments/${e.id}/checks/rm-rf`)).status).toBe(404);
      expect((await request(build({ ...base, resourceState: async () => 'running', isAgentOnline: async () => true })).post(`/capstones/enrollments/${e.id}/checks/constructor`)).status).toBe(404);
      expect((await request(build({ ...base, resourceState: async () => 'stopped', isAgentOnline: async () => true })).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`)).status).toBe(409);
      expect((await request(build({ ...base, resourceState: async () => 'running', isAgentOnline: async () => false })).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`)).status).toBe(409);
      expect((await request(build({ ...base, resourceState: async () => 'running', isAgentOnline: async () => true, agentVersion: async () => '0.1.22' })).post(`/capstones/enrollments/${e.id}/checks/seeded-resources`)).body.error).toMatch(/too old/);
      expect(base.queueCheck).not.toHaveBeenCalled();
    });

    it('grading job: fetches the grader from the capstone repo and sends the job (manifest, credentials, clone of the submission)', async () => {
      const { queueEnrollmentCheck } = require('./capstoneRoutes');
      const e = await seedTerraform();
      const fetchSourceFile = jest.fn(async () => Buffer.from('print("grade")').toString('base64'));
      const queueCheck = jest.fn(async () => ({ task_id: 'g1' }));
      const labs = {
        findLabTask: async () => lab, resourceState: async () => 'running', isAgentOnline: async () => true,
        agentVersion: async () => '0.1.23', queueCheck, fetchSourceFile,
      };
      expect(await queueEnrollmentCheck(new CapstoneStore(db), labs, e.id, 'grade-pre')).toEqual({ status: 202, taskId: 'g1' });
      expect(fetchSourceFile).toHaveBeenCalledWith('strat-training/terraform-training-capstone-b', 'main', 'instructor/seed/grade.py');
      const job = (queueCheck.mock.calls[0] as any)[0].config.job;
      expect(job).toMatchObject({
        image: 'hashicorp/terraform:1.11.4',
        clone: { url: 'https://github.com/example-org/tf', ref: 'capstone-final' },
        networkOfService: 'ministack',
        command: ['sh', '/job/run.sh'],
        outFile: 'out.json',
      });
      expect(job.env).toMatchObject({ PHASE: 'pre', AWS_ACCESS_KEY_ID: `0000000000${e.traineeNo}` });
      expect(Buffer.from(job.files['manifest.json'], 'base64').toString()).toBe(JSON.stringify({ resources: { vpc: { id: 'vpc-1' } } }));
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toContain('py3-boto3 grep');
    });

    it('Capstone A: grades on a throwaway database in the lab PostgreSQL, gives trainees no instructor guide', () => {
      const { CAPSTONES, NODE_LAB_IMAGE } = require('./definitions');
      const a = CAPSTONES['nodejs-a'];
      expect(a.traineeDocs).toEqual([]); // CAPSTONE.md lists the planted issues
      expect(a.checks.grade.needsSourceFiles).toEqual(['instructor/grader/grade.mjs']);
      const job = a.checks.grade.job({ manifest: {}, credentials: '', traineeNo: '03', repoUrl: 'https://github.com/o/r', sourceFiles: { 'instructor/grader/grade.mjs': 'Z3JhZGU=' } });
      expect(job).toMatchObject({
        image: NODE_LAB_IMAGE,
        clone: { url: 'https://github.com/o/r', ref: 'capstone-final' },
        networkOfService: 'db',
        env: { GRADER_ADMIN_DB_URL: 'postgresql://biyahe:biyahe@db:5432/postgres' },
        outFile: 'out.json',
      });
      expect(Object.keys(job.files).sort()).toEqual(['grade.mjs', 'run.sh']);
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toContain('--admin-db-url "$GRADER_ADMIN_DB_URL"');
      expect(a.handout).toMatchObject({ label: 'Day-3 change request', targetPath: 'docs/requirements/change-request-holidays.md' });
    });

    it('Terraform Capstone A: grades in a throwaway terraform job on the lab network, never resets the emulator', () => {
      const { CAPSTONES, TERRAFORM_A_GRADE_JOB_SCRIPT } = require('./definitions');
      const a = CAPSTONES['terraform-a'];
      expect(a).toMatchObject({ seedMode: 'server', selfHostedRunner: true, traineeDocs: [] }); // CAPSTONE.md lists the planted issues
      expect(a.checks.grade.needsSourceFiles).toEqual(['instructor/grader/grade.py']);
      const job = a.checks.grade.job({ manifest: {}, credentials: '', traineeNo: '07', repoUrl: 'https://github.com/o/r', sourceFiles: { 'instructor/grader/grade.py': 'Z3JhZGU=' } });
      expect(job).toMatchObject({
        image: 'hashicorp/terraform:1.11.4',
        clone: { url: 'https://github.com/o/r', ref: 'capstone-final' },
        networkOfService: 'ministack',
        command: ['sh', '/job/run.sh'],
        env: { AWS_ENDPOINT_URL: 'http://ministack:4566', TRAINEE_NO: '07' },
        outFile: 'out.json',
      });
      expect(Object.keys(job.files).sort()).toEqual(['grade.py', 'run.sh']);
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toBe(TERRAFORM_A_GRADE_JOB_SCRIPT);
      expect(TERRAFORM_A_GRADE_JOB_SCRIPT).toContain('py3-boto3 py3-yaml');
      expect(TERRAFORM_A_GRADE_JOB_SCRIPT).toContain('"$TRAINEE_NO"');
      // The emulator's reset wipes every account, the trainee's own included: nothing in the job may call it.
      expect(TERRAFORM_A_GRADE_JOB_SCRIPT).not.toMatch(/_ministack\/reset/);
      expect(a.handout).toMatchObject({ label: 'Day-3 change request', targetPath: 'docs/requirements/change-request-partners.md', branch: 'client/partner-access' });
    });

    it('Linux Capstone A: grades as root inside the trainee VM, has no CI runner, hands out the rsync change request', () => {
      const { CAPSTONES, LINUX_A_GRADE_JOB_SCRIPT } = require('./definitions');
      const a = CAPSTONES['linux-a'];
      expect(a).toMatchObject({ seedMode: 'server', traineeDocs: [] });
      expect(a.selfHostedRunner).toBeUndefined(); // a VM lab: no repo runner on the laptop
      const job = a.checks.grade.job({ manifest: {}, credentials: '', traineeNo: '04', repoUrl: 'https://github.com/o/r', sourceFiles: { 'instructor/grader/grade.py': 'Z3JhZGU=' } });
      expect(job).toMatchObject({ clone: { url: 'https://github.com/o/r', ref: 'capstone-final' }, command: ['bash', '{{job}}/run.sh', '{{job}}'], outFile: 'out.json' });
      expect(job.image).toBeUndefined(); // no container: the job runs in the VM
      expect(Object.keys(job.files).sort()).toEqual(['grade.py', 'run.sh']);
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toBe(LINUX_A_GRADE_JOB_SCRIPT);
      expect(a.handout).toMatchObject({ label: 'Day-3 change request', targetPath: 'docs/requirements/change-request-rsync.md', branch: 'client/rsync-partners' });
    });

    it('Python Capstone A: grades with a hidden source inside the job, on the lab network, hands out the second-vendor change request', () => {
      const { CAPSTONES, PYTHON_A_GRADE_JOB_SCRIPT, PYTHON_LAB_IMAGE } = require('./definitions');
      const a = CAPSTONES['python-a'];
      expect(a).toMatchObject({ seedMode: 'server', traineeDocs: [] }); // CAPSTONE.md is the instructor guide
      expect(a.selfHostedRunner).toBeUndefined();
      const wanted = ['instructor/grader/grade.py', 'instructor/grader/oracle.py', 'instructor/grader/vendor_b.py', 'instructor/gen/generator.py', 'instructor/gen/source_server.py'];
      expect(a.checks.grade.needsSourceFiles).toEqual(wanted);
      const sourceFiles = Object.fromEntries(wanted.map(p => [p, Buffer.from(p).toString('base64')]));
      const job = a.checks.grade.job({ manifest: {}, credentials: '', traineeNo: '05', repoUrl: 'https://github.com/o/r', sourceFiles });
      expect(job).toMatchObject({
        image: PYTHON_LAB_IMAGE,
        clone: { url: 'https://github.com/o/r', ref: 'capstone-final' },
        networkOfService: 'postgres',
        command: ['bash', '/job/run.sh'],
        env: { DB_ADMIN_URL: 'postgresql://suki:suki@postgres:5432/postgres', S3_ENDPOINT: 'http://objectstore:4566', TRAINEE_NO: '05' },
        outFile: 'out.json',
      });
      // The job folder is flat (agent validateLabJob): every grader file is a plain name. The grader files do reach the trainee's laptop (the job runs there); only the handover answer key stays out.
      expect(Object.keys(job.files).sort()).toEqual(['generator.py', 'grade.py', 'oracle.py', 'run.sh', 'source_server.py', 'vendor_b.py']);
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toBe(PYTHON_A_GRADE_JOB_SCRIPT);
      expect(PYTHON_A_GRADE_JOB_SCRIPT).toContain('"$DB_ADMIN_URL"');
      expect(PYTHON_LAB_IMAGE).toBe('python:3.12.12-bookworm'); // same tag as the lab's dev container: already pulled, and it has git
      expect(a.handout).toMatchObject({ label: 'Day-3 change request', sourcePath: 'instructor/day3-handout', targetPath: 'docs/requirements/vendor-b', branch: 'client/second-pos-vendor' });
    });

    // Reads the lab template from ENGINEERING_STANDARDS_DIR (default: the sibling checkout, like labTemplates.render.test.ts).
    // Without a checkout the test is reported as skipped, never as passed.
    const fsx = require('fs');
    const pathx = require('path');
    const esRoot = process.env.ENGINEERING_STANDARDS_DIR ?? pathx.resolve(__dirname, '../../../../../engineering-standards');
    const labRoot = pathx.join(esRoot, 'templates/training/python-capstone-a-training-local');
    const labPresent = fsx.existsSync(pathx.join(labRoot, 'skeleton/compose/docker-compose.yml'));
    (labPresent ? it : it.skip)('Python Capstone A: the grade job constants match the lab template that the trainee gets', () => {
      const text = fsx.readFileSync(pathx.join(labRoot, 'skeleton/compose/docker-compose.yml'), 'utf8');
      const { CAPSTONES, PYTHON_LAB_IMAGE, PYTHON_A_LAB_DB_ADMIN_URL, PYTHON_A_LAB_S3_ENDPOINT } = require('./definitions');
      const job = CAPSTONES['python-a'].checks.grade.job({ manifest: {}, credentials: '', traineeNo: '01', repoUrl: 'https://github.com/o/r', sourceFiles: {} });
      // the job joins the network of the service it names and reaches the others by their compose names
      expect(text).toMatch(new RegExp(`^  ${job.networkOfService}:`, 'm'));
      expect(text).toContain(`image: ${PYTHON_LAB_IMAGE}`);
      const url = new URL(PYTHON_A_LAB_DB_ADMIN_URL);
      expect(text).toMatch(new RegExp(`^  ${url.hostname}:`, 'm')); // service name = host in the URL
      expect(text).toContain(`POSTGRES_USER: ${url.username}`);
      expect(text).toContain(`POSTGRES_PASSWORD: ${url.password}`);
      expect(new URL(PYTHON_A_LAB_S3_ENDPOINT).hostname).toBe('objectstore');
      expect(text).toMatch(/^  objectstore:/m);
      expect(text).toContain('PERSIST_STATE: "1"'); // the trainee's bucket survives a restart of the lab
      // the files the lab ships are data and a server, not the generator or the grader (a local __pycache__ is not shipped: it is gitignored)
      const shipped = fsx.readdirSync(pathx.join(labRoot, 'skeleton/source')).filter((n: string) => n !== '__pycache__').sort();
      expect(shipped).toEqual(['drops', 'lab_source.py', 'sample_data.json', 'seed_drops.py']);
    });

    it('compares agent versions numerically', () => {
      const { supportsChecks } = require('./capstoneRoutes');
      expect([supportsChecks('0.1.23'), supportsChecks('0.1.100'), supportsChecks('0.2.0'), supportsChecks('1.0.0')]).toEqual([true, true, true, true]);
      expect([supportsChecks('0.1.22'), supportsChecks('0.1.9'), supportsChecks(undefined), supportsChecks('dev')]).toEqual([false, false, false, false]);
    });
  });
});
