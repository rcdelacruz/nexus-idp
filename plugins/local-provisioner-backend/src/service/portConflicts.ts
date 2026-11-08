/**
 * Which of a user's other labs hold the ports a task needs.
 *
 * Lab templates publish fixed host ports (both Terraform capstones use 4566), and a port can be held
 * by one container only. When a lab fails because another of the user's labs holds a port, Retry
 * offers to remove that lab first. This module answers "which labs", from the compose files the
 * portal already stores, so it works for every lab type.
 */
import { publishedHostPorts } from '../util/composePorts';
import { vmInstanceName } from '../util/vmInstanceName';
import { ProvisioningTask, Resource, ResourceState, TaskStatus, isProvisionTask } from '../types';

export interface LabConflict {
  resource_name: string;
  resource_type?: string;
  state: ResourceState.RUNNING;
  /** The contested ports (the ones this task needs and this lab holds). */
  ports: number[];
  /** The lab's provision task: what a teardown (`deprovision`) targets. */
  provision_task_id: string;
}

export interface LabsSource {
  getLabsForAgent(agentId: string): Promise<{ resource: Resource; provision: ProvisioningTask; provisions?: ProvisioningTask[] }[]>;
}

/**
 * Only a lab that is up holds its ports. Stopped, failed and removed labs hold none. A lab with a
 * task still open (`provisioning` covers any pending or in-progress task: being set up, being
 * removed, restarting) is left out: removing it now would race that task on the agent, which runs
 * tasks side by side.
 */
const HOLDING = ResourceState.RUNNING;

const isVmLab = (t: ProvisioningTask) => (t.config as any)?.executor === 'multipass';

/** The compose file a retried provision runs, and the lab it belongs to. */
function composeOf(task: ProvisioningTask): { compose: unknown; ownResource: string } | undefined {
  return isProvisionTask(task.task_type) ? { compose: task.config?.dockerCompose, ownResource: task.resource_name } : undefined;
}

/**
 * The fixed host ports a lab's compose file publishes. The reported connection details are not
 * used: they list every published port of every protocol, and a dynamic host port (Docker's pick)
 * cannot collide with a fixed one in practice.
 */
function heldPorts(lab: { provision: ProvisioningTask }): Set<number> {
  return new Set<number>(publishedHostPorts(lab.provision.config?.dockerCompose));
}

/** The user's other running labs on the task's agent that hold a port the task needs. */
export async function findPortConflicts(task: ProvisioningTask, userId: string, source: LabsSource): Promise<LabConflict[]> {
  const own = composeOf(task);
  if (!own) return [];
  const wanted = publishedHostPorts(own.compose);
  if (wanted.length === 0) return [];

  const conflicts: LabConflict[] = [];
  for (const lab of await source.getLabsForAgent(task.agent_id)) {
    const { resource, provision } = lab;
    if (resource.resource_name === own.ownResource) continue;
    if (resource.user_id !== userId || resource.state !== HOLDING || isVmLab(provision)) continue;
    const held = heldPorts(lab);
    const ports = wanted.filter(p => held.has(p));
    if (ports.length === 0) continue;
    conflicts.push({
      resource_name: resource.resource_name,
      resource_type: resource.resource_type,
      state: ResourceState.RUNNING,
      ports,
      provision_task_id: provision.task_id,
    });
  }
  return conflicts;
}

/** A half-made lab left on the user's machine by a failed attempt of this same lab. */
export interface Leftover {
  resource_name: string;
  /** The task whose folder holds the leftover: what a teardown (`deprovision`) targets. */
  provision_task_id: string;
}

const CREATING_THE_VM = 'Creating the VM';
/** The steps the AGENT reported for an attempt: the portal adds its own closing "failed" / "completed" marker, which says nothing about how far the agent got. */
const steps = (t: ProvisioningTask): string[] =>
  Array.isArray((t.metadata as any)?.activity)
    ? (t.metadata as any).activity.map((e: any) => e?.step).filter((x: unknown) => typeof x === 'string' && x !== 'failed' && x !== 'completed')
    : [];

/**
 * Retrying a failed VM lab: the failed attempt may have created the VM before a later step failed
 * (agents up to 0.1.30 leave it running), and the retry would then stop at "instance already
 * exists". The teardown that removes it is only offered when nothing else could own that VM:
 *  - the lab is in error and its latest provision FAILED, no provision of it ever completed and none
 *    is still open (a running lab, a lab whose latest provision completed, one with a teardown or a
 *    retry already open, is never offered, so a stale Retry on an old failed row can't remove a
 *    working VM);
 *  - no other lab on the agent derives the same VM name (names over 63 characters are cut, so two
 *    labs can share one);
 *  - the task it targets is the latest attempt that reached "Creating the VM", the only kind whose
 *    folder holds the VM's record; when the agent reported no steps at all (old agents) the latest
 *    attempt is used; when it did and none got that far, no VM was created and nothing is offered.
 */
export async function findLeftover(task: ProvisioningTask, userId: string, source: LabsSource): Promise<Leftover | undefined> {
  if (!isProvisionTask(task.task_type) || !isVmLab(task)) return undefined;
  const labs = await source.getLabsForAgent(task.agent_id);
  const lab = labs.find(l => l.resource.resource_name === task.resource_name);
  if (!lab || lab.resource.user_id !== userId) return undefined;
  if (lab.resource.state !== ResourceState.ERROR || lab.provision.status !== TaskStatus.FAILED) return undefined;

  const attempts = lab.provisions ?? [lab.provision];
  if (attempts.some(a => a.status === TaskStatus.COMPLETED || a.status === TaskStatus.PENDING || a.status === TaskStatus.IN_PROGRESS)) {
    return undefined;
  }
  const name = vmInstanceName(task.resource_name);
  if (labs.some(l => l !== lab && vmInstanceName(l.resource.resource_name) === name)) return undefined;

  const reached = [...attempts].reverse().find(a => steps(a).includes(CREATING_THE_VM));
  const reportedAnySteps = attempts.some(a => steps(a).length > 0);
  const target = reached ?? (reportedAnySteps ? undefined : lab.provision);
  return target ? { resource_name: lab.resource.resource_name, provision_task_id: target.task_id } : undefined;
}
