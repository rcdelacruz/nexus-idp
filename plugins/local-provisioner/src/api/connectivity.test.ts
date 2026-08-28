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
  it('is online when age is within 90s', () => {
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 0 }))).toBe('online');
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 90 }))).toBe('online');
  });

  it('is degraded between 90s and 300s', () => {
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 91 }))).toBe('degraded');
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 300 }))).toBe('degraded');
  });

  it('is offline beyond 300s', () => {
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 301 }))).toBe('offline');
    expect(getConnectivity(agent({ lastSeenAgeSeconds: 99999 }))).toBe('offline');
  });

  it('falls back to computing age from lastSeenAt when lastSeenAgeSeconds is absent', () => {
    const staleTimestamp = new Date(Date.now() - 400_000).toISOString(); // ~6.7 min ago
    expect(
      getConnectivity(agent({ lastSeenAgeSeconds: null, lastSeenAt: staleTimestamp })),
    ).toBe('offline');
  });

  it('is offline immediately when explicitly disconnected, even with a fresh age', () => {
    // Backend sets explicitlyDisconnected the instant "Stop Agent" is delivered — age alone
    // would still read "online" here since the agent was seen a moment ago.
    expect(
      getConnectivity(agent({ explicitlyDisconnected: true, lastSeenAgeSeconds: 1 })),
    ).toBe('offline');
  });

  it('stays offline as time passes, does not regress to degraded (regression check)', () => {
    // Bug found 2026-07-26: an earlier version derived this from `!isConnected && age <= 90`,
    // which looked right for 90s then fell through to the age-based bucketing and reported a
    // definitively-offline agent as 'degraded' once age crossed 90s. explicitlyDisconnected
    // must NOT decay with age — once true, always 'offline' until a real reconnect clears it.
    expect(
      getConnectivity(agent({ explicitlyDisconnected: true, lastSeenAgeSeconds: 150 })),
    ).toBe('offline');
    expect(
      getConnectivity(agent({ explicitlyDisconnected: true, lastSeenAgeSeconds: 99999 })),
    ).toBe('offline');
  });

  it('still degrades gracefully on ordinary staleness (no explicit disconnect involved)', () => {
    expect(
      getConnectivity(agent({ explicitlyDisconnected: false, lastSeenAgeSeconds: 150 })),
    ).toBe('degraded');
    expect(
      getConnectivity(agent({ explicitlyDisconnected: false, lastSeenAgeSeconds: 301 })),
    ).toBe('offline');
  });
});
