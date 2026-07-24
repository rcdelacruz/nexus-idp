/**
 * Tests for foldTasksToResource — the logic that derives a resource's current lifecycle state
 * from its task history. This drives what the catalog EntityProvider emits and what the UI shows,
 * so the state transitions must be exactly right (a stale "running" would show a torn-down
 * resource in the catalog).
 */

import { foldTasksToResource } from './TaskStore';
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
});
