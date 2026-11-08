import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { TaskStore } from './TaskStore';
import { findLeftover, findPortConflicts } from '../service/portConflicts';
import { TaskStatus, TaskType } from '../types';

/**
 * Real-Postgres check of "which of my other labs hold the ports this one needs": real tasks in
 * the real table, folded by the real TaskStore, then the real conflict finder.
 *
 * Skipped unless LP_TEST_PG_URL is set (see traineeRemovals.pg.test.ts). Uses its own schema so it
 * can run next to the other Postgres test files, which each reset theirs.
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;
const SCHEMA = 'lp_port_conflicts_test';

const compose = (...ports: string[]) =>
  `services:\n  ministack:\n    image: busybox\n    ports:\n${ports.map(p => `      - "${p}"`).join('\n')}\n`;

maybe('port conflicts on real Postgres', () => {
  let db: Knex;
  let store: TaskStore;
  const dir = path.join(__dirname, 'migrations');
  const ME = 'ronald@example.com';

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

  const source = () => ({ getLabsForAgent: (id: string) => store.getLabsForAgent(id) });

  async function lab(name: string, opts: { user?: string; agent?: string; ports?: string[]; end?: 'running' | 'stopped' | 'removed' | 'failed' | 'provisioning' }) {
    const user = opts.user ?? ME;
    const agent = opts.agent ?? 'agent-mac';
    const t = await store.createTask(user, {
      agent_id: agent,
      task_type: TaskType.PROVISION_TRAINING,
      resource_name: name,
      config: { labId: 'terraform-capstone', dockerCompose: compose(...(opts.ports ?? ['127.0.0.1:4566:4566'])) },
    });
    const end = opts.end ?? 'running';
    if (end === 'provisioning') return t;
    if (end === 'failed') {
      await store.updateTaskStatus(t.task_id, TaskStatus.FAILED, undefined, 'Port 4566 is already in use');
      return t;
    }
    // What the agent reports once the containers are up: the host port of each published port.
    const reported = Object.fromEntries((opts.ports ?? ['127.0.0.1:4566:4566']).map((p, i) => [`svc${i}`, Number(p.split(':').slice(-2)[0])]));
    await store.updateTaskStatus(t.task_id, TaskStatus.COMPLETED, undefined, undefined, { connectionDetails: { ports: reported } });
    if (end === 'stopped' || end === 'removed') {
      const stop = await store.createTask(user, { agent_id: agent, task_type: TaskType.STOP, resource_name: name, config: { targetTaskId: t.task_id } });
      await store.updateTaskStatus(stop.task_id, TaskStatus.COMPLETED);
    }
    if (end === 'removed') {
      const rm = await store.createTask(user, { agent_id: agent, task_type: TaskType.DEPROVISION, resource_name: name, config: { targetTaskId: t.task_id } });
      await store.updateTaskStatus(rm.task_id, TaskStatus.COMPLETED);
    }
    return t;
  }

  it("finds the running lab in the way, and only labs that hold the port now", async () => {
    const holder = await lab('terraform-capstone-ronald-20261031-0005', { end: 'running' });
    await lab('stopped-lab', { end: 'stopped' });
    await lab('removed-lab', { end: 'removed' });
    await lab('someone-elses', { user: 'someone@example.com', end: 'running' });
    await lab('other-machine', { agent: 'agent-other', end: 'running' });
    await lab('other-ports', { ports: ['127.0.0.1:5432:5432'], end: 'running' });
    const failedNew = await lab('terraform-capstone-a-ronald-20261103-0739', { end: 'failed' });

    const found = await findPortConflicts((await store.getTaskById(failedNew.task_id))!, ME, source());
    expect(found).toEqual([
      {
        resource_name: 'terraform-capstone-ronald-20261031-0005',
        resource_type: 'terraform-capstone',
        state: 'running',
        ports: [4566],
        provision_task_id: holder.task_id,
      },
    ]);
  });

  it('stops offering a lab once its teardown is queued, and after it completes', async () => {
    const failedNew = await store.createTask(ME, {
      agent_id: 'agent-mac',
      task_type: TaskType.PROVISION_TRAINING,
      resource_name: 'second-new-lab',
      config: { labId: 'terraform-capstone', dockerCompose: compose('127.0.0.1:4566:4566') },
    });
    await store.updateTaskStatus(failedNew.task_id, TaskStatus.FAILED, undefined, 'Port 4566 is already in use');
    const task = (await store.getTaskById(failedNew.task_id))!;
    const before = await findPortConflicts(task, ME, source());
    expect(before.map(c => c.resource_name)).toEqual(['terraform-capstone-ronald-20261031-0005']);

    const rm = await store.createTask(ME, {
      agent_id: 'agent-mac',
      task_type: TaskType.DEPROVISION,
      resource_name: 'terraform-capstone-ronald-20261031-0005',
      config: { targetTaskId: before[0].provision_task_id },
    });
    // A teardown already queued must not be queued again; a completed one has removed the lab.
    expect(await findPortConflicts(task, ME, source())).toEqual([]);
    await store.updateTaskStatus(rm.task_id, TaskStatus.COMPLETED);
    expect(await findPortConflicts(task, ME, source())).toEqual([]);
  });

  it('leaves out a lab that has a task still open: being set up, or already being removed', async () => {
    await lab('coming-up', { ports: ['127.0.0.1:7777:7777'], end: 'provisioning' });
    const beingRemoved = await lab('being-removed', { ports: ['127.0.0.1:7777:7777'], end: 'running' });
    await store.createTask(ME, { agent_id: 'agent-mac', task_type: TaskType.DEPROVISION, resource_name: 'being-removed', config: { targetTaskId: beingRemoved.task_id } });
    const needing = await store.createTask(ME, {
      agent_id: 'agent-mac',
      task_type: TaskType.PROVISION_TRAINING,
      resource_name: 'needs-7777',
      config: { labId: 'x', dockerCompose: compose('127.0.0.1:7777:7777') },
    });
    expect(await findPortConflicts(needing, ME, source())).toEqual([]);
  });

  it('offers a running lab whose latest task is a completed restart', async () => {
    const running = await lab('restarted', { ports: ['127.0.0.1:6666:6666'], end: 'running' });
    const restart = await store.createTask(ME, { agent_id: 'agent-mac', task_type: TaskType.RESTART, resource_name: 'restarted', config: { targetTaskId: running.task_id } });
    await store.updateTaskStatus(restart.task_id, TaskStatus.COMPLETED);
    const needing = await store.createTask(ME, {
      agent_id: 'agent-mac',
      task_type: TaskType.PROVISION_TRAINING,
      resource_name: 'needs-6666',
      config: { labId: 'x', dockerCompose: compose('127.0.0.1:6666:6666') },
    });
    const found = await findPortConflicts(needing, ME, source());
    expect(found.map(c => [c.resource_name, c.provision_task_id])).toEqual([['restarted', running.task_id]]);
  });

  describe('the half-made VM of a failed VM lab', () => {
    const vm = { labId: 'linux-capstone-a', executor: 'multipass', vm: {} };
    const make = (name: string, user = ME) => store.createTask(user, { agent_id: 'agent-vm', task_type: TaskType.PROVISION_TRAINING, resource_name: name, config: vm });
    const fail = (id: string) => store.updateTaskStatus(id, TaskStatus.FAILED, undefined, 'Copying the lab files into the VM failed');
    const done = (id: string) => store.updateTaskStatus(id, TaskStatus.COMPLETED);
    const leftoverOf = async (t: { task_id: string }) => findLeftover((await store.getTaskById(t.task_id))!, ME, source());

    it('is the latest failed attempt; a retry that also failed moves it; a retry that worked clears it', async () => {
      const first = await make('linux-lab-1');
      await fail(first.task_id);
      expect(await leftoverOf(first)).toEqual({ resource_name: 'linux-lab-1', provision_task_id: first.task_id });

      const second = await make('linux-lab-1'); // the Retry
      await fail(second.task_id);
      expect((await leftoverOf(first))?.provision_task_id).toBe(second.task_id);

      const third = await make('linux-lab-1');
      await done(third.task_id);
      expect(await leftoverOf(first)).toBeUndefined(); // the lab is running now: an old failed row must not remove it
    });

    it('is not offered when the lab was running and only a later restart failed', async () => {
      const t = await make('linux-lab-2');
      await done(t.task_id);
      const restart = await store.createTask(ME, { agent_id: 'agent-vm', task_type: TaskType.RESTART, resource_name: 'linux-lab-2', config: { targetTaskId: t.task_id } });
      await fail(restart.task_id);
      const oldFailed = await make('linux-lab-2-other');
      await fail(oldFailed.task_id);
      expect(await findLeftover({ ...(await store.getTaskById(t.task_id))!, status: TaskStatus.FAILED }, ME, source())).toBeUndefined();
    });

    it('targets the latest attempt that reached "Creating the VM", and never a lab that came up once', async () => {
      const reach = (id: string) => store.updateTaskStatus(id, TaskStatus.IN_PROGRESS, { phase: 'Creating the VM' });
      const a = await make('linux-lab-4');
      await reach(a.task_id);
      await fail(a.task_id);
      const b = await make('linux-lab-4'); // a retry that failed before it created anything
      await store.updateTaskStatus(b.task_id, TaskStatus.IN_PROGRESS, { phase: 'Checking Multipass' });
      await fail(b.task_id);
      expect((await leftoverOf(b))?.provision_task_id).toBe(a.task_id);

      const c = await make('linux-lab-4');
      await reach(c.task_id);
      await done(c.task_id);
      const oldRowRetry = await make('linux-lab-4'); // Retry pressed on the old failed row after the lab came up
      await reach(oldRowRetry.task_id);
      await fail(oldRowRetry.task_id);
      expect(await leftoverOf(oldRowRetry)).toBeUndefined();
    });

    it('is gone once the leftover has been removed', async () => {
      const t = await make('linux-lab-3');
      await fail(t.task_id);
      const rm = await store.createTask(ME, { agent_id: 'agent-vm', task_type: TaskType.DEPROVISION, resource_name: 'linux-lab-3', config: { targetTaskId: t.task_id } });
      expect(await leftoverOf(t)).toBeUndefined(); // teardown queued: the lab has a task open
      await done(rm.task_id);
      expect(await leftoverOf(t)).toBeUndefined(); // removed
    });
  });
});
