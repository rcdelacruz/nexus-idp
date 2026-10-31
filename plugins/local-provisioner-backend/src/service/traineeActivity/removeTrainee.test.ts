import knexFactory, { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { TraineeActivityService } from './TraineeActivityService';
import { CapstoneStore } from '../../capstones/CapstoneStore';
import { ResourceState } from '../../types';

// eslint-disable-next-line @backstage/no-relative-monorepo-imports
const capstoneMigration = require('../../database/migrations/006-create-capstone-enrollments.js');

const NOW = new Date('2026-10-31T12:00:00Z');
const ORG = 'stratpoint-engineering';
const LAB_CREATED = new Date('2026-10-31T09:00:00Z');

/** Task store fake: one lab history + the removals table. */
function taskStore(labs: { agent: string; name: string; email: string; repoUrl?: string; state?: ResourceState }[]) {
  const removals: any[] = [];
  return {
    removals,
    getTrainingResourceHistories: async () =>
      labs.map(l => ({
        resource: {
          resource_name: l.name,
          resource_type: 'ministack',
          is_training: true,
          agent_id: l.agent,
          user_id: l.email,
          state: l.state ?? ResourceState.REMOVED,
          updated_at: LAB_CREATED,
          latest_task_id: 't',
        },
        provision: { task_type: 'provision-training', created_at: LAB_CREATED, config: l.repoUrl ? { githubRepoUrl: l.repoUrl } : {} },
        events: [],
      })),
    getAgentById: async () => null,
    removedTraineeLabs: async () => new Set(removals.filter(r => r.agentId).map(r => `${r.agentId}::${r.resourceName}`)),
    recordTraineeRemoval: async (r: any) => {
      removals.push(r);
    },
  } as any;
}

/** Fake GitHub: repo metadata by name; records every call. */
function github(repos: Record<string, { created_at: string; private?: boolean; fork?: boolean } | 'missing'>, deleteStatus = 204) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.replace('https://api.github.com', '')}`);
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?]+)(.*)$/.exec(url);
    const meta = m ? repos[m[2]] : undefined;
    const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => '' });
    if (method === 'DELETE') return reply(deleteStatus);
    if (!meta || meta === 'missing') return reply(404, { message: 'Not Found' });
    if (m![3] === '') return reply(200, { private: true, fork: false, default_branch: 'main', ...meta });
    return reply(200, []); // activity endpoints (commits, trees, …) — not under test here
  };
  return { calls, fetchImpl };
}

const service = (store: any, gh: ReturnType<typeof github>, capstones?: CapstoneStore, owner: string | null = ORG) =>
  new TraineeActivityService(store, async () => 'tok', mockServices.logger.mock(), gh.fetchImpl as any, () => NOW, capstones as any, owner ?? undefined);

const lab = { agent: 'a1', name: 'ministack-training-ann-1761901200', email: 'ann@example.com' };
const labRepo = `https://github.com/${ORG}/training-${lab.name}`;

describe('TraineeActivityService.removeTrainee', () => {
  it('deletes the lab repo, then hides the lab from the Trainees view', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const gh = github({ [`training-${lab.name}`]: { created_at: '2026-10-31T08:59:30Z' } });
    const svc = service(store, gh);

    const r = await svc.removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: true }, 'teacher@example.com');

    expect(r).toEqual({ status: 200, repoDeleted: `${ORG}/training-${lab.name}` });
    expect(gh.calls).toContain(`DELETE /repos/${ORG}/training-${lab.name}`);
    expect(store.removals).toEqual([
      expect.objectContaining({ agentId: 'a1', resourceName: lab.name, traineeEmail: lab.email, repoDeleted: true, removedBy: 'teacher@example.com' }),
    ]);
    expect(await svc.listTrainees()).toEqual([]);
  });

  it.each([
    ['a company repo the trainee pointed their lab at (old creation date)', `https://github.com/${ORG}/training-${lab.name}`, { created_at: '2023-05-01T00:00:00Z' }, /not created with this trainee's lab/],
    ['a repo not named after the lab', `https://github.com/${ORG}/backstage-main`, { created_at: '2026-10-31T09:00:00Z' }, /not named after/],
    ['a repo in another org', `https://github.com/someone-else/training-${lab.name}`, { created_at: '2026-10-31T09:00:00Z' }, /not in the stratpoint-engineering organization/],
    ['a public repo', labRepo, { created_at: '2026-10-31T09:00:00Z', private: false }, /is public/],
    ['a fork', labRepo, { created_at: '2026-10-31T09:00:00Z', fork: true }, /is a fork/],
    ['a GitLab repo', 'https://gitlab.com/stratpoint-engineering/x', { created_at: '2026-10-31T09:00:00Z' }, /not a github.com repository/],
  ])('refuses %s and removes nothing', async (_what, repoUrl, meta, reason) => {
    const store = taskStore([{ ...lab, repoUrl }]);
    const name = repoUrl.split('/').pop()!;
    const gh = github({ [name]: meta as any });
    const svc = service(store, gh);

    const r = await svc.removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: true }, 't@x');

    expect(r.status).toBe(409);
    expect(r.error).toMatch(reason);
    expect(r.error).toMatch(/Nothing was removed/);
    expect(gh.calls.filter(c => c.startsWith('DELETE'))).toEqual([]);
    expect(store.removals).toEqual([]);
    expect(await svc.listTrainees()).toHaveLength(1);
  });

  it('never deletes when organization.githubOwner is not configured', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const gh = github({ [`training-${lab.name}`]: { created_at: '2026-10-31T09:00:00Z' } });
    const r = await service(store, gh, undefined, null).removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: true }, 't@x');
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/githubOwner is not configured/);
    expect(gh.calls).toEqual([]);
    expect(store.removals).toEqual([]);
  });

  it('keeps everything when GitHub refuses the delete (token without delete rights)', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const gh = github({ [`training-${lab.name}`]: { created_at: '2026-10-31T09:00:00Z' } }, 403);
    const r = await service(store, gh).removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: true }, 't@x');
    expect(r.status).toBe(502);
    expect(r.error).toMatch(/delete_repo/);
    expect(store.removals).toEqual([]);
  });

  it('treats an already-deleted repo as deleted and still removes the row', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const gh = github({ [`training-${lab.name}`]: 'missing' });
    const r = await service(store, gh).removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: true }, 't@x');
    expect(r.status).toBe(200);
    expect(gh.calls.filter(c => c.startsWith('DELETE'))).toEqual([]);
    expect(store.removals).toHaveLength(1);
  });

  it('only hides the row (no GitHub call) when the repo is to be kept', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const gh = github({});
    const r = await service(store, gh).removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: false }, 't@x');
    expect(r).toEqual({ status: 200, repoDeleted: undefined });
    expect(gh.calls).toEqual([]);
    expect(store.removals[0].repoDeleted).toBe(false);
  });

  it('404s an unknown or already-removed lab', async () => {
    const store = taskStore([{ ...lab, repoUrl: labRepo }]);
    const svc = service(store, github({}));
    expect((await svc.removeTrainee({ agentId: 'a1', resourceName: 'nope', deleteRepo: false }, 't@x')).status).toBe(404);
    await svc.removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: false }, 't@x');
    expect((await svc.removeTrainee({ agentId: 'a1', resourceName: lab.name, deleteRepo: false }, 't@x')).status).toBe(404);
  });

  describe('with capstone enrollments (real CapstoneStore)', () => {
    let db: Knex;
    let capstones: CapstoneStore;
    beforeEach(async () => {
      db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
      await capstoneMigration.up(db);
      capstones = new CapstoneStore(db, () => new Date('2026-10-31T08:55:00Z'));
    });
    afterEach(() => db.destroy());

    const enroll = async (email: string, repo: string) => {
      const { enrollment } = await capstones.enroll('nodejs', email, async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
      await capstones.linkRepo(enrollment.id, email, `https://github.com/${ORG}/${repo}`);
      return enrollment;
    };

    it('withdraws a capstone-only enrollment and deletes its capstone repo', async () => {
      const e = await enroll('bob@example.com', 'nodejs-capstone-bob-1761901000');
      const store = taskStore([]);
      const gh = github({ 'nodejs-capstone-bob-1761901000': { created_at: '2026-10-31T08:56:00Z' } });
      const svc = service(store, gh, capstones);
      expect((await svc.listTrainees()).map(r => r.capstone?.id)).toEqual([e.id]);

      const r = await svc.removeTrainee({ enrollmentId: e.id, deleteRepo: true }, 't@x');

      expect(r).toEqual({ status: 200, repoDeleted: `${ORG}/nodejs-capstone-bob-1761901000` });
      expect((await capstones.get(e.id))?.status).toBe('withdrawn');
      expect(await svc.listTrainees()).toEqual([]);
    });

    it("refuses to delete a company repo linked as a capstone repo (name doesn't match the capstone)", async () => {
      const e = await enroll('eve@example.com', 'backstage-main');
      const gh = github({ 'backstage-main': { created_at: '2026-10-31T08:56:00Z' } });
      const r = await service(taskStore([]), gh, capstones).removeTrainee({ enrollmentId: e.id, deleteRepo: true }, 't@x');
      expect(r.status).toBe(409);
      expect(gh.calls).toEqual([]);
      expect((await capstones.get(e.id))?.status).toBe('active');
    });

    it("rejects a lab and an enrollment that belong to different trainees", async () => {
      const e = await enroll('bob@example.com', 'nodejs-capstone-bob-1761901000');
      const store = taskStore([{ ...lab, repoUrl: labRepo }]);
      const r = await service(store, github({}), capstones).removeTrainee(
        { agentId: 'a1', resourceName: lab.name, enrollmentId: e.id, deleteRepo: true },
        't@x',
      );
      expect(r.status).toBe(400);
      expect((await capstones.get(e.id))?.status).toBe('active');
    });
  });
});
