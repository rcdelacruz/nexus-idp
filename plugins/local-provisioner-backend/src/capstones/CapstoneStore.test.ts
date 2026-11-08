import knexFactory, { Knex } from 'knex';
import { CapstoneStore, nextTraineeNo, ABANDON_AFTER_MS } from './CapstoneStore';

// eslint-disable-next-line @backstage/no-relative-monorepo-imports
const migration = require('../database/migrations/006-create-capstone-enrollments.js');
const completion = require('../database/migrations/010-capstone-completion.js');

const secrets = (no: string) => ({ seedManifest: { trainee: no }, credentials: `creds-${no}`, answerKey: `key-${no}`, files: { 'a.txt': 'x' } });

describe('CapstoneStore', () => {
  let db: Knex;
  let now: Date;
  let store: CapstoneStore;

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    await completion.up(db);
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

describe('CapstoneStore: marking a capstone done', () => {
  let db: Knex;
  let now: Date;
  let store: CapstoneStore;

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
    await completion.up(db);
    now = new Date('2026-10-30T10:00:00Z');
    store = new CapstoneStore(db, () => now);
  });
  afterEach(() => db.destroy());

  describe('marking a capstone done', () => {
    const REPORT = { version: 1, trainee: 'a@x.com', lab: 'lab', course: 'nodejs', summary: ['s'], checks: [], history: [] };
    const active = async (email = 'a@x.com', capstone = 'nodejs') => {
      const e = (await store.enroll(capstone, email, async no => secrets(no))).enrollment;
      await store.linkRepo(e.id, email, `https://github.com/o/${e.id}`);
      return e;
    };

    it('stamps who and when, keeps the report, and the list says a report exists without carrying it', async () => {
      const e = await active();
      now = new Date('2026-11-06T09:30:00Z');
      const done = await store.complete(e.id, 'teacher@x.com', REPORT);
      expect(done).toMatchObject({ status: 'completed', completedBy: 'teacher@x.com', completedAt: '2026-11-06T09:30:00.000Z', hasReport: true });
      expect(await store.getReport(e.id)).toEqual({ report: REPORT, completedAt: '2026-11-06T09:30:00.000Z', completedBy: 'teacher@x.com' });
      const listed = (await store.list()).find(x => x.id === e.id)!;
      expect(listed).toMatchObject({ status: 'completed', hasReport: true });
      expect(JSON.stringify(listed)).not.toContain('"summary"');
    });

    it('only an active capstone can be completed, and only once', async () => {
      const seeded = (await store.enroll('nodejs', 'b@x.com', async no => secrets(no))).enrollment; // no repository yet
      expect(await store.complete(seeded.id, 't@x.com', REPORT)).toBeUndefined();
      const e = await active();
      expect(await store.complete(e.id, 't@x.com', REPORT)).toBeDefined();
      expect(await store.complete(e.id, 'other@x.com', { ...REPORT, summary: ['changed'] })).toBeUndefined();
      expect((await store.getReport(e.id))?.completedBy).toBe('t@x.com');
      await store.withdraw(e.id);
      expect(await store.complete(e.id, 't@x.com', REPORT)).toBeUndefined();
    });

    it('a capstone without a completion has no report; a withdrawn one gives none back', async () => {
      const e = await active();
      expect(await store.getReport(e.id)).toBeUndefined();
      expect((await store.get(e.id))?.hasReport).toBe(false);
      await store.complete(e.id, 't@x.com', REPORT);
      await store.withdraw(e.id);
      expect(await store.getReport(e.id)).toBeUndefined();
    });

    it('reopening undoes it: back to active, the report is gone, and it can be completed again', async () => {
      const e = await active();
      await store.complete(e.id, 't@x.com', REPORT);
      const reopened = await store.reopen(e.id);
      expect(reopened).toMatchObject({ status: 'active', hasReport: false });
      expect(reopened?.completedAt).toBeUndefined();
      expect(await store.getReport(e.id)).toBeUndefined();
      expect(await store.complete(e.id, 't2@x.com', REPORT)).toBeDefined();
      expect(await store.reopen((await active('c@x.com')).id)).toBeUndefined(); // not completed: nothing to undo
    });

    it('a completed capstone keeps its trainee number, so a new enrollment never gets the same one', async () => {
      const e = await active();
      await store.complete(e.id, 't@x.com', REPORT);
      const next = await store.enroll('nodejs', 'a@x.com', async no => secrets(no), { preferTraineeNo: e.traineeNo });
      expect(next.enrollment.traineeNo).not.toBe(e.traineeNo);
    });

    it('refuses a report larger than the limit and changes nothing', async () => {
      const e = await active();
      await expect(store.complete(e.id, 't@x.com', { ...REPORT, summary: ['x'.repeat(600 * 1024)] })).rejects.toThrow(/larger than 512 KB/);
      expect((await store.get(e.id))?.status).toBe('active');
    });

    it('migration 010 goes down cleanly: a completed capstone becomes active again and the columns are gone', async () => {
      const e = await active();
      await store.complete(e.id, 't@x.com', REPORT);
      await completion.down(db);
      expect((await db('capstone_enrollments').where({ id: e.id }).first()).status).toBe('active');
      expect(await db.schema.hasColumn('capstone_enrollments', 'report')).toBe(false);
      await completion.up(db); // and back up for the clean-up in afterEach
    });
  });
});
