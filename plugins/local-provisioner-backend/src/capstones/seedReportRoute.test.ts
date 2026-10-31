import express from 'express';
import request from 'supertest';
import knexFactory, { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { CapstoneStore } from './CapstoneStore';
import { createSeedReportRoute, sha256Hex, validateSeedReport } from './seedReportRoute';
import { isPublicAgentPath } from '../util/publicPaths';

const migration = require('../database/migrations/006-create-capstone-enrollments.js');

const TOKEN = 'A'.repeat(43);
const report = { manifest: { trainee: '07', resources: {} }, credentials: 'rds pw', answerKey: '# answers', handover: '# handover' };

describe('POST /capstones/seed-report/:id', () => {
  let db: Knex;
  let store: CapstoneStore;
  let app: express.Express;
  let id: string;
  let now: Date;
  const commitFile = jest.fn(async () => undefined);

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    now = new Date('2026-10-30T10:00:00Z');
    store = new CapstoneStore(db, () => now);
    const { enrollment } = await store.enroll('terraform', 't@x.com', async () => ({
      seedTokenHash: sha256Hex(TOKEN),
      seedTokenExpiresAt: new Date(now.getTime() + 3600_000),
    }));
    id = enrollment.id;
    app = express();
    // The real router mounts this BEFORE its 10 MB parser — mirror that (no global parser here).
    app.use('/capstones/seed-report', createSeedReportRoute({ store, logger: mockServices.logger.mock(), getGithubToken: async () => 'gh', commitFile: commitFile as any }));
  });
  afterEach(() => db.destroy());

  const post = (path: string, body: unknown, token?: string) => {
    const r = request(app).post(path).send(body as object);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('accepts the report once, stores it instructor-only, and marks it laptop-reported', async () => {
    expect((await post(`/capstones/seed-report/${id}`, report, TOKEN)).status).toBe(204);
    expect(await store.getSecrets(id)).toEqual({ seedManifest: report.manifest, credentials: 'rds pw', answerKey: '# answers' });
    expect(await store.get(id)).toMatchObject({ awaitingSeedReport: false, seedReportedAt: now.toISOString() });
    // Replay: same token, now cleared.
    expect((await post(`/capstones/seed-report/${id}`, report, TOKEN)).status).toBe(401);
  });

  it('answers the same 401 for no token, a wrong token, an unknown id and an expired token', async () => {
    expect((await post(`/capstones/seed-report/${id}`, report)).status).toBe(401);
    expect((await post(`/capstones/seed-report/${id}`, report, 'B'.repeat(43))).status).toBe(401);
    expect((await post(`/capstones/seed-report/00000000-0000-0000-0000-000000000000`, report, TOKEN)).status).toBe(401);
    now = new Date(now.getTime() + 2 * 3600_000);
    expect((await post(`/capstones/seed-report/${id}`, report, TOKEN)).status).toBe(401);
    expect(await store.getSecrets(id)).toBeUndefined();
  });

  it('checks the token before reading the body, and caps the body', async () => {
    const big = { ...report, answerKey: 'x'.repeat(2 * 1024 * 1024) };
    expect((await post(`/capstones/seed-report/${id}`, big)).status).toBe(401); // no token: never parsed
    expect((await post(`/capstones/seed-report/${id}`, big, TOKEN)).status).toBe(413);
  });

  it('commits HANDOVER.md at the fixed path once the repo is linked', async () => {
    await store.linkRepo(id, 't@x.com', 'https://github.com/stratpoint-engineering/tf');
    await post(`/capstones/seed-report/${id}`, report, TOKEN);
    expect(commitFile).toHaveBeenCalledWith({ owner: 'stratpoint-engineering', repo: 'tf' }, 'HANDOVER.md', '# handover', expect.any(String), 'gh');
  });

  it('rejects malformed or unexpected report bodies', () => {
    expect(validateSeedReport({ ...report, path: '../../x' })).toEqual({ error: 'unexpected fields' });
    expect(validateSeedReport({ ...report, manifest: [] })).toEqual({ error: 'manifest must be an object' });
    expect(validateSeedReport({ ...report, handover: '' })).toEqual({ error: 'handover must be a non-empty string' });
    expect('report' in validateSeedReport(report)).toBe(true);
  });
});

describe('public paths', () => {
  it('makes only the seed-report route public under /capstones', () => {
    expect(isPublicAgentPath('/capstones/seed-report/abc')).toBe(true);
    expect(isPublicAgentPath('/capstones/enrollments')).toBe(false);
    expect(isPublicAgentPath('/capstones/enrollments/abc/secrets')).toBe(false);
    expect(isPublicAgentPath('/capstones')).toBe(false);
    expect(isPublicAgentPath('/capstones/seed-report')).toBe(false);
  });
});
