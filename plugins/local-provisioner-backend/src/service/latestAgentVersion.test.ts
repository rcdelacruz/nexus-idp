import { isOlderVersion, LatestAgentVersion } from './latestAgentVersion';

describe('LatestAgentVersion', () => {
  it('asks npm at most once an hour, retries failures after 10 min, keeps the last good value', async () => {
    let clock = 0;
    let calls = 0;
    let reply: any = { ok: true, json: async () => ({ version: '0.1.25' }) };
    const latest = new LatestAgentVersion(async () => {
      calls++;
      return reply;
    }, () => clock);
    expect(await latest.get()).toBe('0.1.25');
    clock = 59 * 60_000;
    expect(await latest.get()).toBe('0.1.25');
    expect(calls).toBe(1);
    clock = 61 * 60_000;
    reply = { ok: false, json: async () => ({}) };
    expect(await latest.get()).toBe('0.1.25'); // npm down: last good value
    expect(calls).toBe(2);
    clock += 5 * 60_000;
    await latest.get();
    expect(calls).toBe(2); // failure cached for 10 min
  });

  it('never throws and never trusts a non-version', async () => {
    expect(await new LatestAgentVersion(async () => { throw new Error('offline'); }).get()).toBeUndefined();
    expect(await new LatestAgentVersion(async () => ({ ok: true, json: async () => ({ version: '<script>' }) })).get()).toBeUndefined();
  });

  it('compares versions numerically', () => {
    expect(isOlderVersion('0.1.22', '0.1.25')).toBe(true);
    expect(isOlderVersion('0.1.9', '0.1.10')).toBe(true);
    expect(isOlderVersion('0.1.25', '0.1.25')).toBe(false);
    expect(isOlderVersion('0.2.0', '0.1.99')).toBe(false);
    expect(isOlderVersion(undefined, '0.1.25')).toBe(false);
    expect(isOlderVersion('0.1.25', undefined)).toBe(false);
  });
});
