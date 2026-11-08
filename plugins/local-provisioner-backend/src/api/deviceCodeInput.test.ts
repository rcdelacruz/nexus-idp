import { parseDeviceCodeBody } from './deviceCodeInput';

const valid = { agent_id: 'agent-ronalds-macbook-pro-a1b2c3d4', hostname: 'Ronalds-MacBook-Pro.local', platform: 'darwin', platform_version: 'macOS 26.0 (arm64)', agent_version: '0.1.32' };

describe('parseDeviceCodeBody', () => {
  it('accepts what the agent really sends', () => {
    expect(parseDeviceCodeBody(valid)).toEqual({
      ok: true,
      machine: { agentId: valid.agent_id, hostname: valid.hostname, platform: 'darwin', platformVersion: valid.platform_version, agentVersion: '0.1.32' },
    });
  });

  it('accepts no body, an empty body, and a body missing some fields (no machine info, as before)', () => {
    expect(parseDeviceCodeBody(undefined)).toEqual({ ok: true });
    expect(parseDeviceCodeBody({})).toEqual({ ok: true });
    expect(parseDeviceCodeBody({ hostname: 'x' })).toEqual({ ok: true });
    expect(parseDeviceCodeBody({ agent_id: 'a', hostname: 'h', platform: 'linux' })).toEqual({ ok: true });
  });

  it('drops an agent_version that is not x.y.z but keeps the rest', () => {
    const r = parseDeviceCodeBody({ ...valid, agent_version: '1.0; drop table' });
    expect(r).toEqual({ ok: true, machine: expect.objectContaining({ agentVersion: undefined }) });
  });

  it('refuses a body that is not an object', () => {
    for (const bad of ['text', 5, true, [valid], [1]]) expect(parseDeviceCodeBody(bad).ok).toBe(false);
  });

  it.each([
    ['an agent_id with characters outside letters, digits, . _ -', { agent_id: 'agent a;b' }],
    ['an agent_id over 300 characters', { agent_id: 'a'.repeat(301) }],
    ['a hostname of only control characters', { hostname: '\u0000\u0007\n' }],
    ['a hostname over 255 characters', { hostname: 'h'.repeat(256) }],
    ['a platform with spaces', { platform: 'dar win' }],
    ['a platform over 32 characters', { platform: 'p'.repeat(33) }],
    ['a platform_version over 128 characters', { platform_version: 'v'.repeat(129) }],
    ['a non-string field', { hostname: { a: 1 } }],
    ['a non-string agent_id', { agent_id: 12345 }],
  ])('refuses %s', (_label, patch) => {
    expect(parseDeviceCodeBody({ ...valid, ...patch }).ok).toBe(false);
  });

  it('strips control characters out of a hostname instead of storing them', () => {
    const r = parseDeviceCodeBody({ ...valid, hostname: 'host\u0000\nname' });
    expect(r).toEqual({ ok: true, machine: expect.objectContaining({ hostname: 'hostname' }) });
  });

  it('accepts a hostname with spaces and non-ASCII letters (a computer name is not always ASCII)', () => {
    const r = parseDeviceCodeBody({ ...valid, hostname: 'Ronald’s MacBook Pro' });
    expect(r.ok).toBe(true);
  });
});
