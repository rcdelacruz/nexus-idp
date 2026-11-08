import { mockServices } from '@backstage/backend-test-utils';
import { agentReadiness, agoText, createLocalAgentCheckAction, versionBelow } from './localAgent';

const GB = 1024 ** 3;
const online = { agent_id: 'a1', agent_version: '0.1.29', is_connected: true };

describe('agentReadiness', () => {
  it('no agent yet: how to set it up, with this portal’s URL', () => {
    const r = agentReadiness([], { portalUrl: 'https://portal.example' });
    expect(r.problem).toMatch(/haven't set up the Backstage agent/);
    expect(r.problem).toMatch(/npm install -g @stratpoint\/backstage-agent/);
    expect(r.problem).toMatch(/backstage-agent login --url https:\/\/portal\.example/);
    expect(r.problem).toMatch(/https:\/\/portal\.example\/local-provisioner/);
  });

  it('offline: how long ago, and how to start it', () => {
    const r = agentReadiness([{ agent_id: 'a1', is_connected: false, last_seen_age_seconds: 3600 }], {});
    expect(r.problem).toMatch(/offline \(last seen 60 min ago\)/);
    expect(r.problem).toMatch(/backstage-agent start/);
  });

  it('just stopped (seen 30 s ago, but the server says not connected) is offline — the 2026-10-31 bug', () => {
    expect(agentReadiness([{ agent_id: 'a1', is_connected: false, last_seen_age_seconds: 30 }], {}).problem).toMatch(/offline \(last seen 30 s ago\)/);
  });

  it('too old for this lab: how to update', () => {
    const r = agentReadiness([{ ...online, agent_version: '0.1.28' }], { minAgentVersion: '0.1.29' });
    expect(r.problem).toMatch(/needs Backstage agent 0\.1\.29 or newer; yours is 0\.1\.28/);
    expect(r.problem).toMatch(/backstage-agent update/);
    expect(agentReadiness([online], { minAgentVersion: '0.1.29' }).agent).toBe(online);
  });

  it('machine too small: the Docker memory fix', () => {
    const r = agentReadiness([{ ...online, capabilities: { dockerMemoryBytes: 2 * GB } }], { requirements: { minDockerMemoryGb: 3 } });
    expect(r.problem).toMatch(/needs about 3 GB of memory for Docker; yours has 2\.0 GB/);
  });

  it('uses the first online agent (most recent first)', () => {
    const r = agentReadiness([{ agent_id: 'old', is_connected: false, last_seen_age_seconds: 9999 }, { ...online, agent_id: 'mac' }], {});
    expect(r.agent?.agent_id).toBe('mac');
  });

  it('says "s" while it is recent and minutes after that', () => {
    expect([agoText(8), agoText(89), agoText(90), agoText(3600)]).toEqual(['8 s ago', '89 s ago', '2 min ago', '60 min ago']);
  });

  it('compares versions numerically; unknown versions never block', () => {
    expect([versionBelow('0.1.9', '0.1.29'), versionBelow('0.1.100', '0.1.29'), versionBelow('1.0.0', '0.1.29')]).toEqual([true, false, false]);
    expect([versionBelow(undefined, '0.1.29'), versionBelow('dev', '0.1.29')]).toEqual([false, false]);
  });
});

describe('stratpoint:local-agent-check', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const action = createLocalAgentCheckAction({
    discovery: { getBaseUrl: async () => 'http://b/api/local-provisioner' } as any,
    auth: { getPluginRequestToken: async () => ({ token: 'obo' }) } as any,
    config: mockServices.rootConfig({ data: { app: { baseUrl: 'https://portal.example' } } }),
  });
  const run = (agents: any[], input: any = {}) => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify({ agents }), { status: 200 });
    }) as any;
    const outputs: Record<string, unknown> = {};
    const p = action.handler({
      input,
      logger: mockServices.logger.mock(),
      output: (k: string, v: unknown) => (outputs[k] = v),
      getInitiatorCredentials: async () => ({}),
    } as any);
    return { p, calls, outputs };
  };

  it('stops the template, with the fix, when there is no agent — and only reads', async () => {
    const { p, calls } = run([]);
    await expect(p).rejects.toThrow(/haven't set up the Backstage agent/);
    // verify=1: this decides whether anything gets created, so the server must make the agent
    // prove it is alive right now instead of trusting how recently it was seen.
    expect(calls).toEqual(['GET http://b/api/local-provisioner/agent?verify=1']);
  });

  it('an agent the server could not confirm is offline, however recently it was seen', async () => {
    const { p } = run([{ agent_id: 'a1', is_connected: false, last_seen_age_seconds: 8 }]);
    await expect(p).rejects.toThrow(/offline \(last seen 8 s ago\)/);
  });

  it('passes and reports the agent when it is online and new enough', async () => {
    const { p, outputs } = run([online], { minAgentVersion: '0.1.29', requirements: { minDockerMemoryGb: 3 } });
    await p;
    expect(outputs).toEqual({ agentId: 'a1', agentVersion: '0.1.29' });
  });
});
