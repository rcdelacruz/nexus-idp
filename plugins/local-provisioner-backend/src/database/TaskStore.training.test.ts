import { Knex } from 'knex';
import { CHECK_LOG_TAIL_BYTES, TaskStore } from './TaskStore';
import { addAgent, addTask, createTrainingDb } from '../testing/trainingDb';
import { PROVISION_TASK_TYPES, ResourceState, TRAINING_TASK_TYPES } from '../types';

/** The queries behind the Trainees view, on a real (in-memory) database. */
describe('TaskStore training histories', () => {
  let db: Knex;
  let store: TaskStore;
  const queries: string[] = [];
  const bindingsOf = new Map<string, unknown[]>();

  beforeEach(async () => {
    db = await createTrainingDb();
    db.on('query', (q: { sql: string; bindings?: unknown[] }) => {
      queries.push(q.sql);
      bindingsOf.set(q.sql, q.bindings ?? []);
    });
    store = new TaskStore(db);
    queries.length = 0;
  });
  afterEach(async () => {
    await db.destroy();
  });

  const lab = { agent: 'a1', resource: 'tf-ann', config: { labId: 'terraform-capstone-a', githubRepoUrl: 'https://github.com/o/tf-ann' } };

  /** A realistic spread: every state, a generic and a legacy training type, an open task, checks, a non-training resource. */
  async function fixture() {
    await addTask(db, { ...lab, type: 'provision-training', at: 1, metadata: { activity: [{ at: 'x', step: 'done' }] }, logs: 'L'.repeat(5000), connection: { host: 'h' } });
    await addTask(db, { ...lab, type: 'stop', at: 2, config: { targetTaskId: 't' } });
    await addTask(db, { ...lab, type: 'start', at: 3, config: { targetTaskId: 't' } });
    await addTask(db, { agent: 'a2', resource: 'removed-lab', type: 'provision-training', at: 4, config: { labId: 'linux-capstone-a' } });
    await addTask(db, { agent: 'a2', resource: 'removed-lab', type: 'deprovision', at: 5 });
    await addTask(db, { agent: 'a3', resource: 'failed-lab', type: 'provision-training', status: 'failed', at: 6, config: { labId: 'nodejs-capstone-a' }, error: 'Port 4566 is already in use' });
    await addTask(db, { agent: 'a4', resource: 'busy-lab', type: 'provision-kafka-training', status: 'in-progress', at: 7, metadata: { activity: [{ at: '2026-11-01T00:08:00.000Z', step: 'Building app' }], phase: 'Building app' } });
    await addTask(db, { agent: 'a5', resource: 'plain-postgres', type: 'provision-postgres', at: 8, logs: 'not a training lab' });
    // checks on the first lab
    await addTask(db, { ...lab, type: 'run-check', at: 10, config: { checkName: 'seeded-resources' }, metadata: { check: { exitCode: 0, output: '{"checked":12,"missing":[]}' } }, logs: 'noise' });
    await addTask(db, { ...lab, type: 'run-check', at: 11, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'OLD GRADE {"auto_total":1,"items":[],"hard_fails":[]}' } } });
    await addTask(db, { ...lab, type: 'run-check', at: 12, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'NEW GRADE {"auto_total":3,"items":[{"points":4,"got":3}],"hard_fails":["x"]}' } } });
    await addTask(db, { ...lab, type: 'run-check', status: 'failed', at: 13, config: { checkName: 'grade-post' }, error: 'Job exited with 1', logs: 'terraform init failed' });
  }

  describe('getTrainingListData', () => {
    it('lists training labs only, removed ones included, with their provisioning task and timeline', async () => {
      await fixture();
      const list = await store.getTrainingListData();
      expect(list.map(h => [h.resource.resource_name, h.resource.state, h.provision.config?.labId ?? null]).sort()).toEqual([
        ['busy-lab', ResourceState.PROVISIONING, null],
        ['failed-lab', ResourceState.ERROR, 'nodejs-capstone-a'],
        ['removed-lab', ResourceState.REMOVED, 'linux-capstone-a'],
        ['tf-ann', ResourceState.RUNNING, 'terraform-capstone-a'],
      ]);
      const ann = list.find(h => h.resource.resource_name === 'tf-ann')!;
      expect(ann.events.filter(e => e.type !== 'run-check').map(e => e.type)).toEqual(['provision-training', 'stop', 'start']);
    });

    it('reports what the agent is doing right now from the open task', async () => {
      await fixture();
      const busy = (await store.getTrainingListData()).find(h => h.resource.resource_name === 'busy-lab')!;
      expect(busy.current).toMatchObject({ type: 'provision-kafka-training', status: 'in-progress', step: 'Building app' });
      expect(busy.current?.since.toISOString()).toBe('2026-11-01T00:08:00.000Z');
    });

    it('never reads logs or connection details, only a few config fields, and nothing of non-training resources', async () => {
      await fixture();
      queries.length = 0;
      await store.getTrainingListData();
      const main = queries.find(q => q.includes('from `provisioning_tasks` as `t`'))!;
      expect(main).toBeDefined();
      expect(main).not.toMatch(/logs/);
      expect(main).not.toMatch(/connection_details/);
      expect(main).toMatch(/json_extract\(`t`\.`config`/);
      expect(main.replace(/json_extract\([^)]*\)/g, '')).not.toMatch(/`config`/); // config is read only through json_extract
      expect(main).toMatch(/`task_type` in /); // the training groups are found first
      // Each config field is read only for the task types that use it (Postgres decompresses the whole config per field): 3 for provisions, 1 for checks.
      expect(main.match(/case when `t`\.`task_type` in \(/gi)).toHaveLength(4);
      // ...and the task types they are limited to are exactly the provisions (3 fields) and the check (1 field).
      const bindings = bindingsOf.get(main)!;
      expect(bindings.filter(b => b === 'run-check')).toHaveLength(1);
      expect(bindings).toHaveLength(3 * (PROVISION_TASK_TYPES.length + 1) + (1 + 1) + 2 + TRAINING_TASK_TYPES.length);
      // The training groups are found by their provision task type, nothing wider.
      expect(main).toMatch(/select distinct `agent_id`, `resource_name` from `provisioning_tasks` where `task_type` in \(/);
    });

    it('keeps only the config fields the list needs (compose files, source trees and grader jobs stay in the database)', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1, config: { labId: 'x', githubRepoUrl: 'https://github.com/o/r', dockerCompose: 'services: {}', sourceFiles: { 'a': 'b' }, gitlabRepoUrl: 'https://gitlab.com/o/r' } });
      await addTask(db, { ...lab, type: 'run-check', at: 2, config: { checkName: 'grade', job: { files: { 'grade.py': 'x'.repeat(5000) } }, targetTaskId: 'p' } });
      const [ann] = await store.getTrainingListData();
      expect(ann.provision.config).toEqual({ labId: 'x', githubRepoUrl: 'https://github.com/o/r', gitlabRepoUrl: 'https://gitlab.com/o/r' });
    });

    it('loads the result of only the newest completed grade of a lab, and no log of any check', async () => {
      await fixture();
      const checks = (await store.getTrainingListData()).find(h => h.resource.resource_name === 'tf-ann')!.events.filter(e => e.type === 'run-check');
      const byName = (name: string) => checks.filter(c => c.check?.name === name);
      expect(byName('seeded-resources')[0].check?.output).toBeUndefined(); // not a grade
      const grades = byName('grade-pre');
      expect(grades[0].check?.output).toBeUndefined(); // older grade
      expect(grades[1].check?.output).toContain('NEW GRADE'); // newest completed grade
      const failed = byName('grade-post')[0];
      expect(failed).toMatchObject({ status: 'failed' });
      expect(failed.check).toMatchObject({ exitCode: 1, error: 'Job exited with 1', logs: undefined });
      expect(checks.every(c => c.check?.logs === undefined)).toBe(true);
    });

    it('a check that is not a grade never takes the place of the newest grade, even when it is newer', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      await addTask(db, { ...lab, type: 'run-check', at: 2, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'THE GRADE {"auto_total":1,"items":[],"hard_fails":[]}' } } });
      await addTask(db, { ...lab, type: 'run-check', at: 3, config: { checkName: 'seeded-resources' }, metadata: { check: { exitCode: 0, output: 'LATER CHECK' } } });
      const checks = (await store.getTrainingListData())[0].events.filter(e => e.type === 'run-check');
      expect(checks.find(c => c.check?.name === 'grade-pre')?.check?.output).toContain('THE GRADE');
      expect(checks.find(c => c.check?.name === 'seeded-resources')?.check?.output).toBeUndefined();
    });

    it('a lab with no completed grade needs no second query', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      queries.length = 0;
      await store.getTrainingListData();
      expect(queries.filter(q => /select `task_id`, `metadata`/.test(q))).toEqual([]);
    });

    it('returns nothing, without error, when there are no training labs', async () => {
      await addTask(db, { agent: 'a5', resource: 'plain-postgres', type: 'provision-postgres' });
      expect(await store.getTrainingListData()).toEqual([]);
    });

    it('is the same lab state as the full history, for every lab (the cheap query must not change the answer)', async () => {
      await fixture();
      const list = await store.getTrainingListData();
      expect(list).toHaveLength(4);
      for (const slim of list) {
        const full = (await store.getTrainingResourceHistory(slim.resource.agent_id, slim.resource.resource_name))!;
        const { connection_details: _a, ...slimResource } = slim.resource;
        const { connection_details: _b, ...fullResource } = full.resource;
        expect(slimResource).toEqual(fullResource);
        expect(slim.provision.task_id).toBe(full.provision.task_id);
        expect(slim.provision.config?.labId).toBe(full.provision.config?.labId);
        expect(slim.current).toEqual(full.current);
        expect(slim.events.map(e => [e.type, e.status, e.at.toISOString(), e.check?.name])).toEqual(full.events.map(e => [e.type, e.status, e.at.toISOString(), e.check?.name]));
      }
    });
  });

  describe('getTrainingResourceHistory', () => {
    it('is undefined for a resource that is not a training lab, and for one that does not exist', async () => {
      await fixture();
      expect(await store.getTrainingResourceHistory('a5', 'plain-postgres')).toBeUndefined();
      expect(await store.getTrainingResourceHistory('a1', 'nope')).toBeUndefined();
      expect(await store.getTrainingResourceHistory('nope', 'tf-ann')).toBeUndefined();
    });

    it('reads one lab with everything: every check result and the end of a failed check log', async () => {
      await fixture();
      const ann = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!;
      expect(ann.resource).toMatchObject({ resource_name: 'tf-ann', state: ResourceState.RUNNING });
      const checks = ann.events.filter(e => e.type === 'run-check');
      expect(checks.map(c => c.check?.output).filter(Boolean)).toHaveLength(4); // all four have an output (the failed one: its reason)
      expect(checks.find(c => c.check?.name === 'grade-pre' && c.check.output?.includes('OLD GRADE'))).toBeDefined();
      expect(checks.find(c => c.check?.name === 'grade-post')?.check).toMatchObject({ exitCode: 1, error: 'Job exited with 1', logs: 'terraform init failed' });
    });

    it('keeps only the tail of a very long log', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      await addTask(db, { ...lab, type: 'run-check', status: 'failed', at: 2, config: { checkName: 'grade' }, error: 'Job exited with 1', logs: `HEAD${'x'.repeat(CHECK_LOG_TAIL_BYTES)}TAIL` });
      const check = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!.events.find(e => e.type === 'run-check')!.check!;
      expect(check.logs).toHaveLength(CHECK_LOG_TAIL_BYTES);
      expect(check.logs?.endsWith('TAIL')).toBe(true);
      expect(check.logs).not.toContain('HEAD');
    });

    it('a finished check carries its result, not a log; a reported exit code wins over the error text', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      await addTask(db, { ...lab, type: 'run-check', at: 2, config: { checkName: 'a' }, logs: 'noise', metadata: { check: { exitCode: 0, output: '{"auto_total":3}' } } });
      await addTask(db, { ...lab, type: 'run-check', status: 'failed', at: 3, config: { checkName: 'b' }, error: 'Job exited with 1', logs: 'log', metadata: { check: { exitCode: 7, output: 'x' } } });
      const [done, crashed] = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!.events.filter(e => e.type === 'run-check');
      expect(done.check).toMatchObject({ exitCode: 0, output: '{"auto_total":3}', logs: undefined });
      expect(crashed.check).toMatchObject({ exitCode: 7, output: 'x' });
    });

    it('a failure with no log and no exit code still shows its reason', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      await addTask(db, { ...lab, type: 'run-check', status: 'failed', at: 2, config: { checkName: 'grade' }, error: 'Lab service app is not running' });
      const check = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!.events.find(e => e.type === 'run-check')!.check!;
      expect(check).toMatchObject({ exitCode: undefined, error: 'Lab service app is not running', output: 'Lab service app is not running', logs: undefined });
    });

    it('a check with neither output nor error has no output at all (not null)', async () => {
      await addTask(db, { ...lab, type: 'provision-training', at: 1 });
      await addTask(db, { ...lab, type: 'run-check', at: 2, config: { checkName: 'a' } });
      const check = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!.events.find(e => e.type === 'run-check')!.check!;
      expect(check.output).toBeUndefined();
    });
  });

  describe('getAgentsByIds', () => {
    it('returns the agents it knows, by id, and nothing for unknown ids', async () => {
      await addAgent(db, 'a1', new Date('2026-11-01T10:00:00Z'));
      await addAgent(db, 'a2', new Date('2026-11-01T11:00:00Z'));
      const agents = await store.getAgentsByIds(['a1', 'a2', 'a2', 'ghost']);
      expect([...agents.keys()].sort()).toEqual(['a1', 'a2']);
      expect(agents.get('a1')?.last_seen.toISOString()).toBe('2026-11-01T10:00:00.000Z');
      expect(await store.getAgentsByIds([])).toEqual(new Map());
    });

    it('reads many agents in a few queries, not one per agent', async () => {
      const seen = new Date('2026-11-01T10:00:00Z').toISOString();
      await db.batchInsert(
        'agent_registrations',
        Array.from({ length: 1000 }, (_, i) => ({ agent_id: `agent-${i}`, user_id: 'trainee@example.com', hostname: `agent-${i}`, machine_name: 'm', os_platform: 'darwin', platform_version: '25', agent_version: '0.1.32', last_seen: seen, created_at: seen })),
        100,
      );
      queries.length = 0;
      const agents = await store.getAgentsByIds(Array.from({ length: 1000 }, (_, i) => `agent-${i}`));
      expect(agents.size).toBe(1000);
      expect(queries.filter(q => q.includes('agent_registrations'))).toHaveLength(3); // 400 + 400 + 200
    });
  });
});
