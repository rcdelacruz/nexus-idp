import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { TaskStore } from './TaskStore';
import { TaskStatus } from '../types';

/**
 * Real-Postgres check of the activity timeline: concurrent agent updates (the Linux lab's agent
 * sent two 6 ms apart) must both land, and completion must keep the timeline. Skipped unless
 * LP_TEST_PG_URL is set — see traineeRemovals.pg.test.ts for how to start a throwaway Postgres.
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;

maybe('task activity timeline on real Postgres', () => {
  let db: Knex;
  const dir = path.join(__dirname, 'migrations');
  beforeAll(async () => {
    db = knexFactory({ client: 'pg', connection: url, pool: { min: 2, max: 10 } });
    await db.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const f of fs.readdirSync(dir).filter(n => /^\d{3}-.*\.js$/.test(n)).sort()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require(path.join(dir, f)).up(db);
    }
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('keeps every step under concurrent updates, then closes it on completion', async () => {
    const store = new TaskStore(db);
    const t = await store.createTask('ann@example.com', {
      agent_id: 'agent-1',
      task_type: 'provision-training' as any,
      resource_name: 'linux-capstone-ann',
      config: { labId: 'linux-capstone' },
    });
    await store.updateTaskStatus(t.task_id, TaskStatus.IN_PROGRESS, { phase: 'creating the VM' });
    // Fired together, like the agent's fire-and-forget progress reports.
    const steps = [
      'copying the seed',
      ...Array.from({ length: 38 }, (_, i) => `copying file-${String(i).padStart(2, '0')}`),
      'seeding the server (10–20 min)',
    ];
    await Promise.all(steps.map((phase, i) => store.updateTaskStatus(t.task_id, TaskStatus.IN_PROGRESS, { phase, at: new Date(Date.now() + i).toISOString() })));
    await store.updateTaskStatus(t.task_id, TaskStatus.COMPLETED, { vm: { instance: 'linux-capstone-ann' } }, undefined, { logs: 'ok' });

    const saved = (await store.getTaskById(t.task_id))!;
    expect(saved.metadata!.activity.map((e: any) => e.step)).toEqual(['creating the VM', ...steps, 'completed']);
    expect(saved.metadata!.vm).toEqual({ instance: 'linux-capstone-ann' });
    expect(saved.status).toBe(TaskStatus.COMPLETED);

    // A progress report that arrives after completion changes nothing.
    await store.updateTaskStatus(t.task_id, TaskStatus.IN_PROGRESS, { phase: 'Starting the VM', output: 'late' });
    const after = (await store.getTaskById(t.task_id))!;
    expect(after.status).toBe(TaskStatus.COMPLETED);
    expect(after.metadata!.activity).toEqual(saved.metadata!.activity);

    const [history] = await store.getTrainingResourceHistories();
    expect(history.current).toBeUndefined(); // nothing running any more
  });

  it('reports the running step for the Trainees view', async () => {
    const store = new TaskStore(db);
    const t = await store.createTask('bob@example.com', {
      agent_id: 'agent-2',
      task_type: 'provision-training' as any,
      resource_name: 'ministack-bob',
      config: { labId: 'ministack', dockerCompose: 'services: {}' },
    });
    await store.updateTaskStatus(t.task_id, TaskStatus.IN_PROGRESS, { phase: 'pulling-images' });
    const h = (await store.getTrainingResourceHistories()).find(x => x.resource.resource_name === 'ministack-bob')!;
    expect(h.current).toMatchObject({ status: TaskStatus.IN_PROGRESS, step: 'pulling-images' });
  });

  it('removing a lab stuck in setup closes its stuck task and the lab reads as removed', async () => {
    const store = new TaskStore(db);
    const stuck = await store.createTask('ron@example.com', {
      agent_id: 'agent-3',
      task_type: 'provision-training' as any,
      resource_name: 'linux-capstone-ron',
      config: { labId: 'linux-capstone' },
    });
    await store.updateTaskStatus(stuck.task_id, TaskStatus.IN_PROGRESS, { phase: 'seeding the server (10–20 min)' });
    // The agent restarted: nothing will ever finish `stuck`. The trainee uses Cancel & remove.
    const remove = await store.createTask('ron@example.com', {
      agent_id: 'agent-3',
      task_type: 'deprovision' as any,
      resource_name: 'linux-capstone-ron',
      config: { targetTaskId: stuck.task_id },
    });
    await store.updateTaskStatus(remove.task_id, TaskStatus.COMPLETED);

    const closed = (await store.getTaskById(stuck.task_id))!;
    expect(closed.status).toBe(TaskStatus.FAILED);
    expect(closed.error_message).toBe('Cancelled: the lab was removed');
    const h = (await store.getTrainingResourceHistories()).find(x => x.resource.resource_name === 'linux-capstone-ron')!;
    expect(h.resource.state).toBe('removed');
    expect(h.current).toBeUndefined();
  });
});
