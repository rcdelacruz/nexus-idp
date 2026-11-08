import { describeConflicts, removeConflictsThenRetry, removeLeftoverThenRetry, waitForCompletion } from './retryWithReplacement';
import { LabConflict, ProvisioningTask } from './types';

const task = (over: Partial<ProvisioningTask> = {}): ProvisioningTask => ({
  id: 't1',
  agentId: 'agent-mac',
  userId: 'ron@example.com',
  taskType: 'provision-training',
  resourceName: 'terraform-capstone-a-ron',
  config: {},
  status: 'failed',
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
  ...over,
});

const conflict = (name: string, ports = [4566]): LabConflict => ({ resourceName: name, state: 'running', ports, provisionTaskId: `prov-${name}` });

describe('waitForCompletion', () => {
  const fast = (clock = { t: 0 }) => ({ intervalMs: 1000, timeoutMs: 10_000, sleep: async (ms: number) => void (clock.t += ms), now: () => clock.t });

  it('returns when the task completes, polling until then', async () => {
    const states = ['pending', 'in-progress', 'in-progress', 'completed'] as const;
    const getTask = jest.fn(async () => task({ status: states[Math.min(getTask.mock.calls.length - 1, 3)] }));
    const done = await waitForCompletion(getTask, 'rm-1', fast());
    expect(done.status).toBe('completed');
    expect(getTask).toHaveBeenCalledTimes(4);
  });

  it('throws with the agent\'s own error when the task fails', async () => {
    const getTask = async () => task({ status: 'failed', errorMessage: 'docker compose down exited with code 1' });
    await expect(waitForCompletion(getTask, 'rm-1', fast())).rejects.toThrow('docker compose down exited with code 1');
  });

  it('gives up after the timeout', async () => {
    const getTask = async () => task({ status: 'in-progress' });
    await expect(waitForCompletion(getTask, 'rm-1', fast())).rejects.toThrow(/did not finish within 10 seconds \(the task stays queued/);
  });

  it('survives a couple of failed reads but not a dead connection', async () => {
    let n = 0;
    const flaky = async () => {
      n += 1;
      if (n <= 2) throw new Error('network');
      return task({ status: 'completed' });
    };
    await expect(waitForCompletion(flaky, 'rm-1', fast())).resolves.toMatchObject({ status: 'completed' });
    const dead = async () => {
      throw new Error('network');
    };
    await expect(waitForCompletion(dead, 'rm-1', fast())).rejects.toThrow('network');
  });
});

describe('removeConflictsThenRetry', () => {
  function fakeApi(opts: { failRemoval?: string; current?: LabConflict[] | Error; failRetry?: boolean; confirmed?: LabConflict[] } = {}) {
    const calls: string[] = [];
    return {
      calls,
      api: {
        getRetryConflicts: async (id: string) => {
          calls.push(`recheck ${id}`);
          if (opts.current instanceof Error) throw opts.current;
          return opts.current ?? opts.confirmed ?? [];
        },
        removeLab: async (agentId: string, c: LabConflict) => {
          calls.push(`remove ${c.resourceName} on ${agentId} -> ${c.provisionTaskId}`);
          return task({ id: `rm-${c.resourceName}`, status: 'pending' });
        },
        waitForTask: async (id: string) => {
          calls.push(`wait ${id}`);
          await new Promise(resolve => setTimeout(resolve, 5)); // the teardown takes a moment
          if (opts.failRemoval && id === `rm-${opts.failRemoval}`) throw new Error('docker compose down exited with code 1');
          calls.push(`done ${id}`);
          return task({ id, status: 'completed' });
        },
        retryTask: async (t: ProvisioningTask) => {
          calls.push(`retry ${t.resourceName}`);
          if (opts.failRetry) throw new Error('Agent offline');
          return task({ id: 'new-task', status: 'pending' });
        },
      },
    };
  }
  const A = conflict('lab-a');
  const B = conflict('lab-b', [8090]);

  it('asks again, finishes every removal before it retries, in order', async () => {
    const { api, calls } = fakeApi({ confirmed: [A, B] });
    const reports: string[] = [];
    const created = await removeConflictsThenRetry(api, task(), [A, B], m => reports.push(m));
    expect(created.id).toBe('new-task');
    expect(calls).toEqual([
      'recheck t1',
      'remove lab-a on agent-mac -> prov-lab-a',
      'wait rm-lab-a',
      'done rm-lab-a',
      'remove lab-b on agent-mac -> prov-lab-b',
      'wait rm-lab-b',
      'done rm-lab-b',
      'retry terraform-capstone-a-ron',
    ]);
    expect(reports).toEqual(['Checking again…', 'Removing "lab-a"…', 'Removing "lab-b"…', 'Retrying "terraform-capstone-a-ron"…']);
  });

  it('skips a lab that is already gone, and retries straight away when none is left', async () => {
    const { api, calls } = fakeApi({ current: [B] });
    await removeConflictsThenRetry(api, task(), [A, B]);
    expect(calls).toEqual(['recheck t1', 'remove lab-b on agent-mac -> prov-lab-b', 'wait rm-lab-b', 'done rm-lab-b', 'retry terraform-capstone-a-ron']);

    const none = fakeApi({ current: [] });
    await removeConflictsThenRetry(none.api, task(), [A]);
    expect(none.calls).toEqual(['recheck t1', 'retry terraform-capstone-a-ron']);
  });

  it('removes nothing, and says so, when a lab the user has not seen now holds the port', async () => {
    const { api, calls } = fakeApi({ current: [A, conflict('surprise')] });
    await expect(removeConflictsThenRetry(api, task(), [A])).rejects.toThrow(
      '"surprise" also uses the port now. Nothing was removed; press Retry again to review.',
    );
    expect(calls).toEqual(['recheck t1']);
  });

  it('removes nothing when it cannot check again', async () => {
    const { api, calls } = fakeApi({ current: new Error('503') });
    await expect(removeConflictsThenRetry(api, task(), [A])).rejects.toThrow('Could not check again before removing anything, so nothing was removed: 503');
    expect(calls).toEqual(['recheck t1']);
  });

  it('does not retry when a removal fails; names the lab, what to do, and any lab already removed', async () => {
    const { api, calls } = fakeApi({ failRemoval: 'lab-b', confirmed: [A, B] });
    await expect(removeConflictsThenRetry(api, task(), [A, B])).rejects.toThrow(
      'Could not remove "lab-b": docker compose down exited with code 1. It may still be using the port: stop it in Docker Desktop, then press Retry again. Already removed: "lab-a".',
    );
    expect(calls).not.toContain('retry terraform-capstone-a-ron');
  });

  it('says the old lab is already gone when the retry itself cannot be queued', async () => {
    const { api } = fakeApi({ failRetry: true, confirmed: [A] });
    await expect(removeConflictsThenRetry(api, task(), [A])).rejects.toThrow('Removed "lab-a", but the retry could not be queued: Agent offline. Press Retry again.');
  });
});

describe('removeLeftoverThenRetry (the unfinished VM of a failed VM lab)', () => {
  const leftover = { resourceName: 'linux-capstone-a-ron', provisionTaskId: 'latest-failed' };
  function fake(opts: { failRemoval?: boolean; failRetry?: boolean } = {}) {
    const calls: string[] = [];
    return {
      calls,
      api: {
        removeLab: async (agentId: string, t: { resourceName: string; provisionTaskId: string }) => {
          calls.push(`remove ${t.resourceName} on ${agentId} -> ${t.provisionTaskId}`);
          return task({ id: 'rm-1', status: 'pending' });
        },
        waitForTask: async (id: string) => {
          calls.push(`wait ${id}`);
          await new Promise(resolve => setTimeout(resolve, 5));
          if (opts.failRemoval) throw new Error('multipass delete failed: daemon busy');
          calls.push(`done ${id}`);
          return task({ id, status: 'completed' });
        },
        retryTask: async (t: ProvisioningTask) => {
          calls.push(`retry ${t.resourceName}`);
          if (opts.failRetry) throw new Error('Agent offline');
          return task({ id: 'new-task', status: 'pending' });
        },
      },
    };
  }

  it('removes the unfinished VM through its latest provision task, waits for it, then retries', async () => {
    const { api, calls } = fake();
    const reports: string[] = [];
    const created = await removeLeftoverThenRetry(api, task({ resourceName: 'linux-capstone-a-ron' }), leftover, m => reports.push(m));
    expect(created.id).toBe('new-task');
    expect(calls).toEqual(['remove linux-capstone-a-ron on agent-mac -> latest-failed', 'wait rm-1', 'done rm-1', 'retry linux-capstone-a-ron']);
    expect(reports).toEqual(['Removing the unfinished VM from the failed attempt…', 'Retrying "linux-capstone-a-ron"…']);
  });

  it('does not retry when the removal fails, and says how to remove the VM by hand', async () => {
    const { api, calls } = fake({ failRemoval: true });
    await expect(removeLeftoverThenRetry(api, task(), leftover)).rejects.toThrow(
      'Could not remove the unfinished VM of "linux-capstone-a-ron": multipass delete failed: daemon busy. It may still be on your machine: remove it with Multipass (multipass list, then multipass delete --purge <name>), then press Retry again.',
    );
    expect(calls.some(c => c.startsWith('retry'))).toBe(false);
  });

  it('says the VM is already gone when the retry itself cannot be queued', async () => {
    const { api } = fake({ failRetry: true });
    await expect(removeLeftoverThenRetry(api, task(), leftover)).rejects.toThrow('The unfinished VM was removed, but the retry could not be queued: Agent offline. Press Retry again.');
  });
});

describe('describeConflicts', () => {
  it('names the lab and the port, and says what is deleted', () => {
    const text = describeConflicts(task(), [conflict('terraform-capstone-ron-20261031-0005')]);
    expect(text).toContain('"terraform-capstone-a-ron" needs a port that another lab is using');
    expect(text).toContain('"terraform-capstone-ron-20261031-0005" (port 4566)');
    expect(text).toContain('containers and data volumes are deleted');
  });

  it('reads right for several labs', () => {
    const text = describeConflicts(task(), [conflict('lab-a'), conflict('lab-b', [8090, 9000])]);
    expect(text).toContain('needs ports that other labs are using');
    expect(text).toContain('"lab-a" (port 4566), "lab-b" (ports 8090, 9000)');
  });
});
