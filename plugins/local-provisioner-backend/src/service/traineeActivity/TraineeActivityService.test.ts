import { mockServices } from '@backstage/backend-test-utils';
import { TraineeActivityService } from './TraineeActivityService';
import { ResourceState } from '../../types';

const NOW = new Date('2026-10-30T12:00:00Z');

function store(histories: any[], agents: Record<string, any>) {
  return {
    getTrainingResourceHistories: async () => histories,
    removedTraineeLabs: async () => new Set<string>(),
    getAgentById: async (id: string) => agents[id] ?? null,
  } as any;
}
const history = (name: string, config: Record<string, unknown>, updated = '2026-10-30T09:00:00Z') => ({
  resource: {
    resource_name: name,
    resource_type: 'ministack',
    is_training: true,
    agent_id: 'a1',
    user_id: `${name}@example.com`,
    state: ResourceState.RUNNING,
    updated_at: new Date(updated),
    latest_task_id: 't',
  },
  provision: { task_type: 'provision-training', config },
  events: [{ type: 'provision-training', status: 'completed', at: new Date(updated) }],
});

/** Fake GitHub that answers every repo as a 1-commit repo, counting calls per repo. */
function fakeGithub(failing = new Set<string>()) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const m = /repos\/([^/]+)\/([^/?]+)(.*)$/.exec(url)!;
    const repo = m[2];
    const rest = m[3];
    const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => '' });
    if (failing.has(repo)) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    if (rest === '') return ok({ default_branch: 'main' });
    if (rest.startsWith('/commits')) return ok([{ sha: 'c1', commit: { message: 'Initial commit', committer: { date: '2026-10-30T11:00:00Z' } } }]);
    if (rest.startsWith('/git/trees')) return ok({ tree: [] });
    if (rest.startsWith('/pulls')) return ok([]);
    return ok({ workflow_runs: [] });
  };
  return { fetchImpl: fetchImpl as any, calls };
}

describe('TraineeActivityService', () => {
  it('joins environments with agent liveness and GitHub activity, and explains missing repo data', async () => {
    const { fetchImpl } = fakeGithub(new Set(['gone']));
    const svc = new TraineeActivityService(
      store(
        [
          history('active', { githubRepoUrl: 'https://github.com/o/active' }),
          history('gitlab', { gitlabRepoUrl: 'https://gitlab.example.com/a/b' }),
          history('norepo', {}),
          history('gone', { githubRepoUrl: 'https://github.com/o/gone' }),
          history('evil', { githubRepoUrl: 'https://evil.example/o/r' }),
        ],
        { a1: { last_seen: new Date(NOW.getTime() - 30_000) } },
      ),
      async () => 'tok',
      mockServices.logger.mock(),
      fetchImpl,
      () => NOW,
    );

    const rows = await svc.listTrainees();
    const by = Object.fromEntries(rows.map(r => [r.resourceName, r]));
    expect(rows[0].resourceName).toBe('active'); // most recent activity (its commit) first
    expect(by.active.repo?.commitCount).toBe(1);
    expect(by.active.environment.agentOnline).toBe(true);
    expect(by.gitlab.repoNote).toMatch(/GitLab/);
    expect(by.norepo.repoNote).toMatch(/No repository/);
    expect(by.gone.repoNote).toMatch(/not found/);
    expect(by.evil.repo).toBeUndefined(); // never fetched: not github.com
  });

  it('never sends a request (or the token) to a non-GitHub host from task config', async () => {
    const { fetchImpl, calls } = fakeGithub();
    const svc = new TraineeActivityService(
      store([history('evil', { githubRepoUrl: 'https://evil.example/o/r' })], {}),
      async () => 'tok',
      mockServices.logger.mock(),
      fetchImpl,
      () => NOW,
    );
    await svc.listTrainees();
    expect(calls).toEqual([]);
  });

  it('caches repo activity and refetches on refresh', async () => {
    const { fetchImpl, calls } = fakeGithub();
    const svc = new TraineeActivityService(
      store([history('active', { githubRepoUrl: 'https://github.com/o/active' })], {}),
      async () => 'tok',
      mockServices.logger.mock(),
      fetchImpl,
      () => NOW,
    );
    await svc.listTrainees();
    const first = calls.length;
    await svc.listTrainees();
    expect(calls.length).toBe(first); // served from cache
    await svc.listTrainees({ refresh: true });
    expect(calls.length).toBe(first * 2);
  });

  it('marks an agent offline after 90s without a poll', async () => {
    const { fetchImpl } = fakeGithub();
    const svc = new TraineeActivityService(
      store([history('x', {})], { a1: { last_seen: new Date(NOW.getTime() - 91_000) } }),
      async () => undefined,
      mockServices.logger.mock(),
      fetchImpl,
      () => NOW,
    );
    expect((await svc.listTrainees())[0].environment.agentOnline).toBe(false);
  });
});

describe('TraineeActivityService — capstone enrollments', () => {
  it('attaches an enrollment to its environment row, or adds its own row', async () => {
    const { fetchImpl } = fakeGithub();
    const enrollments = {
      list: async () => [
        { id: 'e1', capstone: 'nodejs', traineeEmail: 'active@example.com', traineeNo: '01', status: 'active', repoUrl: 'https://github.com/o/active', createdAt: '2026-10-30T08:00:00Z' },
        { id: 'e2', capstone: 'nodejs', traineeEmail: 'solo@example.com', traineeNo: '02', status: 'active', repoUrl: 'https://github.com/o/solo', handoutPrUrl: 'https://github.com/o/solo/pull/1', createdAt: '2026-10-30T08:00:00Z' },
        { id: 'e3', capstone: 'nodejs', traineeEmail: 'pending@example.com', traineeNo: '03', status: 'seeded', createdAt: '2026-10-30T08:00:00Z' },
      ],
    } as any;
    const svc = new TraineeActivityService(
      store([history('active', { githubRepoUrl: 'https://github.com/o/active' })], {}),
      async () => 'tok',
      mockServices.logger.mock(),
      fetchImpl,
      () => NOW,
      enrollments,
    );
    const rows = await svc.listTrainees();
    expect(rows).toHaveLength(3);
    const by = Object.fromEntries(rows.map(r => [r.traineeEmail, r]));
    expect(by['active@example.com'.replace('active@', 'active@')].capstone?.traineeNo).toBe('01');
    expect(by['solo@example.com']).toMatchObject({ resourceName: 'solo', environment: { state: 'none' }, capstone: { traineeNo: '02', handoutPrUrl: 'https://github.com/o/solo/pull/1' } });
    expect(by['solo@example.com'].repo?.commitCount).toBe(1);
    expect(by['pending@example.com']).toMatchObject({ resourceName: 'nodejs capstone #03', repoNote: 'No repository recorded for this environment' });
  });
});
