import express from 'express';
import request from 'supertest';
import knexFactory, { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { createCapstoneRoutes } from './capstoneRoutes';
import { CapstoneStore } from './CapstoneStore';

const migration = require('../database/migrations/006-create-capstone-enrollments.js');

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
  const handout = jest.fn(async () => ({ prUrl: 'https://github.com/stratpoint-engineering/r/pull/1', created: true }));
  const runnerToken = jest.fn(async () => ({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' }));
  const commitHandover = jest.fn(async () => false);

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    caller = 'trainee@example.com';
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: caller };
      next();
    });
    app.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', externalBaseUrl: async () => 'https://portal.example/api/local-provisioner', seed: seed as any, handout: handout as any, runnerToken: runnerToken as any, commitHandover: commitHandover as any }));
  });
  afterEach(() => db.destroy());

  it('enrolls the caller and returns only the trainee files', async () => {
    const res = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs' });
    expect(res.status).toBe(201);
    expect(res.body.enrollment).toMatchObject({ capstone: 'nodejs', traineeEmail: 'trainee@example.com', traineeNo: '01', status: 'seeded' });
    expect(res.body.files['HANDOVER.md']).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/secret-pw|answers-|"manifest"/);
  });

  it('rejects an unknown capstone (including prototype keys)', async () => {
    expect((await request(app).post('/capstones/enrollments').send({ capstone: 'nope' })).status).toBe(400);
    expect((await request(app).post('/capstones/enrollments').send({ capstone: 'constructor' })).status).toBe(400);
  });

  it('lets only the enrolled trainee link a github.com repo, once', async () => {
    const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs' });
    const id = body.enrollment.id;
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://gitlab.com/a/b' })).status).toBe(400);
    caller = 'someone-else@example.com';
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/r' })).status).toBe(404);
    caller = 'trainee@example.com';
    const ok = await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/r' });
    expect(ok.status).toBe(200);
    expect(ok.body.enrollment.status).toBe('active');
    expect((await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/x' })).status).toBe(404);
  });

  it('reveals secrets (audit-logged) and opens the handout on the linked repo', async () => {
    const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'nodejs' });
    const id = body.enrollment.id;
    expect((await request(app).post(`/capstones/enrollments/${id}/handout`)).status).toBe(409); // no repo yet
    await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/r' });

    caller = 'instructor@example.com';
    const secrets = await request(app).get(`/capstones/enrollments/${id}/secrets`);
    expect(secrets.status).toBe(200);
    expect(secrets.body).toMatchObject({ credentials: 'secret-pw-01', answerKey: 'answers-01', seedManifest: { trainee: '01' } });
    expect(secrets.body.gradeCommand).toMatch(/grade\.mjs/);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/secrets revealed by instructor@example.com/), expect.objectContaining({ audit: true }));

    const h = await request(app).post(`/capstones/enrollments/${id}/handout`);
    expect(h.status).toBe(200);
    expect(handout).toHaveBeenCalledWith(expect.objectContaining({ id: 'nodejs' }), { owner: 'stratpoint-engineering', repo: 'r' }, 'tok');
    const listed = await request(app).get('/capstones/enrollments');
    expect(listed.body.enrollments[0]).toMatchObject({ handoutPrUrl: 'https://github.com/stratpoint-engineering/r/pull/1' });
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
      const res = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform' });
      expect(res.status).toBe(201);
      expect(res.body.enrollment).toMatchObject({ capstone: 'terraform', awaitingSeedReport: true });
      expect(res.body.laptopSeed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body.laptopSeed.reportUrl).toBe(`https://portal.example/api/local-provisioner/capstones/seed-report/${res.body.enrollment.id}`);
      expect(Object.keys(res.body.laptopSeed.files)).toEqual(['seed_prod.py']);
      const row = await db('capstone_enrollments').where({ id: res.body.enrollment.id }).first();
      expect(row.seed_token_hash).toHaveLength(64);
      expect(row.seed_token_hash).not.toContain(res.body.laptopSeed.token);
      expect(row.credentials).toBeNull();
    });

    it('mints a runner registration token and tries the handover when the repo is linked', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform' });
      const res = await request(app).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/tf' });
      expect(res.status).toBe(200);
      expect(res.body.runner).toEqual({ token: 'RUNNER-REG', expiresAt: '2026-10-30T11:00:00Z' });
      expect(runnerToken).toHaveBeenCalledWith({ owner: 'stratpoint-engineering', repo: 'tf' }, 'tok');
      expect(commitHandover).toHaveBeenCalled();
    });

    it('remove: hides the enrollment, frees its trainee number, cancels the seed token (audit-logged)', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform' });
      const id = body.enrollment.id;
      await request(app).put(`/capstones/enrollments/${id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/tf' });
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
      const again = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform' });
      expect(again.body.enrollment.traineeNo).toBe(body.enrollment.traineeNo);
    });

    it('has no instructor data until the laptop reports', async () => {
      const { body } = await request(app).post('/capstones/enrollments').send({ capstone: 'terraform' });
      expect((await request(app).get(`/capstones/enrollments/${body.enrollment.id}/secrets`)).status).toBe(404);
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
      a.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', externalBaseUrl: async () => 'x', seed: seed as any, labs }));
      return a;
    };
    const enrollAndLink = async (a: express.Express) => {
      const { body } = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' });
      await request(a).put(`/capstones/enrollments/${body.enrollment.id}/repo`).send({ repoUrl: 'https://github.com/stratpoint-engineering/r1' });
      return body.enrollment;
    };

    it('a re-run after a failed run replaces the dead enrollment and keeps the trainee number', async () => {
      const a = build();
      labState = undefined; // the scaffolder failed before the lab was provisioned
      const first = await enrollAndLink(a);
      const again = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' });
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
      const again = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' });
      expect(mine.traineeNo).toBe('02');
      expect(again.body.enrollment.traineeNo).toBe('02');
    });

    it('a removed or failed lab does not block starting over', async () => {
      const a = build();
      for (const state of ['removed', 'error']) {
        labState = state;
        await enrollAndLink(a);
        expect((await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' })).status).toBe(201);
      }
    });

    it('refuses a second enrollment while the first lab still exists (running or stopped)', async () => {
      const a = build();
      for (const state of ['running', 'stopped', 'provisioning']) {
        labState = undefined;
        await enrollAndLink(a);
        labState = state;
        const res = await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/already enrolled .*remove the lab/);
        expect((await request(a).get('/capstones/enrollments')).body.enrollments).toHaveLength(1);
        await db('capstone_enrollments').del();
      }
    });

    it('only looks at the caller\'s own enrollments in that capstone', async () => {
      const a = build();
      labState = 'running';
      await enrollAndLink(a);
      caller = 'other@example.com';
      expect((await request(a).post('/capstones/enrollments').send({ capstone: 'nodejs' })).status).toBe(201);
      caller = 'trainee@example.com';
      seed.mockImplementationOnce(async () => ({ files: {}, laptopSeedFiles: {} }) as any);
      expect((await request(a).post('/capstones/enrollments').send({ capstone: 'terraform' })).status).toBe(201);
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
      a.use('/capstones', createCapstoneRoutes({ store: new CapstoneStore(db), logger, getGithubToken: async () => 'tok', externalBaseUrl: async () => 'x', labs }));
      return a;
    };
    const seedTerraform = async () => {
      const store = new CapstoneStore(db);
      const { enrollment } = await store.enroll('terraform', 'tf@example.com', async () => ({
        seedManifest: { resources: { vpc: { id: 'vpc-1' } } },
        credentials: 'c',
        answerKey: 'k',
      }));
      await store.linkRepo(enrollment.id, 'tf@example.com', 'https://github.com/stratpoint-engineering/tf');
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

    it('scheduler path: skips a lab that still has a check pending, the Run button path does not ask', async () => {
      const { queueEnrollmentCheck } = require('./capstoneRoutes');
      const e = await seedTerraform();
      const labs = {
        findLabTask: async () => lab, resourceState: async () => 'running', isAgentOnline: async () => true,
        agentVersion: async () => '0.1.23', hasPendingCheck: jest.fn(async () => true), queueCheck: jest.fn(async () => ({ task_id: 'c' })),
      };
      const skipped = await queueEnrollmentCheck(new CapstoneStore(db), labs, e.id, 'seeded-resources', { skipIfPending: true });
      expect(skipped).toMatchObject({ status: 409, error: 'A check is already pending on this lab' });
      expect(labs.queueCheck).not.toHaveBeenCalled();
      const manual = await queueEnrollmentCheck(new CapstoneStore(db), labs, e.id, 'seeded-resources');
      expect(manual).toEqual({ status: 202, taskId: 'c' });
    });

    it('grading job: fetches the grader from the capstone repo and sends the job (manifest, credentials, clone of the submission)', async () => {
      const { queueEnrollmentCheck } = require('./capstoneRoutes');
      const e = await seedTerraform();
      const fetchSourceFile = jest.fn(async () => Buffer.from('print("grade")').toString('base64'));
      const queueCheck = jest.fn(async () => ({ task_id: 'g1' }));
      const labs = {
        findLabTask: async () => lab, resourceState: async () => 'running', isAgentOnline: async () => true,
        agentVersion: async () => '0.1.23', hasPendingCheck: async () => false, queueCheck, fetchSourceFile,
      };
      expect(await queueEnrollmentCheck(new CapstoneStore(db), labs, e.id, 'grade-pre')).toEqual({ status: 202, taskId: 'g1' });
      expect(fetchSourceFile).toHaveBeenCalledWith('strat-training/terraform-training-capstone', 'main', 'instructor/seed/grade.py');
      const job = (queueCheck.mock.calls[0] as any)[0].config.job;
      expect(job).toMatchObject({
        image: 'hashicorp/terraform:1.11.4',
        clone: { url: 'https://github.com/stratpoint-engineering/tf', ref: 'capstone-final' },
        networkOfService: 'ministack',
        command: ['sh', '/job/run.sh'],
        outFile: 'out.json',
      });
      expect(job.env).toMatchObject({ PHASE: 'pre', AWS_ACCESS_KEY_ID: `0000000000${e.traineeNo}` });
      expect(Buffer.from(job.files['manifest.json'], 'base64').toString()).toBe(JSON.stringify({ resources: { vpc: { id: 'vpc-1' } } }));
      expect(Buffer.from(job.files['run.sh'], 'base64').toString()).toContain('py3-boto3 grep');
    });

    it('marks grading as instructor-only (never scheduled) and the resources check as scheduled', () => {
      const { CAPSTONES } = require('./definitions');
      const c = CAPSTONES.terraform.checks;
      expect([c['seeded-resources'].scheduled, c['grade-pre'].scheduled, c['grade-post'].scheduled]).toEqual([undefined, false, false]);
    });

    it('compares agent versions numerically', () => {
      const { supportsChecks } = require('./capstoneRoutes');
      expect([supportsChecks('0.1.23'), supportsChecks('0.1.100'), supportsChecks('0.2.0'), supportsChecks('1.0.0')]).toEqual([true, true, true, true]);
      expect([supportsChecks('0.1.22'), supportsChecks('0.1.9'), supportsChecks(undefined), supportsChecks('dev')]).toEqual([false, false, false, false]);
    });
  });
});

