/**
 * A stopped agent must read as offline at once, not after last_seen goes stale (90 s): the lab
 * guardrail (form + stratpoint:local-agent-check) let a trainee start a lab right after stopping
 * their agent (2026-10-31). Over a real socket, because "the agent's connection dropped" only
 * exists on a real connection.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { ConfigReader } from '@backstage/config';
import { AgentService } from '../service/AgentService';
import { createAgentRoutes } from './agentRoutes';

const AGENT_ID = 'agent-mac-1';
const USER = 'trainee@example.com';

function setup() {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() } as any;
  const taskStore = {
    getAgentById: jest.fn().mockResolvedValue({ agent_id: AGENT_ID, user_id: USER, last_seen: new Date() }),
    updateAgentLastSeen: jest.fn().mockResolvedValue(undefined),
  } as any;
  const queue = { getPendingTasksForAgent: jest.fn().mockResolvedValue([]) } as any;
  const config = new ConfigReader({ backend: { auth: { keys: [{ secret: 'test-secret-for-agent-tokens-0123456789' }] } } });
  const service = new AgentService(logger, taskStore, queue, config, 25);
  const app = express();
  app.use('/agent', createAgentRoutes(service, logger, undefined, { get: async () => undefined } as any)); // as router.ts mounts it
  const server = http.createServer(app);
  const token = (service as any).generateServiceToken(USER) as string;
  return { service, server, token };
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('GET /agent/poll — a stopped agent is offline immediately', () => {
  it('the agent process stops while its poll is parked → offline now; its next poll → online again', async () => {
    const { service, server, token } = setup();
    const base = await listen(server);
    try {
      expect(await service.isAgentOnline(AGENT_ID)).toBe(true); // last_seen is fresh

      // The agent's poll parks (no work); then the agent dies: its connection drops.
      const controller = new AbortController();
      const parked = fetch(`${base}/agent/poll?agentId=${AGENT_ID}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).catch(() => undefined);
      await tick(300);
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false);
      controller.abort();
      await parked;
      await tick(300);

      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(true);
      expect(await service.isAgentOnline(AGENT_ID)).toBe(false); // although last_seen is seconds old

      // Restarted (or the network came back): the next poll clears it.
      const again = new AbortController();
      const next = fetch(`${base}/agent/poll?agentId=${AGENT_ID}`, { headers: { Authorization: `Bearer ${token}` }, signal: again.signal }).catch(() => undefined);
      await tick(300);
      expect(await service.isAgentOnline(AGENT_ID)).toBe(true);
      service.notifyAgent(AGENT_ID); // answer it normally
      await next;
      await tick(100);
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false); // a normal response is not a drop
    } finally {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    }
  });

  it('a dropped duplicate poll does not mark an agent offline while another poll of it is still parked', async () => {
    const { service } = setup();
    const first = new AbortController();
    const p1 = service.longPoll(AGENT_ID, USER, first.signal);
    const p2 = service.longPoll(AGENT_ID, USER, new AbortController().signal);
    await tick(50);
    first.abort();
    await p1;
    service.markConnectionLost(AGENT_ID);
    expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false);
    service.notifyAgent(AGENT_ID);
    await p2;
  });
});
