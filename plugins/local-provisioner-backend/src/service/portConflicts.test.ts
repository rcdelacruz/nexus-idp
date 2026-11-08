import { findLeftover, findPortConflicts, LabsSource } from './portConflicts';
import { ProvisioningTask, Resource, ResourceState, TaskStatus, TaskType } from '../types';

const compose = (...ports: string[]) =>
  `services:\n  ministack:\n    image: busybox\n    ports:\n${ports.map(p => `      - "${p}"`).join('\n')}\n`;

const ME = 'ronald@example.com';
const AGENT = 'agent-mac';

function provision(name: string, config: Record<string, unknown>, extra: Partial<ProvisioningTask> = {}): ProvisioningTask {
  return {
    task_id: `prov-${name}`,
    agent_id: AGENT,
    user_id: ME,
    task_type: TaskType.PROVISION_TRAINING,
    resource_name: name,
    config,
    status: TaskStatus.COMPLETED,
    ...extra,
  } as ProvisioningTask;
}

function lab(name: string, state: ResourceState, config: Record<string, unknown>, extra: Partial<Resource> = {}, task: Partial<ProvisioningTask> = {}) {
  const p = provision(name, config, task);
  return {
    provision: p,
    resource: { resource_name: name, agent_id: AGENT, user_id: p.user_id, state, latest_task_id: p.task_id, ...extra } as Resource,
  };
}

function source(labs: ReturnType<typeof lab>[]): LabsSource {
  return { getLabsForAgent: async () => labs };
}

const newTerraformLab = provision('terraform-capstone-a-ronald', { dockerCompose: compose('127.0.0.1:4566:4566', '127.0.0.1:8090:8080') }, {
  status: TaskStatus.FAILED,
  task_id: 'failed-a',
});

describe('findPortConflicts', () => {
  it('names the running lab that holds a port the task needs', async () => {
    const old = lab('terraform-capstone-ronald-old', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566', '127.0.0.1:8091:8080') }, { resource_type: 'terraform-capstone' });
    expect(await findPortConflicts(newTerraformLab, ME, source([old]))).toEqual([
      {
        resource_name: 'terraform-capstone-ronald-old',
        resource_type: 'terraform-capstone',
        state: ResourceState.RUNNING,
        ports: [4566],
        provision_task_id: 'prov-terraform-capstone-ronald-old',
      },
    ]);
  });

  it('works for any lab type, not only Terraform', async () => {
    const kafka = provision('kafka-ronald-2', { dockerCompose: compose('127.0.0.1:9092:9092') }, { task_id: 'failed-kafka', status: TaskStatus.FAILED });
    const other = lab('kafka-ronald-1', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:9092:9092', '127.0.0.1:2181:2181') });
    expect((await findPortConflicts(kafka, ME, source([other]))).map(c => [c.resource_name, c.ports])).toEqual([['kafka-ronald-1', [9092]]]);
  });

  it('leaves out a lab with a task still open (being set up, removed or restarted): removing it would race that task', async () => {
    const busy = lab('busy-lab', ResourceState.PROVISIONING, { dockerCompose: compose('127.0.0.1:4566:4566') });
    expect(await findPortConflicts(newTerraformLab, ME, source([busy]))).toEqual([]);
  });

  it('ignores labs that do not hold a port: stopped, failed, or on other ports', async () => {
    const labs = [
      lab('stopped-one', ResourceState.STOPPED, { dockerCompose: compose('127.0.0.1:4566:4566') }),
      lab('errored-one', ResourceState.ERROR, { dockerCompose: compose('127.0.0.1:4566:4566') }),
      lab('elsewhere', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:5432:5432') }),
    ];
    expect(await findPortConflicts(newTerraformLab, ME, source(labs))).toEqual([]);
  });

  it('never offers the lab being retried, nor another person\'s lab, nor a VM lab', async () => {
    const labs = [
      lab('terraform-capstone-a-ronald', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566') }),
      lab('colleague-lab', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566') }, {}, { user_id: 'someone@example.com' }),
      lab('vm-lab', ResourceState.RUNNING, { executor: 'multipass', vm: {}, dockerCompose: compose('127.0.0.1:4566:4566') }),
    ];
    expect(await findPortConflicts(newTerraformLab, ME, source(labs))).toEqual([]);
  });

  it('goes by the compose file only: a UDP port the agent reported does not count', async () => {
    const udpOnly = lab('dns-lab', ResourceState.RUNNING, { dockerCompose: 'services:\n  d:\n    image: busybox\n    ports: ["5353:5353/udp"]\n' }, {
      connection_details: { ports: { d: 4566 } },
    });
    expect(await findPortConflicts(newTerraformLab, ME, source([udpOnly]))).toEqual([]);
  });

  it('lists every lab in the way, with only the contested ports', async () => {
    const a = lab('lab-a', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566') });
    const b = lab('lab-b', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:8090:80') });
    const found = await findPortConflicts(newTerraformLab, ME, source([a, b]));
    expect(found.map(c => [c.resource_name, c.ports])).toEqual([['lab-a', [4566]], ['lab-b', [8090]]]);
  });

  it('finds nothing for a task that needs no fixed port or has no compose file', async () => {
    const old = lab('old', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566') });
    expect(await findPortConflicts(provision('x', { dockerCompose: 'services:\n  a:\n    image: busybox\n' }), ME, source([old]))).toEqual([]);
    expect(await findPortConflicts(provision('y', { executor: 'multipass', vm: {} }), ME, source([old]))).toEqual([]);
  });

  it('has nothing to say about other task types', async () => {
    const old = lab('old', ResourceState.RUNNING, { dockerCompose: compose('127.0.0.1:4566:4566') });
    for (const type of [TaskType.STOP, TaskType.START, TaskType.RESTART, TaskType.DEPROVISION, TaskType.RUN_CHECK]) {
      expect(await findPortConflicts(provision('x', { targetTaskId: 'prov-old' }, { task_type: type }), ME, source([old]))).toEqual([]);
    }
  });
});

describe('findLeftover (retrying a failed VM lab)', () => {
  const vm = { executor: 'multipass', vm: {} };
  const failedVm = provision('linux-capstone-a-ronald', vm, { task_id: 'failed-vm', status: TaskStatus.FAILED });
  const failedLab = (over: Partial<Resource> = {}, task: Partial<ProvisioningTask> = {}) =>
    lab('linux-capstone-a-ronald', ResourceState.ERROR, vm, over, { task_id: 'latest-failed', status: TaskStatus.FAILED, ...task });

  it('finds the failed attempt\'s own VM, by the lab\'s latest provision task', async () => {
    expect(await findLeftover(failedVm, ME, source([failedLab()]))).toEqual({ resource_name: 'linux-capstone-a-ronald', provision_task_id: 'latest-failed' });
  });

  it('never offers a lab whose latest provision completed, even if the lab is in error (a later restart failed)', async () => {
    const restartFailed = lab('linux-capstone-a-ronald', ResourceState.ERROR, vm, {}, { task_id: 'healthy', status: TaskStatus.COMPLETED });
    expect(await findLeftover(failedVm, ME, source([restartFailed]))).toBeUndefined();
  });

  it('never offers a lab that is running, stopped or still being set up', async () => {
    for (const state of [ResourceState.RUNNING, ResourceState.STOPPED, ResourceState.PROVISIONING]) {
      const l = lab('linux-capstone-a-ronald', state, vm, {}, { task_id: 'x', status: TaskStatus.COMPLETED });
      expect(await findLeftover(failedVm, ME, source([l]))).toBeUndefined();
    }
  });

  it('does not queue a second teardown: a failed lab whose teardown is already open is not offered', async () => {
    // The lab's latest provision failed, and a deprovision is pending/in progress, so it folds to "provisioning".
    const teardownOpen = lab('linux-capstone-a-ronald', ResourceState.PROVISIONING, vm, {}, { task_id: 'latest-failed', status: TaskStatus.FAILED });
    expect(await findLeftover(failedVm, ME, source([teardownOpen]))).toBeUndefined();
  });

  // The lab's attempts, oldest first, with the steps the agent reported for each.
  const attempt = (id: string, status: TaskStatus, stepNames: string[] = []): ProvisioningTask =>
    provision('linux-capstone-a-ronald', vm, { task_id: id, status, metadata: { activity: stepNames.map(step => ({ at: '2026-11-03T00:00:00Z', step })) } as any });
  const withAttempts = (attempts: ProvisioningTask[]) => ({
    ...lab('linux-capstone-a-ronald', ResourceState.ERROR, vm, {}, { task_id: attempts[attempts.length - 1].task_id, status: TaskStatus.FAILED }),
    provisions: attempts,
  });

  it('never offers a lab that came up at some point: a stale Retry on an old failed row must not remove a working VM', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED, ['Creating the VM']), attempt('ok', TaskStatus.COMPLETED, ['Creating the VM']), attempt('f3', TaskStatus.FAILED, ['Creating the VM'])]);
    expect(await findLeftover(failedVm, ME, source([l]))).toBeUndefined();
  });

  it('never offers a lab with an attempt still open (a retry that is being set up)', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED, ['Creating the VM']), attempt('f2', TaskStatus.IN_PROGRESS, ['Creating the VM']), attempt('f3', TaskStatus.FAILED, [])]);
    expect(await findLeftover(failedVm, ME, source([l]))).toBeUndefined();
  });

  it('never offers a VM name another lab on the agent also derives (names over 63 characters are cut)', async () => {
    const long = 'terraform-capstone-b-maria-theresa-fernandez-dela-cruz-santos';
    const a = lab(`${long}-20261103-1001`, ResourceState.ERROR, vm, {}, { task_id: 'a-failed', status: TaskStatus.FAILED });
    const b = lab(`${long}-20261103-1544`, ResourceState.RUNNING, vm, {}, { task_id: 'b-ok' });
    const task = provision(`${long}-20261103-1001`, vm, { task_id: 'a-failed', status: TaskStatus.FAILED });
    expect(await findLeftover(task, ME, source([a, b]))).toBeUndefined();
    expect(await findLeftover(task, ME, source([a]))).toEqual({ resource_name: `${long}-20261103-1001`, provision_task_id: 'a-failed' });
  });

  it('targets the latest attempt that reached "Creating the VM": only its folder holds the VM\'s record', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED, ['Creating the VM', 'Waiting for the VM to accept connections']), attempt('f2', TaskStatus.FAILED, ['Checking Multipass'])]);
    expect(await findLeftover(failedVm, ME, source([l]))).toEqual({ resource_name: 'linux-capstone-a-ronald', provision_task_id: 'f1' });
  });

  it('offers nothing when the agent reported steps and no attempt got as far as creating a VM', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED, ['Checking Multipass']), attempt('f2', TaskStatus.FAILED, ['Checking Multipass'])]);
    expect(await findLeftover(failedVm, ME, source([l]))).toBeUndefined();
  });

  it('does not count the portal\'s own closing "failed" marker as a step the agent reported', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED, ['failed']), attempt('f2', TaskStatus.FAILED, ['failed'])]);
    expect(await findLeftover(failedVm, ME, source([l]))).toEqual({ resource_name: 'linux-capstone-a-ronald', provision_task_id: 'f2' });
  });

  it('falls back to the latest attempt when the agent reported no steps at all (old agents)', async () => {
    const l = withAttempts([attempt('f1', TaskStatus.FAILED), attempt('f2', TaskStatus.FAILED)]);
    expect(await findLeftover(failedVm, ME, source([l]))).toEqual({ resource_name: 'linux-capstone-a-ronald', provision_task_id: 'f2' });
  });

  it('is only for VM labs, provisions, the caller\'s own lab, and a lab that still exists', async () => {
    const docker = provision('linux-capstone-a-ronald', { dockerCompose: compose('127.0.0.1:4566:4566') }, { status: TaskStatus.FAILED });
    expect(await findLeftover(docker, ME, source([failedLab()]))).toBeUndefined();
    const stop = provision('linux-capstone-a-ronald', vm, { task_type: TaskType.STOP });
    expect(await findLeftover(stop, ME, source([failedLab()]))).toBeUndefined();
    expect(await findLeftover(failedVm, ME, source([failedLab({}, { user_id: 'someone@example.com' })]))).toBeUndefined();
    expect(await findLeftover(failedVm, ME, source([]))).toBeUndefined();
    expect(await findLeftover(failedVm, ME, source([lab('another-lab', ResourceState.ERROR, vm, {}, { status: TaskStatus.FAILED })]))).toBeUndefined();
  });
});
