/**
 * Tests for foldTasksToResource — the logic that derives a resource's current lifecycle state
 * from its task history. This drives what the catalog EntityProvider emits and what the UI shows,
 * so the state transitions must be exactly right (a stale "running" would show a torn-down
 * resource in the catalog).
 */

import { foldTasksToResource, mergeTaskMetadata, TaskStore } from './TaskStore';
import { ProvisioningTask, TaskStatus, TaskType, ResourceState } from '../types';

let seq = 0;
function task(partial: Partial<ProvisioningTask>): ProvisioningTask {
  seq += 1;
  const now = new Date(2026, 0, 1, 0, 0, seq); // strictly increasing created_at
  return {
    task_id: `t${seq}`,
    agent_id: 'agent-1',
    user_id: 'dev@example.com',
    task_type: TaskType.PROVISION_KAFKA,
    resource_name: 'my-kafka',
    config: {},
    status: TaskStatus.COMPLETED,
    created_at: now,
    updated_at: now,
    ...partial,
  };
}

describe('foldTasksToResource', () => {
  it('returns undefined when there is no provision task', () => {
    expect(foldTasksToResource([task({ task_type: TaskType.STOP })])).toBeUndefined();
  });

  it('a completed provision → running', () => {
    const r = foldTasksToResource([task({})]);
    expect(r?.state).toBe(ResourceState.RUNNING);
    expect(r?.resource_type).toBe('kafka');
  });

  it('provision then completed stop → stopped', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA }),
      task({ task_type: TaskType.STOP }),
    ]);
    expect(r?.state).toBe(ResourceState.STOPPED);
  });

  it('stop then start → running', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA }),
      task({ task_type: TaskType.STOP }),
      task({ task_type: TaskType.START }),
    ]);
    expect(r?.state).toBe(ResourceState.RUNNING);
  });

  it('a completed deprovision → removed (excluded from the catalog)', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA }),
      task({ task_type: TaskType.DEPROVISION }),
    ]);
    expect(r?.state).toBe(ResourceState.REMOVED);
  });

  it('an in-flight task → provisioning', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA, status: TaskStatus.IN_PROGRESS }),
    ]);
    expect(r?.state).toBe(ResourceState.PROVISIONING);
  });

  it('a failed latest task → error', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA, status: TaskStatus.FAILED }),
    ]);
    expect(r?.state).toBe(ResourceState.ERROR);
  });

  it('carries connection details from the latest provision', () => {
    const r = foldTasksToResource([
      task({
        task_type: TaskType.PROVISION_KAFKA,
        connection_details: { host: 'localhost', connectionString: 'localhost:9092' },
      }),
      task({ task_type: TaskType.RESTART }),
    ]);
    expect(r?.state).toBe(ResourceState.RUNNING);
    expect(r?.connection_details?.connectionString).toBe('localhost:9092');
  });

  describe('generic provision-training', () => {
    const lab = (partial: Partial<ProvisioningTask> = {}) =>
      task({
        task_type: TaskType.PROVISION_TRAINING,
        resource_name: 'ministack-jane-1',
        config: { labId: 'ministack', dockerCompose: 'services: {}' },
        ...partial,
      });

    it('folds to a training resource whose type is the labId', () => {
      const r = foldTasksToResource([lab()]);
      expect(r?.state).toBe(ResourceState.RUNNING);
      expect(r?.resource_type).toBe('ministack');
      expect(r?.is_training).toBe(true);
    });

    it('stop / start lifecycle folds like any other resource', () => {
      expect(foldTasksToResource([lab(), task({ task_type: TaskType.STOP })])?.state).toBe(ResourceState.STOPPED);
      expect(
        foldTasksToResource([lab(), task({ task_type: TaskType.STOP }), task({ task_type: TaskType.START })])?.state,
      ).toBe(ResourceState.RUNNING);
    });

    it('provision then deprovision → removed', () => {
      expect(foldTasksToResource([lab(), task({ task_type: TaskType.DEPROVISION })])?.state).toBe(ResourceState.REMOVED);
    });

    it('an invalid labId still folds (the resource is real) but gets no type', () => {
      const r = foldTasksToResource([lab({ config: { labId: 'Bad--Id' } })]);
      expect(r?.state).toBe(ResourceState.RUNNING);
      expect(r?.resource_type).toBeUndefined();
      expect(r?.is_training).toBe(true);
    });
  });

  it('instructor checks (run-check) never change the resource state', () => {
    const r = foldTasksToResource([
      task({ task_type: TaskType.PROVISION_KAFKA }),
      task({ task_type: TaskType.STOP }),
      task({ task_type: TaskType.RUN_CHECK, status: TaskStatus.COMPLETED }),
    ]);
    expect(r?.state).toBe(ResourceState.STOPPED);
    const failing = foldTasksToResource([task({ task_type: TaskType.PROVISION_KAFKA }), task({ task_type: TaskType.RUN_CHECK, status: TaskStatus.FAILED })]);
    expect(failing?.state).toBe(ResourceState.RUNNING);
  });

  it('legacy per-lab training types are unchanged', () => {
    const r = foldTasksToResource([task({ task_type: TaskType.PROVISION_KAFKA_TRAINING })]);
    expect(r?.resource_type).toBe('kafka-training');
    expect(r?.is_training).toBe(true);
    expect(foldTasksToResource([task({})])?.is_training).toBe(false);
  });
});

describe('TaskStore.getTrainingResourceHistories', () => {
  // Rows as the DB returns them (config as a JSON string), already in created_at order.
  const row = (p: Record<string, unknown>) => ({
    agent_id: 'agent-1',
    user_id: 'trainee@example.com',
    status: 'completed',
    config: '{}',
    created_at: '2026-10-30T09:00:00Z',
    updated_at: '2026-10-30T09:00:00Z',
    ...p,
  });
  const rows = [
    row({ task_id: 'p1', task_type: 'provision-training', resource_name: 'lab-a', config: JSON.stringify({ labId: 'ministack', githubRepoUrl: 'https://github.com/o/training-lab-a' }), completed_at: '2026-10-30T09:01:00Z' }),
    row({ task_id: 's1', task_type: 'stop', resource_name: 'lab-a', config: '{"targetTaskId":"p1"}', created_at: '2026-10-30T10:00:00Z' }),
    row({ task_id: 'k1', task_type: 'provision-kafka', resource_name: 'my-kafka' }), // not training
    row({ task_id: 'p2', task_type: 'provision-kafka-training', resource_name: 'lab-b', user_id: 'other@example.com' }),
    row({ task_id: 'd2', task_type: 'deprovision', resource_name: 'lab-b', user_id: 'other@example.com', created_at: '2026-10-30T11:00:00Z' }),
  ];
  const db = ((table: string) => {
    expect(table).toBe('provisioning_tasks');
    return { orderBy: async () => rows };
  }) as any;

  it('returns training resources only, removed ones included, with their provisioning task and history', async () => {
    const out = await new TaskStore(db).getTrainingResourceHistories();
    expect(out.map(o => [o.resource.resource_name, o.resource.state, o.provision.task_id])).toEqual([
      ['lab-a', ResourceState.STOPPED, 'p1'],
      ['lab-b', ResourceState.REMOVED, 'p2'],
    ]);
    expect(out[0].provision.config.githubRepoUrl).toBe('https://github.com/o/training-lab-a');
    expect(out[0].resource.resource_type).toBe('ministack');
    expect(out[0].events.map(e => e.type)).toEqual(['provision-training', 'stop']);
  });
});

describe('TaskStore.hasOpenTask', () => {
  it('is true only for a pending or in-progress task of that type on that resource', async () => {
    const knexFactory = require('knex');
    const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('provisioning_tasks', (t: any) => {
      t.string('task_id'); t.string('agent_id'); t.string('resource_name'); t.string('task_type'); t.string('status');
    });
    await db('provisioning_tasks').insert([
      { task_id: '1', agent_id: 'a', resource_name: 'lab', task_type: 'run-check', status: 'completed' },
      { task_id: '2', agent_id: 'a', resource_name: 'lab', task_type: 'stop', status: 'pending' },
    ]);
    const store = new TaskStore(db);
    expect(await store.hasOpenTask('a', 'lab', 'run-check')).toBe(false);
    await db('provisioning_tasks').insert({ task_id: '3', agent_id: 'a', resource_name: 'lab', task_type: 'run-check', status: 'in-progress' });
    expect(await store.hasOpenTask('a', 'lab', 'run-check')).toBe(true);
    expect(await store.hasOpenTask('a', 'other', 'run-check')).toBe(false);
    await db.destroy();
  });
});

describe('mergeTaskMetadata — the activity timeline', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 31, 0, 25, s));
  const IN = TaskStatus.IN_PROGRESS;

  it('appends each new step with its time and keeps earlier fields', () => {
    let m = mergeTaskMetadata(undefined, { phase: 'creating the VM' }, IN, t(15));
    expect(m.newStep).toBe('creating the VM');
    m = mergeTaskMetadata({ ...m.metadata, catalogEntityRef: 'resource:x' }, { phase: 'seeding the server (10–20 min)' }, IN, t(40));
    expect(m.metadata.activity).toEqual([
      { at: t(15).toISOString(), step: 'creating the VM' },
      { at: t(40).toISOString(), step: 'seeding the server (10–20 min)' },
    ]);
    expect(m.metadata.catalogEntityRef).toBe('resource:x');
    expect(m.metadata.phase).toBe('seeding the server (10–20 min)');
  });

  it('a repeated step only refreshes its progress (no new entry)', () => {
    const a = mergeTaskMetadata(undefined, { phase: 'creating the VM', progress: { percent: 10 } }, IN, t(1)).metadata;
    const b = mergeTaskMetadata(a, { phase: 'creating the VM', progress: { percent: 55 } }, IN, t(9));
    expect(b.newStep).toBeUndefined();
    expect(b.metadata.activity).toHaveLength(1);
    expect(b.metadata.progress).toEqual({ percent: 55 });
  });

  it("a new step drops the previous step's progress and output", () => {
    const a = mergeTaskMetadata(undefined, { phase: 'pulling-images', progress: { percent: 80 }, output: 'x' }, IN, t(1)).metadata;
    const b = mergeTaskMetadata(a, { phase: 'starting' }, IN, t(5)).metadata;
    expect(b.progress).toBeUndefined();
    expect(b.output).toBeUndefined();
  });

  it('closes the timeline on completion and keeps the result fields', () => {
    const a = mergeTaskMetadata(undefined, { phase: 'starting the VM' }, IN, t(1)).metadata;
    const done = mergeTaskMetadata(a, { vm: { instance: 'lab' } }, TaskStatus.COMPLETED, t(30));
    expect(done.metadata.activity.map((e: any) => e.step)).toEqual(['starting the VM', 'completed']);
    expect(done.metadata.vm).toEqual({ instance: 'lab' });
    expect(done.newStep).toBeUndefined(); // completion is logged by the queue service already
    const again = mergeTaskMetadata(done.metadata, undefined, TaskStatus.COMPLETED, t(31));
    expect(again.metadata.activity).toHaveLength(2);
  });

  it('ignores a stale update that arrives after the next step began (first real Linux run)', () => {
    // 01:48:56 "Saving a snapshot" arrived, then the seed's last output update stamped just before it.
    const a = mergeTaskMetadata(undefined, { phase: 'Setting up the server', at: t(16).toISOString() }, IN, t(16)).metadata;
    const b = mergeTaskMetadata(a, { phase: 'Saving a snapshot (for resets)', at: t(56).toISOString() }, IN, t(56)).metadata;
    const late = mergeTaskMetadata(b, { phase: 'Setting up the server', output: 'seeded', at: t(55).toISOString() }, IN, t(57));
    expect(late.newStep).toBeUndefined();
    expect(late.metadata.phase).toBe('Saving a snapshot (for resets)');
    expect(late.metadata.activity.map((e: any) => e.step)).toEqual(['Setting up the server', 'Saving a snapshot (for resets)']);
    expect(late.metadata.output).toBeUndefined();
  });

  it('a step change that arrives out of order is slotted in, without moving the current step', () => {
    const a = mergeTaskMetadata(undefined, { phase: 'Copying the lab files into the VM', at: t(52).toISOString() }, IN, t(53)).metadata;
    const b = mergeTaskMetadata(a, { phase: 'Creating the VM', at: t(51).toISOString() }, IN, t(53));
    expect(b.metadata.activity.map((e: any) => e.step)).toEqual(['Creating the VM', 'Copying the lab files into the VM']);
    expect(b.metadata.phase).toBe('Copying the lab files into the VM');
  });

  it('an older agent (no clock) is never treated as stale', () => {
    const a = mergeTaskMetadata(undefined, { phase: 'creating the VM', at: t(10).toISOString() }, IN, t(10)).metadata;
    expect(mergeTaskMetadata(a, { phase: 'seeding the server (10–20 min)' }, IN, t(5)).newStep).toBe('seeding the server (10–20 min)');
  });

  it('ignores a wild agent clock and caps output and timeline size', () => {
    const m = mergeTaskMetadata(undefined, { phase: 'x', at: '1999-01-01T00:00:00Z', output: 'o'.repeat(10_000) }, IN, t(1)).metadata;
    expect(m.activity[0].at).toBe(t(1).toISOString());
    expect(m.output).toHaveLength(4000);
    let big: any = undefined;
    for (let i = 0; i < 250; i++) big = mergeTaskMetadata(big, { phase: `s${i}` }, IN, t(i)).metadata;
    expect(big.activity).toHaveLength(200);
    expect(big.activity[199].step).toBe('s249');
  });
});
