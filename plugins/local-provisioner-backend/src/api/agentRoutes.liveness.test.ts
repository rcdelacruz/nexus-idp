/**
 * The lab guardrail must not trust an agent that has gone quiet (2026-10-31, again: even after
 * "a dropped connection = offline", a stopped agent still read online for ~90 s whenever the
 * server never SAW the drop — laptop asleep, wifi gone, a proxy that answers for the client).
 *
 * Over real sockets, because "the agent is gone" only exists on a real connection. The half-open
 * client below is a raw TCP socket that sends its poll and then neither reads nor closes: from the
 * server's side that is indistinguishable from a sleeping laptop, and the 'close' event the
 * previous fix relied on never fires.
 */
import express from 'express';
import http from 'http';
import net from 'net';
import { AddressInfo } from 'net';
import { ConfigReader } from '@backstage/config';
import { AgentService } from '../service/AgentService';
import { createAgentRoutes } from './agentRoutes';

const AGENT_ID = 'agent-mac-1';
const USER = 'trainee@example.com';
const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

function setup(opts: { confirmTimeoutMs?: number; lastSeenWriteDelayMs?: number; getAgentDelayMs?: number; pendingDelayMs?: number } = {}) {
  let lastSeen = new Date();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() } as any;
  const row = () => ({ agent_id: AGENT_ID, user_id: USER, last_seen: lastSeen, agent_version: '0.1.30' });
  const taskStore = {
    getAgentById: jest.fn().mockImplementation(async () => {
      if (opts.getAgentDelayMs) await tick(opts.getAgentDelayMs);
      return row();
    }),
    getAgentsByUser: jest.fn().mockImplementation(async () => [row()]),
    updateAgentLastSeen: jest.fn().mockImplementation(async () => {
      if (opts.lastSeenWriteDelayMs) await tick(opts.lastSeenWriteDelayMs);
      lastSeen = new Date();
    }),
  } as any;
  const queue = {
    getPendingTasksForAgent: jest.fn().mockImplementation(async () => {
      if (opts.pendingDelayMs) await tick(opts.pendingDelayMs);
      return [];
    }),
  } as any;
  const config = new ConfigReader({ backend: { auth: { keys: [{ secret: 'test-secret-for-agent-tokens-0123456789' }] } } });
  const service = new AgentService(logger, taskStore, queue, config, 25, opts.confirmTimeoutMs ?? 600);
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = { userEntityRef: 'user:default/trainee' };
    next();
  });
  app.use('/agent', createAgentRoutes(service, logger, undefined, { get: async () => undefined } as any));
  const server = http.createServer(app);
  const token = (service as any).generateServiceToken(USER) as string;
  const tokenFor = (user: string) => (service as any).generateServiceToken(user) as string;
  return { service, server, token, tokenFor, setLastSeen: (d: Date) => (lastSeen = d), logger };
}

async function listen(server: http.Server): Promise<{ base: string; port: number }> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port };
}

/** What backstage-agent does: poll, and re-poll the instant it gets an answer. */
function healthyAgent(base: string, token: string) {
  const controller = new AbortController();
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const r = await fetch(`${base}/agent/poll?agentId=${AGENT_ID}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        await r.json();
      } catch {
        if (stopped) return;
        await tick(50);
      }
    }
  })();
  return {
    stop: () => {
      stopped = true;
      controller.abort();
    },
  };
}

/** A poll that is parked, from a client the server will never see leave (no read, no close). */
async function halfOpenAgent(port: number, token: string): Promise<net.Socket> {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>(r => socket.once('connect', () => r()));
  socket.write(`GET /agent/poll?agentId=${AGENT_ID} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\n\r\n`);
  socket.pause(); // never reads the answer
  await tick(300);
  return socket;
}

/** A client that sends its poll and hangs up `afterMs` later, while the server is still working on it. */
async function sendAndHangUp(port: number, token: string, agentId: string, afterMs: number): Promise<void> {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>(r => socket.once('connect', () => r()));
  socket.write(`GET /agent/poll?agentId=${agentId} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\n\r\n`);
  await tick(afterMs);
  socket.destroy();
}

async function close(server: http.Server) {
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
}

const internals = (s: AgentService) => s as unknown as { pollWaiters: Map<string, unknown[]>; aliveProbes: Map<string, unknown>; confirmInFlight: Map<string, unknown>; pendingShutdowns: Set<string> };

describe('the rule for a silent agent', () => {
  it('online within one poll + 20 s of its last poll, offline after (was 90 s)', async () => {
    const { service, setLastSeen } = setup();
    const results: Record<number, boolean> = {};
    for (const ageSec of [5, 44, 46, 89]) {
      setLastSeen(new Date(Date.now() - ageSec * 1000));
      results[ageSec] = await service.isAgentOnline(AGENT_ID);
    }
    expect(results).toEqual({ 5: true, 44: true, 46: false, 89: false });
    // The same rule everywhere: getAgentStatus answers like isAgentOnline.
    setLastSeen(new Date(Date.now() - 60_000));
    expect((await service.getAgentStatus(AGENT_ID, USER)).isConnected).toBe(false);
  });
});

describe('confirmAlive — proof, not inference', () => {
  it('a healthy agent (parked poll) answers the probe at once, and its next poll is parked for notifyAgent', async () => {
    const { service, server, token } = setup();
    const { base } = await listen(server);
    const agent = healthyAgent(base, token);
    try {
      await tick(300); // its first poll is parked
      const t0 = Date.now();
      expect(await service.confirmAlive(AGENT_ID)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(1500);
      // Confirmed only once the poll can be woken: queueing work right now cannot fall into a gap.
      expect(internals(service).pollWaiters.get(AGENT_ID)?.length).toBeGreaterThan(0);
    } finally {
      agent.stop();
      await close(server);
    }
  });

  it('a poll that has started but is not parked yet still confirms (nothing to wake, then it parks)', async () => {
    const { service } = setup({ lastSeenWriteDelayMs: 300 });
    const poll = service.longPoll(AGENT_ID, USER); // slow DB write: not parked for 300 ms
    await tick(20);
    const t0 = Date.now();
    expect(await service.confirmAlive(AGENT_ID)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    service.notifyAgent(AGENT_ID);
    await poll;
  });

  it('an agent the server never saw leave (half-open) is NOT confirmed, and then reads offline everywhere', async () => {
    const { service, server, token } = setup();
    const { port } = await listen(server);
    const socket = await halfOpenAgent(port, token);
    try {
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false);
      expect(await service.isAgentOnline(AGENT_ID)).toBe(true); // last_seen is seconds old: the old rule says online
      const t0 = Date.now();
      expect(await service.confirmAlive(AGENT_ID)).toBe(false);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(550); // waited for the answer it never got
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(true);
      expect(await service.isAgentOnline(AGENT_ID)).toBe(false); // although last_seen is fresh
      expect(await service.confirmAgentOnline(AGENT_ID)).toBe(false);
    } finally {
      socket.destroy();
      await close(server);
    }
  });

  it('no negative caching: the agent that was flagged is accepted again as soon as it polls', async () => {
    const { service, server, token } = setup();
    const { base, port } = await listen(server);
    const socket = await halfOpenAgent(port, token);
    let agent: ReturnType<typeof healthyAgent> | undefined;
    try {
      expect(await service.confirmAlive(AGENT_ID)).toBe(false);
      agent = healthyAgent(base, token); // the trainee restarted it
      await tick(300);
      expect(await service.confirmAlive(AGENT_ID)).toBe(true);
      expect(await service.isAgentOnline(AGENT_ID)).toBe(true);
    } finally {
      agent?.stop();
      socket.destroy();
      await close(server);
    }
  });

  it('concurrent probes share one wake, and a proof is never reused: an agent that stops right after one is caught by the next', async () => {
    const { service, server, token } = setup();
    const { base } = await listen(server);
    const agent = healthyAgent(base, token);
    try {
      await tick(300);
      const notify = jest.spyOn(service, 'notifyAgent');
      const [a, b, c] = await Promise.all([service.confirmAlive(AGENT_ID), service.confirmAlive(AGENT_ID), service.confirmAlive(AGENT_ID)]);
      expect([a, b, c]).toEqual([true, true, true]);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      agent.stop();
      await close(server);
    }
    // The agent stops (here: the loop ends and nothing re-polls) immediately after being confirmed:
    // the next decision must not be answered from the earlier proof (found with the real agent,
    // when a 3 s cache said a frozen laptop was fine).
    const socketServer = setup();
    const { port } = await listen(socketServer.server);
    const stillThere = await halfOpenAgent(port, socketServer.token);
    try {
      expect(await socketServer.service.confirmAlive(AGENT_ID)).toBe(false);
    } finally {
      stillThere.destroy();
      await close(socketServer.server);
    }
  });

  it('a shutdown being delivered ends the probe at once (does not wait out the timeout)', async () => {
    const { service, server, token } = setup({ confirmTimeoutMs: 5000 });
    const { base } = await listen(server);
    const controller = new AbortController();
    try {
      // The agent's single poll, parked; a Stop request is pending for it.
      const parked = fetch(`${base}/agent/poll?agentId=${AGENT_ID}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(r => r.json())
        .catch(() => undefined);
      await tick(300);
      internals(service).pendingShutdowns.add(AGENT_ID);
      const t0 = Date.now();
      expect(await service.confirmAlive(AGENT_ID)).toBe(false); // the probe wakes the poll; the answer is "shut down"
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(((await parked) as any)?.shouldShutdown).toBe(true);
      expect(await service.confirmAlive(AGENT_ID)).toBe(false); // flagged: answered without waiting
    } finally {
      controller.abort();
      await close(server);
    }
  });

  it('leaves nothing behind (no parked polls, listeners or in-flight probes)', async () => {
    const { service, server, token } = setup();
    const { base, port } = await listen(server);
    const agent = healthyAgent(base, token);
    const socket = await halfOpenAgent(port, token);
    try {
      await service.confirmAlive(AGENT_ID);
      await service.confirmAlive(AGENT_ID);
    } finally {
      agent.stop();
      socket.destroy();
      await close(server);
    }
    await tick(300);
    expect(internals(service).aliveProbes.size).toBe(0);
    expect(internals(service).confirmInFlight.size).toBe(0);
  });
});

describe('review findings (2026-10-31)', () => {
  it('a client that hangs up while the server is still working on its poll leaves nothing parked, stays flagged, and is never "confirmed"', async () => {
    const { service, server, token } = setup({ lastSeenWriteDelayMs: 300 });
    const { port } = await listen(server);
    try {
      await sendAndHangUp(port, token, AGENT_ID, 50); // gone while updateAgentLastSeen is still pending
      await tick(100);
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(true);
      expect(await service.confirmAlive(AGENT_ID)).toBe(false);
      await tick(500); // the server's poll carries on past its DB write...
      expect(internals(service).pollWaiters.get(AGENT_ID)?.length ?? 0).toBe(0); // ...and does not park for a dead client
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(true); // nor wipe the flag its close set
      expect(await service.isAgentOnline(AGENT_ID)).toBe(false);
    } finally {
      await close(server);
    }
  });

  it('a late "connection lost" notice cannot refuse an agent whose new poll then parks', async () => {
    const { service } = setup({ pendingDelayMs: 300 });
    const poll = service.longPoll(AGENT_ID, USER); // past the flag-clearing at its start, in collect()
    await tick(100);
    service.markConnectionLost(AGENT_ID); // the previous process's close arrives now: no waiter parked yet
    expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(true);
    await tick(400); // the new poll parks
    expect(internals(service).pollWaiters.get(AGENT_ID)?.length).toBe(1);
    expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false); // a parked poll is a live agent
    expect(await service.isAgentOnline(AGENT_ID)).toBe(true);
    service.notifyAgent(AGENT_ID);
    await poll;
  });

  it("a service token for someone else's agent id cannot mark that agent gone by hanging up", async () => {
    const { service, server, tokenFor } = setup({ getAgentDelayMs: 100 });
    const { port } = await listen(server);
    try {
      await sendAndHangUp(port, tokenFor('someone.else@example.com'), AGENT_ID, 30);
      await tick(500);
      expect(service.isExplicitlyDisconnected(AGENT_ID)).toBe(false);
    } finally {
      await close(server);
    }
  });
});

describe('GET /agent', () => {
  it('?verify=1 proves each agent: a half-open one is not connected even though it was seen seconds ago', async () => {
    const { server, token } = setup();
    const { base, port } = await listen(server);
    const socket = await halfOpenAgent(port, token);
    try {
      const plain = await fetch(`${base}/agent`);
      expect((await plain.json()).agents[0].is_connected).toBe(true); // inferred: looks fine
      const verified = await fetch(`${base}/agent?verify=1`);
      const body = await verified.json();
      expect(body.agents[0].is_connected).toBe(false);
      expect(body.verified).toBe(true);
      expect(verified.headers.get('cache-control')).toBe('no-store');
    } finally {
      socket.destroy();
      await close(server);
    }
  });

  it("?verify=1 answers with the probe's verdict, not the row's age (an age that tips past the limit DURING the probe)", async () => {
    const { server, token, setLastSeen } = setup({ lastSeenWriteDelayMs: 300 }); // the re-poll takes 300 ms to park
    const { base } = await listen(server);
    const agent = healthyAgent(base, token);
    try {
      await tick(700);
      setLastSeen(new Date(Date.now() - 44_900)); // 100 ms inside the 45 s limit when the route reads it
      const body = await (await fetch(`${base}/agent?verify=1`)).json();
      // By the time the probe is back (>= 300 ms) that same row reads past the 45 s limit: by age
      // alone this agent would be offline; the probe says it answered, and that is the verdict.
      expect(body.agents[0].last_seen_age_seconds).toBeGreaterThanOrEqual(45);
      expect(body.agents[0].is_connected).toBe(true);
    } finally {
      agent.stop();
      await close(server);
    }
  });
});
