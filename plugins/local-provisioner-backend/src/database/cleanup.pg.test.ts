import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { TaskStore } from './TaskStore';
import { TaskStatus, TaskType } from '../types';

/**
 * The nightly clean-up of finished task rows, on a real table. It used to delete every finished row older than 30 days, which made
 * running labs vanish from the portal, stopped labs fold back to "running", removed training labs disappear from the instructor's
 * Trainees view and every grade result vanish after a month. Time passes by moving the clock the clean-up uses: no row is backdated.
 *
 * Skipped unless LP_TEST_PG_URL is set. Uses its own schema.
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;
const SCHEMA = 'lp_cleanup_test';
const DAY = 86_400_000;

maybe('nightly clean-up of task rows (real Postgres)', () => {
  let db: Knex;
  let store: TaskStore;
  const dir = path.join(__dirname, 'migrations');
  const ME = 'ann@example.com';
  const later = (days: number) => new Date(Date.now() + days * DAY);

  beforeAll(async () => {
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: [SCHEMA], pool: { min: 1, max: 5 } });
    for (const f of fs.readdirSync(dir).filter(n => /^\d{3}-.*\.js$/.test(n)).sort()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require(path.join(dir, f)).up(db);
    }
    store = new TaskStore(db);
  });
  afterAll(async () => {
    await db?.destroy();
  });
  beforeEach(async () => {
    await db('provisioning_tasks').delete();
  });

  const count = async () => Number((await db('provisioning_tasks').count({ n: '*' }).first())!.n);
  const namesLeft = async () => [...new Set((await db('provisioning_tasks').select('resource_name')).map((r: any) => r.resource_name))].sort();

  /** A lab that went through the given steps; every step completed. */
  async function lab(name: string, steps: Array<'provision' | 'stop' | 'start' | 'deprovision'>, opts: { training?: boolean; failProvision?: boolean } = {}) {
    const agent = 'agent-1';
    const type = opts.training === false ? TaskType.PROVISION_KAFKA : TaskType.PROVISION_TRAINING;
    for (const step of steps) {
      const t = await store.createTask(ME, {
        agent_id: agent,
        task_type: step === 'provision' ? type : (step as TaskType),
        resource_name: name,
        config: step === 'provision' ? { labId: 'ministack-training', dockerCompose: 'services: {}' } : { targetTaskId: 'x' },
      });
      const failed = step === 'provision' && opts.failProvision;
      await store.updateTaskStatus(t.task_id, failed ? TaskStatus.FAILED : TaskStatus.COMPLETED, undefined, failed ? 'port taken' : undefined);
    }
  }

  async function check(name: string, checkName: string) {
    const t = await store.createTask(ME, { agent_id: 'agent-1', task_type: TaskType.RUN_CHECK, resource_name: name, config: { checkName } });
    await store.updateTaskStatus(t.task_id, TaskStatus.COMPLETED);
    // distinct completion times, so "newest" is well defined
    await new Promise(r => setTimeout(r, 5));
    return t.task_id;
  }

  it('never deletes a lab that still exists, however old: running', async () => {
    await lab('running-lab', ['provision']);
    expect(await store.cleanupOldTasks(30, { now: later(900) })).toBe(0);
    expect(await count()).toBe(1);
    expect((await store.getActiveProvisionedResources()).map(r => r.resource_name)).toEqual(['running-lab']);
  });

  it('never deletes a lab that still exists, however old: stopped (its stop row stays, so it does not fold back to running)', async () => {
    await lab('stopped-lab', ['provision', 'stop']);
    expect(await store.cleanupOldTasks(30, { now: later(900) })).toBe(0);
    expect((await store.getActiveProvisionedResources()).find(r => r.resource_name === 'stopped-lab')?.state).toBe('stopped');
  });

  it('a removed lab that is not a training lab goes completely, but only after the retention', async () => {
    await lab('old-kafka', ['provision', 'stop', 'deprovision'], { training: false });
    expect(await store.cleanupOldTasks(30, { now: later(29) })).toBe(0);
    expect(await count()).toBe(3);
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(3);
    expect(await count()).toBe(0);
  });

  it('a removed TRAINING lab stays for a year, so the instructor still sees it (and its grades)', async () => {
    await lab('trainee-lab', ['provision', 'deprovision'], { training: true });
    await check('trainee-lab', 'grade');
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(0);
    expect(await store.cleanupOldTasks(30, { now: later(364) })).toBe(0);
    expect((await store.getTrainingListData()).map(h => h.resource.resource_name)).toEqual(['trainee-lab']);
    expect(await store.cleanupOldTasks(30, { now: later(366) })).toBe(3);
  });

  it('the training retention can be set, and is never shorter than the normal one', async () => {
    await lab('short-training', ['provision', 'deprovision']);
    expect(await store.cleanupOldTasks(30, { trainingRetentionDays: 90, now: later(80) })).toBe(0);
    expect(await store.cleanupOldTasks(30, { trainingRetentionDays: 90, now: later(91) })).toBe(2);
    await lab('floor', ['provision', 'deprovision']);
    expect(await store.cleanupOldTasks(60, { trainingRetentionDays: 10, now: later(50) })).toBe(0); // 10 would be shorter than 60
    expect(await store.cleanupOldTasks(60, { trainingRetentionDays: 10, now: later(61) })).toBe(2);
  });

  it('a failed attempt that never produced a lab goes after the retention, but a lab whose later retry worked stays', async () => {
    await lab('never-existed', ['provision'], { training: false, failProvision: true });
    await lab('retried', ['provision']); // completed provision
    const failedRetry = await store.createTask(ME, { agent_id: 'agent-1', task_type: TaskType.PROVISION_TRAINING, resource_name: 'retried-later', config: { labId: 'x', dockerCompose: 'services: {}' } });
    await store.updateTaskStatus(failedRetry.task_id, TaskStatus.FAILED, undefined, 'boom');
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(1); // only never-existed (non-training: 30 days)
    expect(await namesLeft()).toEqual(['retried', 'retried-later']);
  });

  it('a lab with something still pending is left alone', async () => {
    await lab('busy', ['provision', 'deprovision'], { training: false });
    await store.createTask(ME, { agent_id: 'agent-1', task_type: TaskType.PROVISION_KAFKA, resource_name: 'busy', config: {} }); // pending
    expect(await store.cleanupOldTasks(30, { now: later(900) })).toBe(0);
    expect(await count()).toBe(3);
  });

  it('inside a lab that exists, old routine checks are pruned but the newest 5 of each check always stay, grades included', async () => {
    await lab('graded', ['provision']);
    const routine: string[] = [];
    for (let i = 0; i < 8; i++) routine.push(await check('graded', 'resources'));
    const grade = await check('graded', 'grade');
    const deleted = await store.cleanupOldTasks(30, { now: later(31) });
    expect(deleted).toBe(3); // the 3 oldest routine results
    const left = (await db('provisioning_tasks').select('task_id')).map((r: any) => r.task_id);
    expect(left).toEqual(expect.arrayContaining([...routine.slice(3), grade]));
    for (const gone of routine.slice(0, 3)) expect(left).not.toContain(gone);
    expect(await count()).toBe(1 + 5 + 1);
  });

  it('checks younger than the retention are never pruned, however many there are', async () => {
    await lab('fresh-checks', ['provision']);
    for (let i = 0; i < 8; i++) await check('fresh-checks', 'resources');
    expect(await store.cleanupOldTasks(30, { now: later(10) })).toBe(0);
  });

  it('a removed lab with a check still pending is left alone (a pending check does not change the lab, but it is not finished)', async () => {
    await lab('removed-but-checking', ['provision', 'deprovision'], { training: false });
    await store.createTask(ME, { agent_id: 'agent-1', task_type: TaskType.RUN_CHECK, resource_name: 'removed-but-checking', config: { checkName: 'grade' } }); // pending
    expect(await store.cleanupOldTasks(30, { now: later(900) })).toBe(0);
    expect(await count()).toBe(3);
  });

  it('a lab that worked and whose later start FAILED is an error lab, not a lab that never existed: it stays', async () => {
    await lab('worked-then-failed', ['provision'], { training: false });
    const start = await store.createTask(ME, { agent_id: 'agent-1', task_type: TaskType.START, resource_name: 'worked-then-failed', config: { targetTaskId: 'x' } });
    await store.updateTaskStatus(start.task_id, TaskStatus.FAILED, undefined, 'docker is not running');
    expect((await store.getActiveProvisionedResources()).find(r => r.resource_name === 'worked-then-failed')?.state).toBe('error');
    expect(await store.cleanupOldTasks(30, { now: later(900) })).toBe(0);
    expect(await count()).toBe(2);
  });

  it('the age of a gone lab is the age of its NEWEST row: a lab removed yesterday is not deleted because it was provisioned long ago', async () => {
    await lab('long-lived-then-removed', ['provision', 'deprovision'], { training: false });
    const rows = await db('provisioning_tasks').where({ resource_name: 'long-lived-then-removed' }).orderBy('created_at', 'asc');
    const longAgo = new Date(Date.now() - 100 * DAY);
    await db('provisioning_tasks').where({ task_id: rows[0].task_id }).update({ created_at: longAgo, updated_at: longAgo, completed_at: longAgo }); // the provision, 100 days ago
    expect(await store.cleanupOldTasks(30, { now: later(10) })).toBe(0); // the removal is only 10 days old
    expect(await count()).toBe(2);
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(2);
  });

  it('deletes everything that is due, not just the first batch', async () => {
    const old = new Date(Date.now() - 400 * DAY);
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 700; i++) {
      for (const task_type of [TaskType.PROVISION_KAFKA, TaskType.DEPROVISION]) {
        rows.push({ agent_id: 'bulk-agent', user_id: ME, task_type, resource_name: `bulk-${i}`, config: JSON.stringify({}), status: TaskStatus.COMPLETED, created_at: old, updated_at: old, completed_at: old });
      }
    }
    for (let i = 0; i < rows.length; i += 200) await db('provisioning_tasks').insert(rows.slice(i, i + 200));
    expect(await store.cleanupOldTasks(30)).toBe(1400);
    expect(await count()).toBe(0);
  });

  it('orphan rows (no provision row left) go after the retention', async () => {
    await check('orphan', 'resources');
    expect(await store.cleanupOldTasks(30, { now: later(10) })).toBe(0);
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(1);
  });

  it('one lab\'s clean-up never touches another lab\'s rows, and the same name on another agent is a different lab', async () => {
    await lab('same-name', ['provision', 'deprovision'], { training: false });
    const other = await store.createTask(ME, { agent_id: 'agent-2', task_type: TaskType.PROVISION_KAFKA, resource_name: 'same-name', config: {} });
    await store.updateTaskStatus(other.task_id, TaskStatus.COMPLETED);
    expect(await store.cleanupOldTasks(30, { now: later(31) })).toBe(2);
    expect((await db('provisioning_tasks').select('agent_id')).map((r: any) => r.agent_id)).toEqual(['agent-2']);
  });
});
