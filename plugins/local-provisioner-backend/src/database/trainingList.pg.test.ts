import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { TaskStore } from './TaskStore';
import { addTask } from '../testing/trainingDb';
import { ResourceState } from '../types';

/**
 * The Trainees list query on real Postgres (the sqlite tests in TaskStore.training.test.ts cover the same rules, but the projection
 * of `config` is `->>` here and `json_extract` there). Skipped unless LP_TEST_PG_URL is set (see traineeRemovals.pg.test.ts).
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;
const SCHEMA = 'lp_training_list_test';

maybe('the Trainees list query on real Postgres', () => {
  let db: Knex;
  let store: TaskStore;
  const queries: string[] = [];
  const dir = path.join(__dirname, 'migrations');

  beforeAll(async () => {
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: [SCHEMA], pool: { min: 1, max: 5 } });
    for (const f of fs.readdirSync(dir).filter(n => /^\d{3}-.*\.js$/.test(n)).sort()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require(path.join(dir, f)).up(db);
    }
    db.on('query', (q: { sql: string }) => queries.push(q.sql));
    store = new TaskStore(db);
  }, 60_000);
  afterAll(async () => {
    await db?.destroy();
  });
  beforeEach(async () => {
    await db('provisioning_tasks').del();
    await db('agent_registrations').del();
    queries.length = 0;
  });

  const lab = { agent: 'a1', resource: 'tf-ann', config: { labId: 'terraform-capstone-a', githubRepoUrl: 'https://github.com/o/tf-ann' } };
  const add = (row: Parameters<typeof addTask>[1]) => addTask(db, { id: randomUUID(), ...row });

  async function fixture() {
    await add({ ...lab, type: 'provision-training', at: 1, metadata: { activity: [{ at: 'x', step: 'done' }] }, logs: 'L'.repeat(5000), connection: { host: 'h' }, config: { ...lab.config, dockerCompose: 'services: {}', sourceFiles: { a: 'b'.repeat(3000) } } });
    await add({ ...lab, type: 'stop', at: 2, config: { targetTaskId: 't' } });
    await add({ ...lab, type: 'start', at: 3, config: { targetTaskId: 't' } });
    await add({ agent: 'a2', resource: 'removed-lab', type: 'provision-training', at: 4, config: { labId: 'linux-capstone-a' } });
    await add({ agent: 'a2', resource: 'removed-lab', type: 'deprovision', at: 5 });
    await add({ agent: 'a3', resource: 'failed-lab', type: 'provision-training', status: 'failed', at: 6, config: { labId: 'nodejs-capstone-a' }, error: 'Port 4566 is already in use' });
    await add({ agent: 'a4', resource: 'busy-lab', type: 'provision-kafka-training', status: 'in-progress', at: 7, metadata: { activity: [{ at: '2026-11-01T00:08:00.000Z', step: 'Building app' }], phase: 'Building app' } });
    await add({ agent: 'a5', resource: 'plain-postgres', type: 'provision-postgres', at: 8, logs: 'not a training lab' });
    await add({ ...lab, type: 'run-check', at: 10, config: { checkName: 'seeded-resources', job: { files: { 'grade.py': 'g'.repeat(4000) } } }, metadata: { check: { exitCode: 0, output: '{"checked":12,"missing":[]}' } }, logs: 'noise' });
    await add({ ...lab, type: 'run-check', at: 11, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'OLD GRADE' } } });
    await add({ ...lab, type: 'run-check', at: 12, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'NEW GRADE {"auto_total":3,"items":[],"hard_fails":["x"]}' } } });
    await add({ ...lab, type: 'run-check', status: 'failed', at: 13, config: { checkName: 'grade-post' }, error: 'Job exited with 1', logs: 'terraform init failed' });
  }

  it('lists the training labs, removed ones included, and nothing else', async () => {
    await fixture();
    const list = await store.getTrainingListData();
    expect(list.map(h => [h.resource.resource_name, h.resource.state]).sort()).toEqual([
      ['busy-lab', ResourceState.PROVISIONING],
      ['failed-lab', ResourceState.ERROR],
      ['removed-lab', ResourceState.REMOVED],
      ['tf-ann', ResourceState.RUNNING],
    ]);
    const busy = list.find(h => h.resource.resource_name === 'busy-lab')!;
    expect(busy.current).toMatchObject({ status: 'in-progress', step: 'Building app' });
    expect(busy.current?.since.toISOString()).toBe('2026-11-01T00:08:00.000Z');
  });

  it('never selects logs or connection details, and reads config only through ->>', async () => {
    await fixture();
    queries.length = 0;
    await store.getTrainingListData();
    const main = queries.find(q => /from "provisioning_tasks" as "t"/.test(q))!;
    expect(main).toBeDefined();
    expect(main).not.toMatch(/logs/);
    expect(main).not.toMatch(/connection_details/);
    expect(main).toMatch(/"t"\."config" ->> \$\d+/);
    expect(main.match(/CASE WHEN "t"."task_type" IN \(/g)).toHaveLength(4); // 3 fields for provisions, 1 for checks: never for the rest
    expect(main).toMatch(/select distinct "agent_id", "resource_name" from "provisioning_tasks" where "task_type" in \(/); // the training groups, nothing wider
    expect(main.replace(/"t"\."config" ->> \$\d+/g, '')).not.toMatch(/"config"/);
  });

  it('keeps only the small config fields', async () => {
    await fixture();
    const ann = (await store.getTrainingListData()).find(h => h.resource.resource_name === 'tf-ann')!;
    expect(ann.provision.config).toEqual({ labId: 'terraform-capstone-a', githubRepoUrl: 'https://github.com/o/tf-ann' });
  });

  it('reads the result of only the newest completed grade, and no log', async () => {
    await fixture();
    const checks = (await store.getTrainingListData()).find(h => h.resource.resource_name === 'tf-ann')!.events.filter(e => e.type === 'run-check');
    const grades = checks.filter(c => c.check?.name === 'grade-pre');
    expect(grades[0].check?.output).toBeUndefined();
    expect(grades[1].check?.output).toContain('NEW GRADE');
    expect(checks.find(c => c.check?.name === 'seeded-resources')?.check?.output).toBeUndefined();
    expect(checks.find(c => c.check?.name === 'grade-post')?.check).toMatchObject({ exitCode: 1, error: 'Job exited with 1', logs: undefined });
  });

  it('a check that is not a grade never takes the place of the newest grade, even when it is newer', async () => {
    await add({ ...lab, type: 'provision-training', at: 1 });
    await add({ ...lab, type: 'run-check', at: 2, config: { checkName: 'grade-pre' }, metadata: { check: { exitCode: 0, output: 'THE GRADE' } } });
    await add({ ...lab, type: 'run-check', at: 3, config: { checkName: 'seeded-resources' }, metadata: { check: { exitCode: 0, output: 'LATER CHECK' } } });
    const checks = (await store.getTrainingListData())[0].events.filter(e => e.type === 'run-check');
    expect(checks.find(c => c.check?.name === 'grade-pre')?.check?.output).toBe('THE GRADE');
    expect(checks.find(c => c.check?.name === 'seeded-resources')?.check?.output).toBeUndefined();
  });

  it('gives the same lab state as the full history, for every lab', async () => {
    await fixture();
    const list = await store.getTrainingListData();
    expect(list).toHaveLength(4);
    for (const slim of list) {
      const full = (await store.getTrainingResourceHistory(slim.resource.agent_id, slim.resource.resource_name))!;
      const { connection_details: _a, ...slimResource } = slim.resource;
      const { connection_details: _b, ...fullResource } = full.resource;
      expect(slimResource).toEqual(fullResource);
      expect(slim.current).toEqual(full.current);
      expect(slim.events.map(e => [e.type, e.status, e.at.toISOString(), e.check?.name])).toEqual(full.events.map(e => [e.type, e.status, e.at.toISOString(), e.check?.name]));
    }
  });

  it('the single-lab history has everything, including the end of a failed check log', async () => {
    await fixture();
    const ann = (await store.getTrainingResourceHistory('a1', 'tf-ann'))!;
    expect(ann.events.find(e => e.check?.name === 'grade-post')?.check).toMatchObject({ logs: 'terraform init failed' });
    expect(await store.getTrainingResourceHistory('a5', 'plain-postgres')).toBeUndefined();
  });

  it('reads many agents in a few queries', async () => {
    const seen = new Date('2026-11-01T10:00:00Z').toISOString();
    await db('agent_registrations').insert(
      Array.from({ length: 900 }, (_, i) => ({ agent_id: `agent-${i}`, user_id: 'trainee@example.com', hostname: `agent-${i}`, machine_name: 'm', os_platform: 'darwin', platform_version: '25', agent_version: '0.1.32', last_seen: seen, created_at: seen })),
    );
    queries.length = 0;
    const agents = await store.getAgentsByIds(Array.from({ length: 900 }, (_, i) => `agent-${i}`));
    expect(agents.size).toBe(900);
    expect(agents.get('agent-5')?.last_seen.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(queries.filter(q => q.includes('agent_registrations'))).toHaveLength(3);
  });
});
