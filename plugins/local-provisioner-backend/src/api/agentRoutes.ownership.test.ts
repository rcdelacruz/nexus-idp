/**
 * PUT /agent/tasks/:taskId/status is public (agents call it with their service token). The token proves WHO is calling; it must
 * also be that person's task. Audit 2026-11-07: the route wrote status, logs and result for ANY task id. Real AgentService, real
 * routes over a real socket, real signed tokens; only the stores are stubs (the real-database version is
 * database/agentOwnership.pg.test.ts). Every refusal case asserts the write was NOT made, so a 404 from a wrong reason shows.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { ConfigReader } from '@backstage/config';
import { AgentService } from '../service/AgentService';
import { createAgentRoutes } from './agentRoutes';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const T_ALICE = '11111111-1111-4111-8111-111111111111';
const T_BOB = '22222222-2222-4222-8222-222222222222';
const T_ORPHAN_ALICE = '33333333-3333-4333-8333-333333333333'; // its agent row is gone (renamed id), queued by Alice
const T_ORPHAN_BOB = '44444444-4444-4444-8444-444444444444';
const T_UNKNOWN = '55555555-5555-4555-8555-555555555555';

function setup() {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() } as any;
  const tasks: Record<string, any> = {
    [T_ALICE]: { task_id: T_ALICE, agent_id: 'agent-alice', user_id: ALICE },
    [T_BOB]: { task_id: T_BOB, agent_id: 'agent-bob', user_id: BOB },
    [T_ORPHAN_ALICE]: { task_id: T_ORPHAN_ALICE, agent_id: 'agent-alice-old-id', user_id: ALICE },
    [T_ORPHAN_BOB]: { task_id: T_ORPHAN_BOB, agent_id: 'agent-bob-old-id', user_id: BOB },
  };
  const agents: Record<string, any> = {
    'agent-alice': { agent_id: 'agent-alice', user_id: ALICE },
    'agent-bob': { agent_id: 'agent-bob', user_id: BOB },
  };
  const taskStore = { getAgentById: jest.fn(async (id: string) => agents[id] ?? null) } as any;
  const queue = {
    getTask: jest.fn(async (id: string) => tasks[id] ?? null),
    updateTaskStatus: jest.fn(async () => undefined),
  } as any;
  const config = new ConfigReader({ backend: { auth: { keys: [{ secret: 'test-secret-for-agent-tokens-0123456789' }] } } });
  const service = new AgentService(logger, taskStore, queue, config, 25, 600);
  const app = express();
  app.use(express.json());
  app.use('/agent', createAgentRoutes(service, logger, undefined, { get: async () => undefined } as any));
  const server = http.createServer(app);
  const tokenFor = (user: string) => (service as any).generateServiceToken(user) as string;
  return { server, tokenFor, queue, taskStore, logger };
}

describe('PUT /agent/tasks/:taskId/status — the task must be the token holder\'s', () => {
  let ctx: ReturnType<typeof setup>;
  let base: string;
  beforeEach(async () => {
    ctx = setup();
    await new Promise<void>(r => ctx.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(ctx.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    ctx.server.closeAllConnections?.();
    await new Promise(r => ctx.server.close(r));
  });

  const put = (taskId: string, token: string | undefined, body: any = { status: 'completed', logs: 'x' }) =>
    fetch(`${base}/agent/tasks/${taskId}/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('accepts a report for the token holder\'s own task and writes it', async () => {
    const res = await put(T_ALICE, ctx.tokenFor(ALICE));
    expect(res.status).toBe(200);
    expect(ctx.queue.updateTaskStatus).toHaveBeenCalledTimes(1);
    expect((ctx.queue.updateTaskStatus as jest.Mock).mock.calls[0][0]).toBe(T_ALICE);
  });

  it('refuses the SAME task with someone else\'s token (404), and writes nothing', async () => {
    const res = await put(T_ALICE, ctx.tokenFor(BOB));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Task not found', taskId: T_ALICE });
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining(T_ALICE));
  });

  it('gives the same answer for a task that does not exist (no existence leak)', async () => {
    const res = await put(T_UNKNOWN, ctx.tokenFor(ALICE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Task not found', taskId: T_UNKNOWN });
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('answers 404 (not a retried 5xx) for an id that is not a uuid, without touching the database', async () => {
    for (const bad of ['not-a-uuid', '1', '../etc/passwd', `${T_ALICE}x`]) {
      expect((await put(encodeURIComponent(bad), ctx.tokenFor(ALICE))).status).toBe(404);
    }
    expect(ctx.queue.getTask).not.toHaveBeenCalled();
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('a task whose agent row is gone still belongs to the user who queued it, and only to them', async () => {
    expect((await put(T_ORPHAN_ALICE, ctx.tokenFor(ALICE), { status: 'failed', error: 'interrupted' })).status).toBe(200);
    expect(ctx.queue.updateTaskStatus).toHaveBeenCalledTimes(1);
    (ctx.queue.updateTaskStatus as jest.Mock).mockClear();
    expect((await put(T_ORPHAN_BOB, ctx.tokenFor(ALICE))).status).toBe(404);
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('refuses a task queued by another user even when its agent is the token holder\'s (a vacated agent id registered later)', async () => {
    // Bob's task, but its agent row (id reused after a rename) now belongs to Alice.
    (ctx.queue.getTask as jest.Mock).mockResolvedValueOnce({ task_id: T_BOB, agent_id: 'agent-alice', user_id: BOB });
    expect((await put(T_BOB, ctx.tokenFor(ALICE))).status).toBe(404);
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('compares the owner case-insensitively', async () => {
    expect((await put(T_ALICE, ctx.tokenFor('Alice@Example.com'))).status).toBe(200);
  });

  it('still answers 401 for a missing, forged or unsigned token, before touching any store', async () => {
    expect((await put(T_ALICE, undefined)).status).toBe(401);
    expect((await put(T_ALICE, 'not.a-real-token')).status).toBe(401);
    expect(ctx.queue.getTask).not.toHaveBeenCalled();
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('still validates the body first (400) and never reaches the ownership lookup', async () => {
    expect((await put(T_ALICE, ctx.tokenFor(ALICE), { status: 'bogus' })).status).toBe(400);
    expect((await put(T_ALICE, ctx.tokenFor(ALICE), {})).status).toBe(400);
    expect(ctx.queue.getTask).not.toHaveBeenCalled();
  });

  it('lets a database error surface as a 500 (the agent retries those), not as a silent drop', async () => {
    (ctx.queue.getTask as jest.Mock).mockRejectedValueOnce(new Error('connection lost'));
    const res = await put(T_ALICE, ctx.tokenFor(ALICE));
    expect(res.status).toBe(500);
    expect(ctx.queue.updateTaskStatus).not.toHaveBeenCalled();
  });
});
