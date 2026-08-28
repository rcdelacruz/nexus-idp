/**
 * Tests for agent service-token signing and verification.
 *
 * Before 2026-07-24 the "service token" was bare base64-encoded JSON with no signature, and
 * validation only decoded it and read `sub`. Anyone could mint a token asserting any identity
 * and reach every agent endpoint. These tests pin the properties that fix depends on —
 * particularly that a forged or tampered token is rejected.
 */

import { ConfigReader } from '@backstage/config';
import { AgentService } from './AgentService';

const SECRET = 'test-secret-do-not-use-in-production';

// `null` means "no secret configured". Not `undefined` — that would trigger JS default-
// parameter substitution and silently hand back the real secret.
function makeService(secret: string | null = SECRET) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as any;

  const config = new ConfigReader(
    secret === null
      ? { backend: { auth: {} } }
      : { backend: { auth: { keys: [{ secret }] } } },
  );

  return new AgentService(logger, {} as any, {} as any, config, 3600);
}

/** Reach the private signer directly — the public surface only exposes verification. */
function sign(service: AgentService, email: string): string {
  return (service as any).generateServiceToken(email);
}

describe('AgentService service tokens', () => {
  let service: AgentService;

  beforeEach(() => {
    service = makeService();
  });


  it('round-trips a signed token back to the user email', () => {
    const token = sign(service, 'alice@example.com');
    expect(service.verifyServiceToken(token)).toBe('alice@example.com');
  });

  it('produces a two-part token, not bare base64', () => {
    const token = sign(service, 'alice@example.com');
    expect(token.split('.')).toHaveLength(2);
  });

  // --- the vulnerability this change closes ---

  it('rejects a forged unsigned token (the pre-2026-07-24 format)', () => {
    const forged = Buffer.from(
      JSON.stringify({
        sub: 'victim@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64');

    expect(service.verifyServiceToken(forged)).toBeNull();
  });

  it('rejects a token whose payload was tampered with', () => {
    const token = sign(service, 'alice@example.com');
    const signature = token.slice(token.lastIndexOf('.') + 1);

    const swapped = Buffer.from(
      JSON.stringify({
        sub: 'attacker@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    expect(service.verifyServiceToken(`${swapped}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const other = makeService('a-completely-different-secret');
    const foreign = sign(other, 'alice@example.com');

    expect(service.verifyServiceToken(foreign)).toBeNull();
  });

  it('rejects an expired token even when correctly signed', () => {
    const realNow = Date.now;
    // Issue the token 8 days in the past so its 7-day expiry has lapsed.
    Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000;
    const stale = sign(service, 'alice@example.com');
    Date.now = realNow;

    expect(service.verifyServiceToken(stale)).toBeNull();
  });

  // --- malformed input must not throw ---

  it.each([
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['leading separator only', '.abcdef'],
    ['signature but unparseable payload', 'not-base64-json.deadbeef'],
    ['empty signature', `${Buffer.from('{}').toString('base64url')}.`],
  ])('returns null for %s rather than throwing', (_label, token) => {
    expect(() => service.verifyServiceToken(token)).not.toThrow();
    expect(service.verifyServiceToken(token)).toBeNull();
  });

  it('fails loudly when no signing secret is configured', () => {
    const unconfigured = makeService(null);
    expect(() => sign(unconfigured, 'alice@example.com')).toThrow(
      /BACKEND_SECRET/,
    );
  });
});

/**
 * Tests for the "Stop Agent" shutdown-delivery guarantee.
 *
 * Before 2026-07-26, disconnectAgent() only sent an SSE 'disconnect' event and returned false
 * (as "not connected") if there was no live SSE connection — with nothing else to fall back
 * on. SSE alone is not reliable through the Cloudflare tunnel (the same reason task delivery
 * already falls back to the heartbeat response), so a dropped SSE stream meant the stop
 * signal could silently never reach the agent. These tests pin the fix: a pending shutdown is
 * always recorded regardless of SSE connection state, and is delivered exactly once via
 * consumeShutdownPending() (the heartbeat handler's check).
 */
describe('AgentService shutdown delivery', () => {
  let service: AgentService;

  beforeEach(() => {
    service = makeService();
  });


  it('marks a shutdown pending even when the agent has no live SSE connection', () => {
    const result = service.disconnectAgent('agent-not-connected');
    expect(result).toBe(true);
    expect(service.consumeShutdownPending('agent-not-connected')).toBe(true);
  });

  it('consumeShutdownPending is one-shot — false on the second call', () => {
    service.disconnectAgent('agent-x');
    expect(service.consumeShutdownPending('agent-x')).toBe(true);
    expect(service.consumeShutdownPending('agent-x')).toBe(false);
  });

  it('an agent with no pending shutdown returns false, not throwing', () => {
    expect(service.consumeShutdownPending('never-disconnected')).toBe(false);
  });
});

/**
 * Tests for longPoll()/notifyAgent() — the mechanism that replaced SSE entirely on
 * 2026-07-26. SSE required one persistent connection held open indefinitely, which
 * Cloudflare's tunnel does not reliably keep alive (confirmed live: a wedged/dropped SSE
 * stream could silently never deliver a task or the disconnect signal, even though the server
 * "sent" it successfully). Long-polling holds many short-lived requests instead, each bounded
 * by a timeout well under Cloudflare's connection ceiling, so there's no long-lived connection
 * state to silently lose — a request either gets its answer or times out and is reissued.
 */
describe('AgentService long-poll delivery', () => {
  const AGENT_ID = 'agent-1';
  const USER_EMAIL = 'alice@example.com';

  function makeServiceWithStore(overrides: {
    pendingTasks?: any[];
    pollTimeoutSeconds?: number;
  } = {}) {
    const logger = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(),
    } as any;
    const config = new ConfigReader({ backend: { auth: { keys: [{ secret: SECRET }] } } });
    const taskStore = {
      getAgentById: jest.fn().mockResolvedValue({ agent_id: AGENT_ID, user_id: USER_EMAIL }),
      updateAgentLastSeen: jest.fn().mockResolvedValue(undefined),
    } as any;
    const taskQueueService = {
      getPendingTasksForAgent: jest.fn().mockResolvedValue(overrides.pendingTasks ?? []),
    } as any;
    return new AgentService(logger, taskStore, taskQueueService, config, overrides.pollTimeoutSeconds ?? 25);
  }

  it('rejects an agent that does not belong to the requesting user', async () => {
    const service = makeServiceWithStore();
    await expect(service.longPoll(AGENT_ID, 'someone-else@example.com')).rejects.toThrow(
      /does not belong to user/,
    );
  });

  it('rejects a nonexistent agent', async () => {
    const service = makeServiceWithStore();
    (service as any).taskStore.getAgentById.mockResolvedValue(null);
    await expect(service.longPoll('ghost', USER_EMAIL)).rejects.toThrow(/not found/);
  });

  it('returns immediately when a task is already pending — does not wait for a wake or timeout', async () => {
    const task = { task_id: 't1', task_type: 'provision-kafka' };
    const service = makeServiceWithStore({ pendingTasks: [task], pollTimeoutSeconds: 5 });

    const start = Date.now();
    const result = await service.longPoll(AGENT_ID, USER_EMAIL);
    expect(Date.now() - start).toBeLessThan(500); // well under the 5s timeout
    expect(result.tasks).toEqual([task]);
    expect(result.shouldShutdown).toBe(false);
  });

  it('returns immediately when a shutdown is already pending', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 5 });
    service.disconnectAgent(AGENT_ID);

    const result = await service.longPoll(AGENT_ID, USER_EMAIL);
    expect(result.shouldShutdown).toBe(true);
    expect(result.tasks).toEqual([]);
  });

  it('every call updates last_seen, whether it returns immediately or waits', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 5 });
    await service.longPoll(AGENT_ID, USER_EMAIL, AbortSignal.timeout(10));
    expect((service as any).taskStore.updateAgentLastSeen).toHaveBeenCalledWith(AGENT_ID);
  });

  it('notifyAgent wakes a parked poll immediately instead of waiting for the timeout', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 5 }); // long timeout on purpose
    const pending = service.longPoll(AGENT_ID, USER_EMAIL);

    // Give the poll a tick to actually park itself before disconnecting.
    await new Promise(r => setTimeout(r, 20));
    const start = Date.now();
    service.disconnectAgent(AGENT_ID); // marks pending + calls notifyAgent internally

    const result = await pending;
    expect(Date.now() - start).toBeLessThan(500); // woken immediately, not after 5s
    expect(result.shouldShutdown).toBe(true);
  });

  it('resolves with empty results after the timeout when nothing arrives', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 0.1 }); // 100ms
    const result = await service.longPoll(AGENT_ID, USER_EMAIL);
    expect(result).toEqual({ tasks: [], shouldShutdown: false });
  });

  it('an aborted poll resolves promptly instead of waiting out the full timeout', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 5 });
    const controller = new AbortController();
    const pending = service.longPoll(AGENT_ID, USER_EMAIL, controller.signal);

    await new Promise(r => setTimeout(r, 20));
    const start = Date.now();
    controller.abort();

    await pending;
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('a woken waiter is removed from the registry (no leak, no double-resolve)', async () => {
    const service = makeServiceWithStore({ pollTimeoutSeconds: 5 });
    const pending = service.longPoll(AGENT_ID, USER_EMAIL);
    await new Promise(r => setTimeout(r, 20));

    service.disconnectAgent(AGENT_ID);
    await pending;

    // A second notify with nothing parked must be a no-op, not throw.
    expect(() => service.notifyAgent(AGENT_ID)).not.toThrow();
  });
});
