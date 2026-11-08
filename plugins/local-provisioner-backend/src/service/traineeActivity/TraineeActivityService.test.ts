import { Knex } from 'knex';
import { mockServices } from '@backstage/backend-test-utils';
import { TraineeActivityService, parseLabKey, withNewestLogsOnly } from './TraineeActivityService';
import { TaskStore } from '../../database/TaskStore';
import { CapstoneStore } from '../../capstones/CapstoneStore';
import { addAgent, addTask, createTrainingDb } from '../../testing/trainingDb';
import { Fetch } from './githubSummary';

const NOW = new Date('2026-11-01T12:00:00Z');
const T0 = Date.UTC(2026, 10, 1); // addTask's minute offsets count from here

type Behaviour = 'ok' | 404 | 429 | 500 | 'ratelimit403' | 'plain403' | 'throw' | 'hang';

/** A GitHub that answers like the real one, per repo, and records every request. */
function fakeGithub(behaviour: Record<string, Behaviour> = {}) {
  const calls: string[] = [];
  const repos = new Set<string>();
  let inFlight = 0;
  let peak = 0;
  const hold: { gate?: Promise<void> } = {};
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}, text = '') => ({
    ok: status < 400,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => text,
  });
  const fetchImpl: Fetch = async url => {
    calls.push(url);
    const m = /\/repos\/([^/]+)\/([^/?]+)(.*)$/.exec(url)!;
    const repo = m[2];
    const rest = m[3];
    repos.add(repo);
    if (rest === '') {
      inFlight++;
      peak = Math.max(peak, inFlight);
      if (hold.gate) await hold.gate;
      inFlight--;
    }
    const b = behaviour[repo] ?? 'ok';
    if (b === 'throw') throw new Error('socket hang up');
    if (b === 404) return reply(404);
    if (b === 429) return reply(429);
    if (b === 500) return reply(500);
    if (b === 'ratelimit403') return reply(403, {}, { 'x-ratelimit-remaining': '0' });
    if (b === 'plain403') return reply(403);
    if (rest === '') return reply(200, { default_branch: 'main', html_url: `https://github.com/o/${repo}` });
    if (rest.startsWith('/commits')) return reply(200, [{ sha: 'c1', commit: { message: 'Initial commit', committer: { date: '2026-11-01T10:00:00Z' } } }]);
    if (rest.startsWith('/contents/PROGRESS.md')) return reply(200, {}, {}, '- [x] a\n- [ ] b\n');
    if (rest.startsWith('/contents')) return reply(200, {}, {}, '');
    if (rest.startsWith('/git/trees')) return reply(200, { tree: [] });
    if (rest.startsWith('/pulls')) return reply(200, []);
    return reply(200, { workflow_runs: [] });
  };
  return { fetchImpl, calls, hold, peak: () => peak, repos };
}

describe('TraineeActivityService', () => {
  let db: Knex;
  let store: TaskStore;
  let capstones: CapstoneStore;
  let clock: Date;

  beforeEach(async () => {
    db = await createTrainingDb();
    store = new TaskStore(db);
    clock = NOW;
    capstones = new CapstoneStore(db, () => clock);
  });
  afterEach(async () => {
    await db.destroy();
  });

  const service = (gh = fakeGithub(), opts: { caps?: any; token?: (url: string) => Promise<string | undefined>; online?: (a: string, d: Date) => boolean } = {}) =>
    Object.assign(
      new TraineeActivityService(store, opts.token ?? (async () => 'tok'), mockServices.logger.mock(), gh.fetchImpl, () => clock, opts.caps ?? capstones, 'o', opts.online),
      { gh },
    );

  /** A running training lab: provision (and optional extras). `at` counts minutes from 2026-11-01T00:00Z. */
  async function lab(name: string, o: { agent?: string; user?: string; repo?: string | null; labId?: string; at?: number; online?: boolean; type?: string } = {}) {
    const agent = o.agent ?? `agent-${name}`;
    await addTask(db, {
      agent,
      resource: name,
      user: o.user ?? `${name}@example.com`,
      type: o.type ?? 'provision-training',
      at: o.at ?? 1,
      config: { labId: o.labId ?? 'terraform-capstone-a', ...(o.repo === null ? {} : { githubRepoUrl: o.repo ?? `https://github.com/o/${name}` }) },
    });
    if (o.online !== false) await addAgent(db, agent, new Date(clock.getTime() - 10_000), o.user ?? `${name}@example.com`);
    return `lab:${agent}::${name}`;
  }

  describe('the list', () => {
    it('is built from the database only: not one GitHub request', async () => {
      await lab('ann');
      await lab('bob');
      const svc = service();
      const rows = await svc.listTrainees();
      expect(rows).toHaveLength(2);
      expect(svc.gh.calls).toEqual([]);
    });

    it('a row is small and carries no timeline, check results, GitHub data or catalog reference', async () => {
      const key = await lab('ann');
      for (let i = 0; i < 8; i++) {
        await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', at: 10 + i, config: { checkName: i % 2 ? 'grade' : 'seeded-resources', job: { files: { 'grade.py': 'x'.repeat(40_000) } } }, metadata: { check: { exitCode: 0, output: 'o'.repeat(60_000) } }, logs: 'l'.repeat(60_000) });
      }
      const [row] = await service().listTrainees();
      expect(row.key).toBe(key);
      expect(JSON.stringify(row).length).toBeLessThan(2500);
      for (const field of ['events', 'checks', 'repo', 'repoNote', 'catalogEntityRef', 'logs']) expect((row as any)[field]).toBeUndefined();
      expect(row).toMatchObject({ traineeEmail: 'ann@example.com', agentId: 'agent-ann', resourceName: 'ann', lab: 'terraform-capstone-a', taskType: 'provision-training', repoUrl: 'https://github.com/o/ann', hasGithubRepo: true });
      expect(row.environment).toMatchObject({ state: 'running', agentOnline: true });
    });

    it('says whether a GitHub repository exists to ask about', async () => {
      await lab('ghub');
      await lab('norepo', { repo: null });
      await lab('gitlab', { repo: 'https://gitlab.example.com/a/b' });
      await lab('evil', { repo: 'https://evil.example/o/r' });
      const by = Object.fromEntries((await service().listTrainees()).map(r => [r.resourceName, r.hasGithubRepo]));
      expect(by).toEqual({ ghub: true, norepo: false, gitlab: false, evil: false });
    });

    it('hides labs that were removed from the view, and anything that is not a training lab', async () => {
      await lab('keep');
      await lab('gone');
      await db('trainee_removals').insert({ id: 'r1', agent_id: 'agent-gone', resource_name: 'gone', trainee_email: 'gone@example.com', repo_deleted: false, removed_by: 'x', removed_at: NOW.toISOString() });
      await addTask(db, { agent: 'a9', resource: 'pg', type: 'provision-postgres' });
      expect((await service().listTrainees()).map(r => r.resourceName)).toEqual(['keep']);
    });

    it('marks an agent offline after one poll + 20 s without a poll (the portal-wide rule, not its own 90 s)', async () => {
      for (const [name, ago] of [['fresh', 40_000], ['stale', 50_000]] as const) {
        await addTask(db, { agent: `agent-${name}`, resource: name, user: `${name}@example.com`, type: 'provision-training', config: { labId: 'x' } });
        await addAgent(db, `agent-${name}`, new Date(NOW.getTime() - ago));
      }
      const by = Object.fromEntries((await service().listTrainees()).map(r => [r.resourceName, r.environment.agentOnline]));
      expect(by).toEqual({ fresh: true, stale: false });
    });

    it('uses the liveness rule it is given (the live AgentService also knows an agent that just stopped)', async () => {
      await lab('x');
      const [row] = await service(fakeGithub(), { online: (agentId: string) => agentId !== 'agent-x' }).listTrainees();
      expect(row.environment.agentOnline).toBe(false);
    });

    it('puts the most serious first, then the most recent change, then the key', async () => {
      await lab('calm-old', { at: 1 });
      await lab('calm-new', { at: 50 });
      await lab('failed', { at: 5 });
      await addTask(db, { agent: 'agent-failed', resource: 'failed', user: 'failed@example.com', type: 'start', status: 'failed', at: 6, config: { targetTaskId: 'x' } });
      await lab('tie-b', { at: 50 });
      await lab('tie-a', { at: 50 });
      const names = (await service().listTrainees()).map(r => r.resourceName);
      expect(names[0]).toBe('failed');
      expect(names.slice(1, 4).sort()).toEqual(['calm-new', 'tie-a', 'tie-b']);
      // The three have the same change time: they come in key order (`lab:agent-<name>`), which for these names is the name order.
      expect(names.slice(1, 4)).toEqual(['calm-new', 'tie-a', 'tie-b']);
      expect(names[4]).toBe('calm-old');
    });

    it('the order is the same on every call', async () => {
      for (const n of ['a', 'b', 'c', 'd']) await lab(n, { at: 7 });
      const svc = service();
      const first = (await svc.listTrainees()).map(r => r.key);
      expect((await svc.listTrainees()).map(r => r.key)).toEqual(first);
    });
  });

  describe('attention (database data only)', () => {
    const attention = async (name: string) => (await service().listTrainees()).find(r => r.resourceName === name)?.attention;

    it('a lab that failed is flagged, but only the trainee’s newest lab of that course', async () => {
      await lab('old-try', { user: 'ann@example.com', at: 1, agent: 'a-old' });
      await addTask(db, { agent: 'a-old', resource: 'old-try', user: 'ann@example.com', type: 'start', status: 'failed', at: 2, config: { targetTaskId: 'x' } });
      await lab('new-try', { user: 'ann@example.com', at: 100, agent: 'a-new' });
      expect(await attention('old-try')).toBeUndefined(); // she started over: the old failure is history
      expect(await attention('new-try')).toBeUndefined();
      await addTask(db, { agent: 'a-new', resource: 'new-try', user: 'ann@example.com', type: 'start', status: 'failed', at: 101, config: { targetTaskId: 'x' } });
      expect(await attention('new-try')).toMatchObject({ severity: 2, code: 'lab_failed', text: 'Lab failed' });
    });

    it('a failed lab of another course or another trainee does not hide the failure', async () => {
      await lab('tf', { user: 'ann@example.com', at: 100, agent: 'a-tf', labId: 'terraform-capstone-a' });
      await lab('node-fail', { user: 'ann@example.com', at: 1, agent: 'a-node', labId: 'nodejs-capstone-a' });
      await addTask(db, { agent: 'a-node', resource: 'node-fail', user: 'ann@example.com', type: 'start', status: 'failed', at: 2, config: { targetTaskId: 'x' } });
      expect(await attention('node-fail')).toMatchObject({ code: 'lab_failed' }); // newest NODE lab, whatever her newer Terraform lab did
      await lab('bobs', { user: 'bob@example.com', at: 200, agent: 'a-bob', labId: 'nodejs-capstone-a' });
      expect(await attention('node-fail')).toMatchObject({ code: 'lab_failed' });
    });

    it('a hard fail in the newest grade is serious; a clean newest grade clears it', async () => {
      await lab('ann');
      const grade = (at: number, hard: string[]) =>
        addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', at, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: hard.length ? 1 : 0, output: `building\n${JSON.stringify({ phase: 'pre', auto_total: 5, items: [{ id: 'a', points: 5, got: 5 }], hard_fails: hard })}` } } });
      await grade(10, ['Secret committed to git']);
      expect(await attention('ann')).toMatchObject({ severity: 2, code: 'hard_fail', text: 'Hard fail in last grade' });
      await grade(20, []);
      expect(await attention('ann')).toBeUndefined();
    });

    it('a newest grade that did not finish is a warning', async () => {
      await lab('ann');
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', status: 'failed', at: 10, config: { checkName: 'grade' }, error: 'Job exited with 1', logs: 'x' });
      expect(await attention('ann')).toMatchObject({ severity: 1, code: 'grade_unfinished', text: 'Last grade did not finish' });
    });

    it('a check that is not a grade never raises attention', async () => {
      await lab('ann');
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', status: 'failed', at: 10, config: { checkName: 'seeded-resources' }, error: 'Check exited with 1' });
      expect(await attention('ann')).toBeUndefined();
    });

    it('setup is stuck after 45 minutes', async () => {
      await addTask(db, { agent: 'a-stuck', resource: 'stuck', user: 'stuck@example.com', type: 'provision-training', status: 'in-progress', at: -50, config: { labId: 'x' }, metadata: { activity: [{ at: new Date(NOW.getTime() - 50 * 60_000).toISOString(), step: 'Setting up the server' }] } });
      await addAgent(db, 'a-stuck', new Date(NOW.getTime() - 5_000), 'stuck@example.com');
      await addTask(db, { agent: 'a-fine', resource: 'fine', user: 'fine@example.com', type: 'provision-training', status: 'in-progress', at: -10, config: { labId: 'x' }, metadata: { activity: [{ at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), step: 'Setting up the server' }] } });
      expect(await attention('stuck')).toMatchObject({ severity: 1, code: 'stuck', text: 'Stuck for 50 min' });
      expect(await attention('fine')).toBeUndefined();
    });

    it('an agent that has been silent for a day or more while the lab runs is a warning; a laptop asleep overnight is not', async () => {
      const silent = async (name: string, hours: number) => {
        await addTask(db, { agent: `agent-${name}`, resource: name, user: `${name}@example.com`, type: 'provision-training', config: { labId: 'x' } });
        await addAgent(db, `agent-${name}`, new Date(NOW.getTime() - hours * 3_600_000));
      };
      await silent('overnight', 10);
      await silent('two-days', 49);
      await silent('just-over', 25);
      expect(await attention('overnight')).toBeUndefined();
      expect(await attention('just-over')).toMatchObject({ severity: 1, code: 'agent_offline', text: 'Agent offline for 25 h' });
      expect(await attention('two-days')).toMatchObject({ text: 'Agent offline for 2 d' });
    });

    it('a stopped lab with a silent agent is not flagged', async () => {
      await addTask(db, { agent: 'agent-s', resource: 's', user: 's@example.com', type: 'provision-training', at: 1, config: { labId: 'x' } });
      await addTask(db, { agent: 'agent-s', resource: 's', user: 's@example.com', type: 'stop', at: 2, config: { targetTaskId: 'x' } });
      await addAgent(db, 'agent-s', new Date(NOW.getTime() - 100 * 3_600_000));
      expect(await attention('s')).toBeUndefined();
    });

    it('the most serious reason wins', async () => {
      await addTask(db, { agent: 'agent-w', resource: 'w', user: 'w@example.com', type: 'provision-training', at: 1, config: { labId: 'x' } });
      await addAgent(db, 'agent-w', new Date(NOW.getTime() - 100 * 3_600_000)); // offline: a warning
      await addTask(db, { agent: 'agent-w', resource: 'w', user: 'w@example.com', type: 'run-check', at: 5, config: { checkName: 'grade' }, metadata: { check: { exitCode: 1, output: JSON.stringify({ auto_total: 0, items: [], hard_fails: ['x'] }) } } });
      expect(await attention('w')).toMatchObject({ severity: 2, code: 'hard_fail' });
    });
  });

  describe('capstone enrollments', () => {
    const enroll = async (email: string, repoUrl?: string) => {
      const { enrollment } = await capstones.enroll('nodejs', email, async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
      if (repoUrl) await capstones.linkRepo(enrollment.id, email, repoUrl);
      return enrollment.id;
    };

    it('attaches an enrollment to its lab, or adds its own row keyed by the enrollment', async () => {
      const labKey = await lab('mia', { user: 'mia@example.com', repo: 'https://github.com/o/mia' });
      const linked = await enroll('mia@example.com', 'https://github.com/o/mia');
      const alone = await enroll('zed@example.com');
      const rows = await service().listTrainees();
      const mia = rows.find(r => r.key === labKey)!;
      expect(mia.capstone).toMatchObject({ id: linked, capstone: expect.any(String), status: 'active', archiveRetentionDays: 365 });
      const solo = rows.find(r => r.key === `cap:${alone}`)!;
      expect(solo).toMatchObject({ taskType: 'capstone', traineeEmail: 'zed@example.com', environment: { state: 'none' }, hasGithubRepo: false });
      expect(rows).toHaveLength(2);
    });

    it('matches the repo whatever its .git suffix, and only for the same trainee', async () => {
      const k1 = await lab('a', { user: 'a@example.com', repo: 'https://github.com/o/shared.git' });
      await lab('b', { user: 'b@example.com', repo: 'https://github.com/o/shared' });
      await enroll('a@example.com', 'https://github.com/o/shared');
      const rows = await service().listTrainees();
      expect(rows.filter(r => r.capstone).map(r => r.key)).toEqual([k1]);
    });

    it('two labs of one trainee on one repo: the enrollment is attached to ONE of them (the first), never both', async () => {
      const first = await lab('first', { user: 'mia@example.com', repo: 'https://github.com/o/mia', at: 1, agent: 'a-first' });
      await lab('second', { user: 'mia@example.com', repo: 'https://github.com/o/mia', at: 50, agent: 'a-second' });
      await enroll('mia@example.com', 'https://github.com/o/mia');
      const rows = await service().listTrainees();
      expect(rows.filter(r => r.capstone).map(r => r.key)).toEqual([first]);
    });

    it('an enrollment that was marked done carries its expiry and costs no GitHub reads', async () => {
      const id = await enroll('mia@example.com', 'https://github.com/o/mia');
      await capstones.complete(id, 'teacher@example.com', { version: 1, trainee: 'mia@example.com', lab: 'l', course: 'c', summary: [], checks: [], history: [] });
      const svc = service();
      const [row] = await svc.listTrainees();
      expect(row.capstone).toMatchObject({ status: 'completed', archiveRetentionDays: 365 });
      expect(row.capstone?.archiveExpiresAt).toBe(new Date(NOW.getTime() + 365 * 86_400_000).toISOString());
      expect(await svc.activity([row.key], 'brief', false)).toEqual([expect.objectContaining({ key: row.key, code: 'archived' })]);
      expect(svc.gh.calls).toEqual([]);
    });
  });

  describe('activity (GitHub, by key)', () => {
    it('reads the brief level in four calls and says it is ok', async () => {
      const key = await lab('ann');
      const svc = service();
      const [item] = await svc.activity([key], 'brief', false);
      expect(item).toMatchObject({ key, repoUrl: 'https://github.com/o/ann', code: 'ok', fetchedAt: NOW.toISOString() });
      expect(item.repo).toMatchObject({ owner: 'o', repo: 'ann', lastCommit: { sha: 'c1' }, progress: { done: 1, total: 2 } });
      expect((item.repo as any).stageFilesWorked).toBeUndefined();
      expect(svc.gh.calls).toHaveLength(4);
    });

    it('reads the full level with the counts the panel needs', async () => {
      const key = await lab('ann');
      const [item] = await service().activity([key], 'full', false);
      expect(item).toMatchObject({ code: 'ok' });
      expect(item.repo).toMatchObject({ commitCount: 1, stageFilesWorked: [], pullRequests: { open: 0, merged: 0 } });
    });

    it('leaves out keys the portal does not know, however they are written, and answers each key once', async () => {
      const key = await lab('ann');
      const svc = service();
      const items = await svc.activity([key, key, 'lab:nobody::none', 'cap:missing', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'lab:', 'lab:agent-ann::'], 'brief', false);
      expect(items.map(i => i.key)).toEqual([key]);
    });

    it('never fetches for a row without a GitHub repository, and says why', async () => {
      const none = await lab('none', { repo: null });
      const gitlab = await lab('gitlab', { repo: 'https://gitlab.example.com/a/b' });
      const evil = await lab('evil', { repo: 'https://evil.example/o/r' });
      const svc = service();
      const items = await svc.activity([none, gitlab, evil], 'brief', false);
      expect(items.map(i => [i.key, i.code])).toEqual([[none, 'no_repo'], [gitlab, 'no_repo'], [evil, 'no_repo']]);
      expect(items.find(i => i.key === gitlab)?.note).toMatch(/GitLab/);
      expect(svc.gh.calls).toEqual([]);
    });

    it('asks for the token of the repository itself and sends requests only to api.github.com', async () => {
      const key = await lab('ann');
      const asked: string[] = [];
      const svc = service(fakeGithub(), {
        token: async url => {
          asked.push(url);
          return 'tok';
        },
      });
      await svc.activity([key], 'brief', false);
      expect(asked).toEqual(['https://github.com/o/ann']);
      expect(svc.gh.calls.every(c => c.startsWith('https://api.github.com/repos/o/ann'))).toBe(true);
    });

    describe('what went wrong, per key', () => {
      const run = async (b: Behaviour) => {
        const key = await lab('ann');
        const svc = service(fakeGithub({ ann: b }));
        const [item] = await svc.activity([key], 'brief', false);
        return item;
      };
      it('not found', async () => expect(await run(404)).toMatchObject({ code: 'not_found', note: expect.stringMatching(/not found/) }));
      it('429 is a rate limit', async () => expect(await run(429)).toMatchObject({ code: 'rate_limited' }));
      it('403 with an exhausted quota is a rate limit', async () => expect(await run('ratelimit403')).toMatchObject({ code: 'rate_limited' }));
      it('a plain 403 is not a rate limit (the portal has no access)', async () => expect(await run('plain403')).toMatchObject({ code: 'unavailable' }));
      it('a server error', async () => expect(await run(500)).toMatchObject({ code: 'unavailable' }));
      it('a network error', async () => expect(await run('throw')).toMatchObject({ code: 'unavailable' }));

      it('one failing repository does not touch the others', async () => {
        const good = await lab('good');
        const bad = await lab('bad');
        const items = await service(fakeGithub({ bad: 404 })).activity([good, bad], 'brief', false);
        expect(items.map(i => [i.key, i.code])).toEqual([[good, 'ok'], [bad, 'not_found']]);
      });
    });

    describe('the cache', () => {
      it('serves a repository from the cache for five minutes, and brief and full are cached apart', async () => {
        const key = await lab('ann');
        const svc = service();
        await svc.activity([key], 'brief', false);
        const first = svc.gh.calls.length;
        clock = new Date(NOW.getTime() + 4 * 60_000);
        await svc.activity([key], 'brief', false);
        expect(svc.gh.calls.length).toBe(first);
        await svc.activity([key], 'full', false);
        expect(svc.gh.calls.length).toBeGreaterThan(first); // the other level is read
        const afterFull = svc.gh.calls.length;
        clock = new Date(NOW.getTime() + 6 * 60_000);
        await svc.activity([key], 'brief', false);
        expect(svc.gh.calls.length).toBeGreaterThan(afterFull); // expired
      });

      it('a refresh within 30 s of the last read is served from the cache; after that it reads again', async () => {
        const key = await lab('ann');
        const svc = service();
        await svc.activity([key], 'brief', false);
        const first = svc.gh.calls.length;
        clock = new Date(NOW.getTime() + 20_000);
        await svc.activity([key], 'brief', true);
        await svc.activity([key], 'brief', true);
        expect(svc.gh.calls.length).toBe(first);
        clock = new Date(NOW.getTime() + 31_000);
        const [item] = await svc.activity([key], 'brief', true);
        expect(svc.gh.calls.length).toBe(first * 2);
        expect(item.fetchedAt).toBe(clock.toISOString());
      });

      it('concurrent requests for one repository share one read', async () => {
        const key = await lab('ann');
        const svc = service();
        await Promise.all([svc.activity([key], 'brief', false), svc.activity([key], 'brief', false), svc.activity([key], 'brief', true)]);
        expect(svc.gh.calls).toHaveLength(4);
      });

      it('a failure is remembered for a minute; a retry (refresh) reads again at once', async () => {
        const key = await lab('ann');
        const svc = service(fakeGithub({ ann: 500 }));
        await svc.activity([key], 'brief', false);
        const first = svc.gh.calls.length;
        clock = new Date(NOW.getTime() + 20_000);
        expect((await svc.activity([key], 'brief', false))[0].code).toBe('unavailable');
        expect(svc.gh.calls.length).toBe(first); // still the remembered failure
        await svc.activity([key], 'brief', true);
        expect(svc.gh.calls.length).toBe(first + 1); // the retry went to GitHub even though 20 s is under the 30 s floor
        clock = new Date(NOW.getTime() + 100_000);
        await svc.activity([key], 'brief', false);
        expect(svc.gh.calls.length).toBe(first + 2); // a minute later without a refresh
      });
    });

    describe('how many repositories are read at once', () => {
      it('never more than six, for one request', async () => {
        const keys: string[] = [];
        for (let i = 0; i < 20; i++) keys.push(await lab(`lab${i}`));
        const gh = fakeGithub();
        let release!: () => void;
        gh.hold.gate = new Promise<void>(resolve => (release = resolve));
        const svc = service(gh);
        const done = svc.activity(keys, 'brief', false);
        await new Promise(r => setTimeout(r, 50));
        expect(gh.peak()).toBe(6);
        release();
        expect((await done).filter(i => i.code === 'ok')).toHaveLength(20);
        expect(gh.peak()).toBe(6);
      });

      it('and not more than six for two requests at the same time (it is one limit for the whole process)', async () => {
        const first: string[] = [];
        const second: string[] = [];
        for (let i = 0; i < 10; i++) first.push(await lab(`a${i}`));
        for (let i = 0; i < 10; i++) second.push(await lab(`b${i}`));
        const gh = fakeGithub();
        let release!: () => void;
        gh.hold.gate = new Promise<void>(resolve => (release = resolve));
        const svc = service(gh);
        const both = Promise.all([svc.activity(first, 'brief', false), svc.activity(second, 'brief', false)]);
        await new Promise(r => setTimeout(r, 50));
        expect(gh.peak()).toBe(6);
        release();
        await both;
        expect(gh.peak()).toBe(6);
      });
    });

    it('more than 50 keys: only the first 50 are read', async () => {
      const keys: string[] = [];
      for (let i = 0; i < 52; i++) keys.push(await lab(`l${String(i).padStart(2, '0')}`));
      const svc = service();
      const items = await svc.activity(keys, 'brief', false);
      expect(items).toHaveLength(50);
      expect(svc.gh.repos.size).toBe(50);
    });
  });

  describe('the key index', () => {
    it('is built on first use, so activity works without a list call', async () => {
      const key = await lab('ann');
      expect((await service().activity([key], 'brief', false)).map(i => i.code)).toEqual(['ok']);
    });

    it('sees a lab that appeared after the index was built once it is 30 s old, not before', async () => {
      const svc = service();
      await lab('ann');
      await svc.listTrainees();
      const newKey = await lab('bob');
      expect(await svc.activity([newKey], 'brief', false)).toEqual([]);
      clock = new Date(NOW.getTime() + 31_000);
      expect((await svc.activity([newKey], 'brief', false)).map(i => i.code)).toEqual(['ok']);
    });

    it('a list call refreshes it', async () => {
      const svc = service();
      await lab('ann');
      await svc.listTrainees();
      const newKey = await lab('bob');
      await svc.listTrainees();
      expect((await svc.activity([newKey], 'brief', false)).map(i => i.code)).toEqual(['ok']);
    });

    it('a trainee removed from the view stops being answered at once', async () => {
      const key = await lab('ann');
      const svc = service();
      expect((await svc.activity([key], 'brief', false)).length).toBe(1);
      expect(await svc.removeTrainee({ agentId: 'agent-ann', resourceName: 'ann', deleteRepo: false }, 'teacher@example.com')).toMatchObject({ status: 200 });
      expect(await svc.activity([key], 'brief', false)).toEqual([]);
    });
  });

  describe('detail (database only)', () => {
    it('is one trainee in full: timeline, every check with its output, the newest failed log, the catalog reference', async () => {
      const key = await lab('ann');
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'stop', at: 2, config: { targetTaskId: 'x' } });
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', at: 10, config: { checkName: 'grade' }, metadata: { check: { exitCode: 0, output: 'OLD' } } });
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', status: 'failed', at: 11, config: { checkName: 'grade' }, error: 'Job exited with 1', logs: 'newest log' });
      await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', status: 'failed', at: 12, config: { checkName: 'seeded' }, error: 'Check exited with 2', logs: 'other check log' });
      const svc = service();
      const row = (await svc.detail(key))!;
      expect(row).toMatchObject({ key, traineeEmail: 'ann@example.com', resourceName: 'ann', environment: { state: 'stopped' } });
      expect(row.events.map(e => e.type)).toEqual(['provision-training', 'stop']);
      expect(row.checks!.map(c => [c.name, c.status])).toEqual([['seeded', 'failed'], ['grade', 'failed'], ['grade', 'completed']]); // newest first
      expect(row.checks![0]).toMatchObject({ exitCode: 2, error: 'Check exited with 2', logs: 'other check log' });
      expect(row.checks![1]).toMatchObject({ exitCode: 1, logs: 'newest log' });
      expect(row.checks![2]).toMatchObject({ output: 'OLD', logs: undefined });
      expect(svc.gh.calls).toEqual([]); // no GitHub in the detail, ever
      expect(row.repo).toBeUndefined();
    });

    it('only the newest result of a check keeps its log', async () => {
      const key = await lab('ann');
      for (const [at, log] of [[10, 'old log'], [11, 'middle log'], [12, 'newest log']] as const) {
        await addTask(db, { agent: 'agent-ann', resource: 'ann', user: 'ann@example.com', type: 'run-check', status: 'failed', at, config: { checkName: 'grade' }, error: 'Job exited with 1', logs: log });
      }
      expect((await service().detail(key))!.checks!.map(c => c.logs)).toEqual(['newest log', undefined, undefined]);
    });

    it('a resource name with "::" inside is found (the key splits at the first "::" only)', async () => {
      const key = await lab('weird::name', { agent: 'agent-x', repo: 'https://github.com/o/weird-repo' });
      expect(key).toBe('lab:agent-x::weird::name');
      const svc = service();
      expect(await svc.detail(key)).toMatchObject({ key, resourceName: 'weird::name', agentId: 'agent-x' });
      expect((await svc.activity([key], 'brief', false)).map(i => i.code)).toEqual(['ok']);
    });

    it('is undefined for a key that is unknown, malformed, removed, or not a training lab', async () => {
      const key = await lab('ann');
      await lab('gone');
      await db('trainee_removals').insert({ id: 'r1', agent_id: 'agent-gone', resource_name: 'gone', trainee_email: 'gone@example.com', repo_deleted: false, removed_by: 'x', removed_at: NOW.toISOString() });
      await addTask(db, { agent: 'a9', resource: 'pg', type: 'provision-postgres' });
      const svc = service();
      expect(await svc.detail(key)).toBeDefined();
      for (const bad of ['', 'lab:', 'lab:agent-ann', 'lab:agent-ann::', 'lab:::ann', 'lab:agent-ann::nope', 'lab:nope::ann', 'lab:agent-gone::gone', 'lab:a9::pg', 'cap:', 'cap:nope', '__proto__', 'constructor', 'ann']) {
        expect(await svc.detail(bad)).toBeUndefined();
      }
    });

    it('carries the capstone enrollment of its lab, and an enrollment key shows the lab once it has one', async () => {
      const { enrollment } = await capstones.enroll('nodejs', 'mia@example.com', async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
      const svc = service();
      // At first the enrollment has no lab: a row of its own.
      const alone = (await svc.detail(`cap:${enrollment.id}`))!;
      expect(alone).toMatchObject({ key: `cap:${enrollment.id}`, taskType: 'capstone', events: [{ type: 'capstone-enrolled' }] });
      // Then the trainee's lab appears with the same repo.
      await capstones.linkRepo(enrollment.id, 'mia@example.com', 'https://github.com/o/mia');
      const labKey = await lab('mia', { user: 'mia@example.com', repo: 'https://github.com/o/mia' });
      clock = new Date(NOW.getTime() + 31_000); // past the index age
      const viaCap = (await svc.detail(`cap:${enrollment.id}`))!;
      expect(viaCap.key).toBe(labKey);
      expect(viaCap.capstone?.id).toBe(enrollment.id);
      expect((await svc.detail(labKey))!.capstone?.id).toBe(enrollment.id);
    });

    it('a withdrawn enrollment is not found', async () => {
      const { enrollment } = await capstones.enroll('nodejs', 'mia@example.com', async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
      await capstones.withdraw(enrollment.id);
      expect(await service().detail(`cap:${enrollment.id}`)).toBeUndefined();
    });

    it('an archived trainee’s detail is served from the database (no GitHub)', async () => {
      const { enrollment } = await capstones.enroll('nodejs', 'mia@example.com', async () => ({ seedManifest: {}, credentials: 'c', answerKey: 'k' }));
      await capstones.linkRepo(enrollment.id, 'mia@example.com', 'https://github.com/o/mia');
      await capstones.complete(enrollment.id, 'teacher@example.com', { version: 1, trainee: 'mia@example.com', lab: 'l', course: 'c', summary: [], checks: [], history: [] });
      const key = await lab('mia', { user: 'mia@example.com', repo: 'https://github.com/o/mia' });
      const svc = service();
      expect((await svc.detail(key))!.capstone).toMatchObject({ status: 'completed' });
      expect(svc.gh.calls).toEqual([]);
    });
  });
});

describe('parseLabKey', () => {
  it('splits at the first "::" and refuses anything else', () => {
    expect(parseLabKey('lab:agent-1::my-lab')).toEqual({ agentId: 'agent-1', resourceName: 'my-lab' });
    expect(parseLabKey('lab:a.b_c-1::x::y')).toEqual({ agentId: 'a.b_c-1', resourceName: 'x::y' });
    for (const bad of ['', 'lab:', 'lab:x', 'lab:x::', 'lab:::x', 'cap:1', 'agent::name', 'LAB:a::b']) expect(parseLabKey(bad)).toBeUndefined();
  });
});

describe('withNewestLogsOnly', () => {
  it('keeps the log of the first (newest) entry of each check name and drops the rest', () => {
    const out = withNewestLogsOnly([
      { name: 'grade', logs: 'g-new' },
      { name: 'seeded', logs: 's-new' },
      { name: 'grade', logs: 'g-old' },
      { name: 'seeded', logs: 's-old' },
      { logs: 'unnamed-new' },
      { logs: 'unnamed-old' },
    ]);
    expect(out.map(c => c.logs)).toEqual(['g-new', 's-new', undefined, undefined, 'unnamed-new', undefined]);
  });
});
