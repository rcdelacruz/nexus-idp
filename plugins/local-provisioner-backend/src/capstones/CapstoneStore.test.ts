import knexFactory, { Knex } from 'knex';
import { CapstoneStore, nextTraineeNo, ABANDON_AFTER_MS } from './CapstoneStore';

// eslint-disable-next-line @backstage/no-relative-monorepo-imports
const migration = require('../database/migrations/006-create-capstone-enrollments.js');

const secrets = (no: string) => ({ seedManifest: { trainee: no }, credentials: `creds-${no}`, answerKey: `key-${no}`, files: { 'a.txt': 'x' } });

describe('CapstoneStore', () => {
  let db: Knex;
  let now: Date;
  let store: CapstoneStore;

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    now = new Date('2026-10-30T10:00:00Z');
    store = new CapstoneStore(db, () => now);
  });
  afterEach(() => db.destroy());

  it('hands out the lowest free trainee number and stores the seed secrets', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    const b = await store.enroll('nodejs', 'b@x.com', async no => secrets(no));
    expect([a.enrollment.traineeNo, b.enrollment.traineeNo]).toEqual(['01', '02']);
    expect(a.seeded.files).toEqual({ 'a.txt': 'x' });
    expect(await store.getSecrets(a.enrollment.id)).toEqual({ seedManifest: { trainee: '01' }, credentials: 'creds-01', answerKey: 'key-01' });
  });

  it('numbers capstones independently', async () => {
    await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    const t = await store.enroll('terraform', 'a@x.com', async no => secrets(no));
    expect(t.enrollment.traineeNo).toBe('01');
  });

  it('never exposes secrets in the list or summary', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    const listed = await store.list();
    expect(JSON.stringify(listed)).not.toMatch(/creds-|key-|seedManifest/);
    expect(JSON.stringify(await store.get(a.enrollment.id))).not.toMatch(/creds-|key-/);
  });

  it('links the repo once, only for the enrolled trainee, and activates the enrollment', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    expect(await store.linkRepo(a.enrollment.id, 'someone-else@x.com', 'https://github.com/o/r')).toBeUndefined();
    const linked = await store.linkRepo(a.enrollment.id, 'a@x.com', 'https://github.com/o/r');
    expect(linked).toMatchObject({ status: 'active', repoUrl: 'https://github.com/o/r' });
    expect(await store.linkRepo(a.enrollment.id, 'a@x.com', 'https://github.com/o/other')).toBeUndefined();
  });

  it('frees the number of a seeded enrollment that never got a repo after an hour', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    now = new Date(now.getTime() + ABANDON_AFTER_MS - 1000);
    expect((await store.enroll('nodejs', 'b@x.com', async no => secrets(no))).enrollment.traineeNo).toBe('02');
    now = new Date(now.getTime() + 2 * ABANDON_AFTER_MS);
    // 01 (never linked) and 02 (never linked) are both abandoned now.
    expect((await store.enroll('nodejs', 'c@x.com', async no => secrets(no))).enrollment.traineeNo).toBe('01');
    expect(a.enrollment.traineeNo).toBe('01');
  });

  it('keeps an active enrollment\'s number forever', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    await store.linkRepo(a.enrollment.id, 'a@x.com', 'https://github.com/o/r');
    now = new Date(now.getTime() + 10 * ABANDON_AFTER_MS);
    expect((await store.enroll('nodejs', 'b@x.com', async no => secrets(no))).enrollment.traineeNo).toBe('02');
  });

  it('stores nothing when the seed fails', async () => {
    await expect(
      store.enroll('nodejs', 'a@x.com', async () => {
        throw new Error('seed failed');
      }),
    ).rejects.toThrow('seed failed');
    expect(await store.list()).toEqual([]);
  });

  it('records the handout PR', async () => {
    const a = await store.enroll('nodejs', 'a@x.com', async no => secrets(no));
    await store.recordHandout(a.enrollment.id, 'https://github.com/o/r/pull/1');
    expect(await store.get(a.enrollment.id)).toMatchObject({ handoutPrUrl: 'https://github.com/o/r/pull/1', handoutAt: now.toISOString() });
  });
});

describe('nextTraineeNo', () => {
  it('prefers the given number when it is free', () => {
    expect(nextTraineeNo(['01', '03'], '02')).toBe('02');
    expect(nextTraineeNo(['01', '02'], '02')).toBe('03'); // taken → lowest free
    expect(nextTraineeNo([], '00')).toBe('01');
    expect(nextTraineeNo([], 'x')).toBe('01');
  });
  it('fills gaps and stops at 99', () => {
    expect(nextTraineeNo([])).toBe('01');
    expect(nextTraineeNo(['01', '03'])).toBe('02');
    expect(nextTraineeNo(Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0')))).toBeUndefined();
  });
});
