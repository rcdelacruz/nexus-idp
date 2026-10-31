import test from 'node:test';
import assert from 'node:assert/strict';
import { executorFor } from './resources';

test('offline commands route a VM lab to Multipass and everything else to Docker, like the daemon', () => {
  const vm = { isVmTask: (id: string) => id === 'vm-task' } as any;
  const docker = {} as any;
  assert.deepEqual(executorFor('vm-task', vm, docker), { kind: 'vm', executor: vm });
  assert.deepEqual(executorFor('compose-task', vm, docker), { kind: 'docker', executor: docker });
});
