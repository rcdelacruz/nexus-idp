import { getConnectivity } from './connectivity';
import { AgentRegistration } from './types';

function agent(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    id: 'agent-1',
    userId: 'user@example.com',
    hostname: 'host',
    machineName: 'host',
    osPlatform: 'darwin',
    lastSeenAt: new Date().toISOString(),
    lastSeenAgeSeconds: 0,
    isConnected: true,
    explicitlyDisconnected: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as AgentRegistration;
}

describe('getConnectivity', () => {
  it("is online exactly when the server says connected (one rule for the chip and the lab guardrail)", () => {
    expect(getConnectivity(agent({ isConnected: true, lastSeenAgeSeconds: 0 }))).toBe('online');
    // The server decides, however old the age looks: it is the same verdict the guardrail uses.
    expect(getConnectivity(agent({ isConnected: true, lastSeenAgeSeconds: 40 }))).toBe('online');
  });

  it('is not online when the server says not connected, even if the agent was seen seconds ago', () => {
    // The chip used to say "online" for 90 s after an agent stopped (age-only rule).
    expect(getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: 50 }))).not.toBe('online');
  });

  it('shows reconnecting (degraded) for a little while after the last contact, then offline', () => {
    expect(getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: 50 }))).toBe('degraded');
    expect(getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: 120 }))).toBe('degraded');
    expect(getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: 121 }))).toBe('offline');
    expect(getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: 99999 }))).toBe('offline');
  });

  it('falls back to computing age from lastSeenAt when lastSeenAgeSeconds is absent', () => {
    const staleTimestamp = new Date(Date.now() - 400_000).toISOString(); // ~6.7 min ago
    expect(
      getConnectivity(agent({ isConnected: false, lastSeenAgeSeconds: null, lastSeenAt: staleTimestamp })),
    ).toBe('offline');
  });

  it('is offline immediately when explicitly disconnected, even with a fresh age', () => {
    // Backend sets explicitlyDisconnected the instant "Stop Agent" is delivered — age alone
    // would still read "online" here since the agent was seen a moment ago.
    expect(
      getConnectivity(agent({ isConnected: false, explicitlyDisconnected: true, lastSeenAgeSeconds: 1 })),
    ).toBe('offline');
  });

  it('stays offline as time passes, does not regress to degraded (regression check)', () => {
    // Bug found 2026-07-26: an earlier version derived this from `!isConnected && age <= 90`,
    // which looked right for 90s then fell through to the age-based bucketing and reported a
    // definitively-offline agent as 'degraded' once age crossed 90s. explicitlyDisconnected
    // must NOT decay with age — once true, always 'offline' until a real reconnect clears it.
    expect(
      getConnectivity(agent({ isConnected: false, explicitlyDisconnected: true, lastSeenAgeSeconds: 150 })),
    ).toBe('offline');
    expect(
      getConnectivity(agent({ isConnected: false, explicitlyDisconnected: true, lastSeenAgeSeconds: 99999 })),
    ).toBe('offline');
  });
});
