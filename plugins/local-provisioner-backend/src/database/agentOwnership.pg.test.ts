import knexFactory, { Knex } from 'knex';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { ConfigReader } from '@backstage/config';
import { TaskStore, derivedAgentId } from './TaskStore';
import { AgentService } from '../service/AgentService';
import { TaskQueueService } from '../service/TaskQueueService';
import { createAgentRoutes } from '../api/agentRoutes';
import { TaskStatus, TaskType } from '../types';

/**
 * Who owns an agent and who may report on its tasks, on real Postgres with the real stores and services (audit 2026-11-07):
 *  - `upsertAgent` (the login) must never move an agent row to a different user: the id comes from an unauthenticated request body,
 *    the owner decides who receives the agent's tasks;
 *  - PUT /agent/tasks/:id/status must refuse a task that is not the token holder's.
 *
 * Skipped unless LP_TEST_PG_URL is set (see traineeRemovals.pg.test.ts). Uses its own schema.
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;
const SCHEMA = 'lp_agent_ownership_test';

maybe('agent ownership on real Postgres', () => {
  let db: Knex;
  let store: TaskStore;
  const dir = path.join(__dirname, 'migrations');
  const ALICE = 'alice@example.com';
  const BOB = 'bob@example.com';

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
    await db('agent_registrations').delete();
  });

  const login = (agentId: string, user: string, hostname = 'laptop') => store.upsertAgent(agentId, user, hostname, 'darwin', '25.0 (arm64)', hostname, '0.1.30');
  const row = (agentId: string) => db('agent_registrations').where({ agent_id: agentId }).first();

  describe('upsertAgent (the login)', () => {
    it('a user reconnecting to their own agent updates it in place', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const again = await login('agent-laptop-aaaa1111', ALICE);
      expect(again.reconnected).toBe(true);
      expect(again.separatedFromUser).toBeUndefined();
      expect(again.agent.agent_id).toBe('agent-laptop-aaaa1111');
      expect(await db('agent_registrations').count({ n: '*' }).first()).toEqual({ n: '1' });
    });

    it('presenting ANOTHER user\'s agent id does not move the agent: the owner keeps it, the caller gets their own', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const before = await row('agent-laptop-aaaa1111');

      const bob = await login('agent-laptop-aaaa1111', BOB);

      expect(bob.separatedFromUser).toBe(ALICE);
      expect(bob.agent.user_id).toBe(BOB);
      expect(bob.agent.agent_id).toBe(derivedAgentId('agent-laptop-aaaa1111', BOB));
      expect(bob.agent.agent_id).not.toBe('agent-laptop-aaaa1111');
      const after = await row('agent-laptop-aaaa1111');
      expect(after.user_id).toBe(ALICE);
      expect(after.last_seen).toEqual(before.last_seen); // not even touched
      expect(await db('agent_registrations').count({ n: '*' }).first()).toEqual({ n: '2' });
    });

    it('the second user logging in again finds their own registration, and the first user is unaffected', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const first = await login('agent-laptop-aaaa1111', BOB);
      const second = await login('agent-laptop-aaaa1111', BOB);
      expect(second.reconnected).toBe(true);
      expect(second.agent.agent_id).toBe(first.agent.agent_id);
      const alice = await login('agent-laptop-aaaa1111', ALICE);
      expect(alice.agent.agent_id).toBe('agent-laptop-aaaa1111');
      expect(await db('agent_registrations').count({ n: '*' }).first()).toEqual({ n: '2' });
    });

    it('the owner\'s tasks are still the owner\'s agent\'s after the other user logged in', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const t = await store.createTask(ALICE, { agent_id: 'agent-laptop-aaaa1111', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', config: {} });
      await login('agent-laptop-aaaa1111', BOB);
      const pendingForAlice = await store.getPendingTasksForAgent('agent-laptop-aaaa1111');
      const pendingForBob = await store.getPendingTasksForAgent(derivedAgentId('agent-laptop-aaaa1111', BOB));
      expect(pendingForAlice.map(x => x.task_id)).toEqual([t.task_id]);
      expect(pendingForBob).toEqual([]);
    });

    it('user ids that differ only in case are the same person', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const again = await login('agent-laptop-aaaa1111', 'Alice@Example.com');
      expect(again.separatedFromUser).toBeUndefined();
      expect(again.agent.agent_id).toBe('agent-laptop-aaaa1111');
    });

    it('keeps the machine-id rename for the SAME user (the interface that supplies the MAC changed)', async () => {
      await login('agent-laptop-OLDOLD11', ALICE);
      const renamed = await login('agent-laptop-NEWNEW22', ALICE);
      expect(renamed.reconnected).toBe(true);
      expect(renamed.agent.agent_id).toBe('agent-laptop-NEWNEW22');
      expect(await row('agent-laptop-OLDOLD11')).toBeUndefined();
      expect(await db('agent_registrations').count({ n: '*' }).first()).toEqual({ n: '1' });
    });

    it('a second user with a renamed machine id keeps their derived row instead of colliding or stealing', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const bob1 = await login('agent-laptop-aaaa1111', BOB);
      // The same machine now reports a different id that belongs to nobody: Bob's row (found through hostname+user) is renamed.
      const bob2 = await login('agent-laptop-bbbb2222', BOB);
      expect(bob2.agent.user_id).toBe(BOB);
      expect(bob2.reconnected).toBe(true);
      expect(bob2.agent.agent_id).toBe('agent-laptop-bbbb2222');
      expect(bob1.agent.agent_id).not.toBe(bob2.agent.agent_id);
      expect((await row('agent-laptop-aaaa1111')).user_id).toBe(ALICE);
    });

    it('someone registering the derived id in advance cannot block the victim\'s login (computable from public facts)', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      // Mallory presents exactly the id Bob will be given, as if it were her own machine.
      await login(derivedAgentId('agent-laptop-aaaa1111', BOB), 'mallory@example.com', 'mallorys-machine');
      const bob = await login('agent-laptop-aaaa1111', BOB);
      expect(bob.agent.user_id).toBe(BOB);
      expect(bob.agent.agent_id).not.toBe(derivedAgentId('agent-laptop-aaaa1111', BOB)); // that id is Mallory's
      expect((await row(derivedAgentId('agent-laptop-aaaa1111', BOB))).user_id).toBe('mallory@example.com');
      // Bob's next login finds his own row (through hostname+user) and keeps its id; Alice is untouched.
      const again = await login('agent-laptop-aaaa1111', BOB);
      expect(again.reconnected).toBe(true);
      expect(again.agent.agent_id).toBe(bob.agent.agent_id);
      expect((await row('agent-laptop-aaaa1111')).user_id).toBe(ALICE);
    });

    it('two users on two laptops with the same hostname are unaffected', async () => {
      await login('agent-macbook-1111aaaa', ALICE, 'macbook');
      const bob = await login('agent-macbook-2222bbbb', BOB, 'macbook');
      expect(bob.separatedFromUser).toBeUndefined();
      expect(bob.agent.agent_id).toBe('agent-macbook-2222bbbb');
    });
  });

  describe('findProvisionTaskByRepoUrl (which lab is a capstone repo\'s)', () => {
    const REPO = 'https://github.com/example-org/python-capstone-a-alice-20261107-0900';
    const provision = (user: string, agent: string, repoUrl: string, name: string) =>
      store.createTask(user, { agent_id: agent, task_type: TaskType.PROVISION_TRAINING, resource_name: name, config: { labId: 'x', githubRepoUrl: repoUrl } });

    it('finds the lab of the enrolled trainee and never a task of someone else that names the same repository', async () => {
      const alices = await provision(ALICE, 'agent-alice', REPO, 'alice-lab');
      await new Promise(r => setTimeout(r, 15));
      const bobs = await provision(BOB, 'agent-bob', REPO, 'bob-fake-lab'); // newer, owned by Bob, names Alice's repo
      expect((await store.findProvisionTaskByRepoUrl(REPO, ALICE))?.task_id).toBe(alices.task_id);
      expect((await store.findProvisionTaskByRepoUrl(REPO, BOB))?.task_id).toBe(bobs.task_id); // Bob's own task is Bob's, not Alice's
      expect((await store.findProvisionTaskByRepoUrl(REPO, 'carol@example.com'))).toBeUndefined();
    });

    it('does not give Alice\'s enrollment a lab when only Bob has a task naming her repository', async () => {
      await provision(BOB, 'agent-bob', REPO, 'bob-fake-lab');
      expect(await store.findProvisionTaskByRepoUrl(REPO, ALICE)).toBeUndefined();
    });

    it('matches the repository the way it always did (.git, trailing slash, case) and the owner without regard to case', async () => {
      const alices = await provision(ALICE, 'agent-alice', `${REPO}.git`, 'alice-lab');
      expect((await store.findProvisionTaskByRepoUrl(`${REPO.toUpperCase()}/`, 'Alice@Example.com'))?.task_id).toBe(alices.task_id);
    });
  });

  describe('PUT /agent/tasks/:taskId/status', () => {
    let server: http.Server;
    let base: string;
    let service: AgentService;
    const tokenFor = (user: string) => (service as any).generateServiceToken(user) as string;

    beforeAll(async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() } as any;
      const queue = new TaskQueueService(logger, store);
      const config = new ConfigReader({ backend: { auth: { keys: [{ secret: 'test-secret-for-agent-tokens-0123456789' }] } } });
      service = new AgentService(logger, store, queue, config, 25, 600);
      const app = express();
      app.use(express.json());
      app.use('/agent', createAgentRoutes(service, logger, undefined, { get: async () => undefined } as any));
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    });

    const put = (taskId: string, user: string, body: any) =>
      fetch(`${base}/agent/tasks/${taskId}/status`, { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenFor(user)}` }, body: JSON.stringify(body) });
    const status = async (id: string) => (await db('provisioning_tasks').where({ task_id: id }).first()).status;

    it('the owner reports on their task; another user cannot touch it, and the row stays exactly as it was', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const t = await store.createTask(ALICE, { agent_id: 'agent-laptop-aaaa1111', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', config: {} });

      const forged = await put(t.task_id, BOB, { status: 'failed', error: 'forged', logs: 'forged logs' });
      expect(forged.status).toBe(404);
      const untouched = await db('provisioning_tasks').where({ task_id: t.task_id }).first();
      expect(untouched.status).toBe(TaskStatus.PENDING);
      expect(untouched.error_message).toBeNull();
      expect(untouched.logs).toBeNull();

      const real = await put(t.task_id, ALICE, { status: 'in-progress', metadata: { phase: 'Starting' } });
      expect(real.status).toBe(200);
      expect(await status(t.task_id)).toBe(TaskStatus.IN_PROGRESS);
    });

    it('a user who took the login route for someone else\'s agent id gets no power over that agent\'s tasks', async () => {
      await login('agent-laptop-aaaa1111', ALICE);
      const t = await store.createTask(ALICE, { agent_id: 'agent-laptop-aaaa1111', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', config: {} });
      await login('agent-laptop-aaaa1111', BOB); // Bob "logs in" presenting Alice's agent id
      expect((await put(t.task_id, BOB, { status: 'completed' })).status).toBe(404);
      expect(await status(t.task_id)).toBe(TaskStatus.PENDING);
    });

    it('an interrupted-task report still lands after the owner\'s agent id was renamed (the task keeps the old id)', async () => {
      await login('agent-laptop-OLDOLD11', ALICE);
      const t = await store.createTask(ALICE, { agent_id: 'agent-laptop-OLDOLD11', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', config: {} });
      await login('agent-laptop-NEWNEW22', ALICE); // renames the row; the task still names the old id
      expect((await put(t.task_id, ALICE, { status: 'failed', error: 'The agent stopped while this was running' })).status).toBe(200);
      expect(await status(t.task_id)).toBe(TaskStatus.FAILED);
      // ...and still not for anyone else
      const u = await store.createTask(ALICE, { agent_id: 'agent-laptop-OLDOLD11', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab2', config: {} });
      expect((await put(u.task_id, BOB, { status: 'completed' })).status).toBe(404);
      expect(await status(u.task_id)).toBe(TaskStatus.PENDING);
    });

    it('an agent id vacated by a rename cannot be claimed by another user to receive the old owner\'s pending tasks', async () => {
      // Alice's row is renamed OLD -> NEW by the hostname fallback; her pending task keeps agent_id OLD.
      await login('agent-laptop-OLDOLD11', ALICE);
      const t = await store.createTask(ALICE, { agent_id: 'agent-laptop-OLDOLD11', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', config: {} });
      await login('agent-laptop-NEWNEW22', ALICE);
      // Bob presents the vacated id: nobody owns it any more, so he gets an agent registered under exactly that id.
      const bob = await login('agent-laptop-OLDOLD11', BOB, 'bobs-machine');
      expect(bob.agent.agent_id).toBe('agent-laptop-OLDOLD11');
      // ...but he is delivered nothing of Alice's, and cannot report on it either.
      const giveUp = new AbortController(); // an empty poll waits for work; stop waiting once it has had its chance to answer
      setTimeout(() => giveUp.abort(), 400);
      const polled = await service.longPoll('agent-laptop-OLDOLD11', BOB, giveUp.signal);
      expect(polled.tasks).toEqual([]);
      expect((await put(t.task_id, BOB, { status: 'failed', error: 'forged' })).status).toBe(404);
      expect(await status(t.task_id)).toBe(TaskStatus.PENDING);
      // Bob's own task on that agent is delivered to him.
      const mine = await store.createTask(BOB, { agent_id: 'agent-laptop-OLDOLD11', task_type: TaskType.PROVISION_TRAINING, resource_name: 'bobs-lab', config: {} });
      expect((await service.longPoll('agent-laptop-OLDOLD11', BOB)).tasks.map(x => x.task_id)).toEqual([mine.task_id]);
    });

    it('an unknown but well-formed id and a malformed id are both 404, never a 500', async () => {
      expect((await put('99999999-9999-4999-8999-999999999999', ALICE, { status: 'completed' })).status).toBe(404);
      expect((await put('not-a-uuid', ALICE, { status: 'completed' })).status).toBe(404);
    });
  });
});
