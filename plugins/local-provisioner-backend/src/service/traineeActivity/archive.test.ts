import knexFactory, { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { archiveRetentionDays, TraineeActivityService } from './TraineeActivityService';
import { CapstoneStore } from '../../capstones/CapstoneStore';
import { ResourceState } from '../../types';

const capstoneMigration = require('../../database/migrations/006-create-capstone-enrollments.js');
const completionMigration = require('../../database/migrations/010-capstone-completion.js');

const DAY = 86_400_000;
const NOW = new Date('2026-11-07T12:00:00Z');
const ORG = 'example-org';
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** Task store fake: the labs, and the removals table. */
function taskStore(labs: { agent: string; name: string; email: string; repoUrl: string }[]) {
  const removals: any[] = [];
  const histories = () =>
    labs.map(l => ({
        resource: { resource_name: l.name, resource_type: 'ministack', is_training: true, agent_id: l.agent, user_id: l.email, state: ResourceState.RUNNING, updated_at: NOW, latest_task_id: 't' },
        provision: { task_type: 'provision-training', created_at: daysAgo(500), config: { githubRepoUrl: l.repoUrl } },
        events: [],
      }));
  return {
    removals,
    getTrainingListData: async () => histories(),
    getTrainingResourceHistory: async (agentId: string, resourceName: string) =>
      histories().find(h => h.resource.agent_id === agentId && h.resource.resource_name === resourceName),
    getAgentById: async () => null,
    getAgentsByIds: async () => new Map(),
    removedTraineeLabs: async () => new Set(removals.filter(r => r.agentId).map(r => `${r.agentId}::${r.resourceName}`)),
    recordTraineeRemoval: async (r: any) => {
      removals.push(r);
    },
  } as any;
}

/** A GitHub that fails the test if it is ever called. */
const noGithub = () => {
  const calls: string[] = [];
  return {
    calls,
    fetchImpl: (async (url: string) => {
      calls.push(url);
      return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    }) as any,
  };
};

describe('archiveRetentionDays', () => {
  it.each([
    [undefined, 365],
    [0, 365],
    [-5, 365],
    [NaN, 365],
    ['90' as any, 365],
    [10, 30],
    [29.9, 30],
    [30, 30],
    [90, 90],
    [400.7, 400],
  ])('%p -> %p', (configured, expected) => expect(archiveRetentionDays(configured as any)).toBe(expected));
});

describe('the Archive of capstones marked done', () => {
  let db: Knex;
  let clock: Date;
  let capstones: CapstoneStore;
  let n = 0;

  beforeEach(async () => {
    db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await capstoneMigration.up(db);
    await completionMigration.up(db);
    clock = daysAgo(600);
    capstones = new CapstoneStore(db, () => clock);
    n = 0;
  });
  afterEach(async () => {
    await db.destroy();
  });

  /** A trainee who enrolled, linked a repo and (optionally) was marked done `doneDaysAgo` days before NOW. */
  const enrolled = async (email: string, doneDaysAgo?: number | { at: Date }) => {
    n += 1;
    clock = daysAgo(600);
    const { enrollment } = await capstones.enroll('nodejs', email, async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
    const repoUrl = `https://github.com/${ORG}/nodejs-capstone-${email.split('@')[0]}-${n}`;
    await capstones.linkRepo(enrollment.id, email, repoUrl);
    if (doneDaysAgo !== undefined) {
      clock = typeof doneDaysAgo === 'number' ? daysAgo(doneDaysAgo) : doneDaysAgo.at;
      await capstones.complete(enrollment.id, 'teacher@example.com', { version: 1, trainee: email, lab: 'l', course: 'c', summary: [], checks: [], history: [] });
    }
    return { id: enrollment.id, repoUrl, email };
  };
  const svc = (store: any, caps: any = capstones, days = 365, gh = noGithub()) =>
    new TraineeActivityService(store, async () => 'tok', mockServices.logger.mock(), gh.fetchImpl, () => NOW, caps, ORG, undefined, days);

  describe('in the Trainees list', () => {
    it('an archived capstone says when it will be deleted, and costs no GitHub calls', async () => {
      const done = await enrolled('done@example.com', 40);
      const gh = noGithub();
      const service = svc(taskStore([]), capstones, 365, gh);
      const rows = await service.listTrainees();
      const row = rows.find(r => r.capstone?.id === done.id)!;
      expect(row.capstone).toMatchObject({ status: 'completed', archiveRetentionDays: 365 });
      expect(row.capstone?.archiveExpiresAt).toBe(new Date(daysAgo(40).getTime() + 365 * DAY).toISOString());
      // Asking GitHub about it answers "archived" and makes no request: the kept report has the summary.
      const [item] = await service.activity([row.key], 'brief', false);
      expect(item).toMatchObject({ key: row.key, code: 'archived', note: expect.stringMatching(/Archived/) });
      expect(item.repo).toBeUndefined();
      expect(gh.calls).toEqual([]);
    });

    it('the expiry follows the configured number of days', async () => {
      const done = await enrolled('done@example.com', 10);
      const [row] = await svc(taskStore([]), capstones, 90).listTrainees();
      expect(row.capstone?.archiveRetentionDays).toBe(90);
      expect(row.capstone?.archiveExpiresAt).toBe(new Date(daysAgo(10).getTime() + 90 * DAY).toISOString());
      expect(row.capstone?.id).toBe(done.id);
    });

    it('a capstone that is not done has no expiry, and its GitHub activity is read', async () => {
      await enrolled('working@example.com');
      const gh = noGithub();
      const service = svc(taskStore([]), capstones, 365, gh);
      const [row] = await service.listTrainees();
      expect(row.capstone?.status).toBe('active');
      expect(row.capstone?.archiveExpiresAt).toBeUndefined();
      expect(gh.calls).toEqual([]); // the list itself never asks GitHub
      const [item] = await service.activity([row.key], 'brief', false);
      expect(item.code).not.toBe('archived');
      expect(gh.calls.length).toBeGreaterThan(0);
    });
  });

  describe('purgeArchive (the nightly retention)', () => {
    it('removes only what was marked done more than the retention ago, the way Remove trainee does, and never touches GitHub', async () => {
      const old = await enrolled('old@example.com', 400);
      const recent = await enrolled('recent@example.com', 100);
      const active = await enrolled('active@example.com');
      const store = taskStore([{ agent: 'a1', name: 'lab-old', email: 'old@example.com', repoUrl: old.repoUrl }]);
      const gh = noGithub();

      expect(await svc(store, capstones, 365, gh).purgeArchive(365)).toBe(1);

      expect((await capstones.get(old.id))?.status).toBe('withdrawn');
      expect(await capstones.getReport(old.id)).toBeUndefined();
      expect((await db('capstone_enrollments').where({ id: old.id }).first()).report).toBeNull(); // the kept report is gone, not only hidden
      expect((await db('capstone_enrollments').where({ id: recent.id }).first()).report).not.toBeNull();
      expect((await capstones.get(recent.id))?.status).toBe('completed');
      expect((await capstones.getReport(recent.id))?.report).toBeDefined();
      expect((await capstones.get(active.id))?.status).toBe('active');
      expect(store.removals).toEqual([
        expect.objectContaining({ agentId: 'a1', resourceName: 'lab-old', enrollmentId: old.id, traineeEmail: 'old@example.com', repoDeleted: false, removedBy: 'the archive retention' }),
      ]);
      expect(gh.calls).toEqual([]);
    });

    it('a capstone marked done exactly the retention ago is kept, one second older goes', async () => {
      const exact = await enrolled('exact@example.com', 365);
      const older = await enrolled('older@example.com', { at: new Date(NOW.getTime() - 365 * DAY - 1000) });
      expect(await svc(taskStore([]), capstones).purgeArchive(365)).toBe(1);
      expect((await capstones.get(exact.id))?.status).toBe('completed');
      expect((await capstones.get(older.id))?.status).toBe('withdrawn');
    });

    it('a capstone with no lab on the list is still removed, and another trainee\'s lab on the same repo is not hidden', async () => {
      const old = await enrolled('old@example.com', 400);
      const store = taskStore([{ agent: 'a9', name: 'someone-elses-lab', email: 'mallory@example.com', repoUrl: old.repoUrl }]);
      expect(await svc(store).purgeArchive(365)).toBe(1);
      expect((await capstones.get(old.id))?.status).toBe('withdrawn');
      expect(store.removals).toEqual([expect.objectContaining({ enrollmentId: old.id, agentId: undefined, resourceName: undefined })]);
    });

    it('one capstone failing does not stop the others, and is logged', async () => {
      const first = await enrolled('first@example.com', 500);
      const second = await enrolled('second@example.com', 450);
      const failing = {
        list: () => capstones.list(),
        get: (id: string) => capstones.get(id),
        withdraw: async (id: string) => {
          if (id === first.id) throw new Error('database went away');
          return capstones.withdraw(id);
        },
      };
      const logger = mockServices.logger.mock();
      const service = new TraineeActivityService(taskStore([]), async () => 'tok', logger, noGithub().fetchImpl, () => NOW, failing as any, ORG, undefined, 365);
      expect(await service.purgeArchive(365)).toBe(1);
      expect((await capstones.get(first.id))?.status).toBe('completed');
      expect((await capstones.get(second.id))?.status).toBe('withdrawn');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/first@example\.com.*database went away/));
    });

    it('does nothing when there are no capstones or none is old enough', async () => {
      await enrolled('recent@example.com', 10);
      expect(await svc(taskStore([])).purgeArchive(365)).toBe(0);
      expect(await new TraineeActivityService(taskStore([]), async () => 'tok', mockServices.logger.mock(), noGithub().fetchImpl, () => NOW).purgeArchive(365)).toBe(0);
    });

    it('a second night finds nothing left to remove', async () => {
      await enrolled('old@example.com', 400);
      const service = svc(taskStore([]));
      expect(await service.purgeArchive(365)).toBe(1);
      expect(await service.purgeArchive(365)).toBe(0);
    });
  });

  describe('deleting by hand uses the same removal', () => {
    it('removing an archived capstone discards its kept report and takes it off the list', async () => {
      const done = await enrolled('done@example.com', 40);
      const store = taskStore([{ agent: 'a1', name: 'lab-done', email: 'done@example.com', repoUrl: done.repoUrl }]);
      const service = svc(store);
      const r = await service.removeTrainee({ agentId: 'a1', resourceName: 'lab-done', enrollmentId: done.id, deleteRepo: false }, 'teacher@example.com');
      expect(r.status).toBe(200);
      expect(await capstones.getReport(done.id)).toBeUndefined();
      expect((await db('capstone_enrollments').where({ id: done.id }).first()).report).toBeNull();
      expect((await capstones.list()).map(e => e.id)).not.toContain(done.id);
    });
  });
});
