import sample from './__fixtures__/vol34-sample.json';
import { RadarLoadError, loadLatestRadar, parseVolumeName } from './radarSource';

const DAY = 24 * 60 * 60 * 1000;
const V33 = 'Thoughtworks Technology Radar Volume 33 (Nov 2025).json';
const V34 = 'Thoughtworks Technology Radar Volume 34 (Apr 2026).json';
const RAW = 'https://raw.githubusercontent.com/setchy/thoughtworks-tech-radar-volumes/main/volumes/json/';
const DATA = JSON.stringify(sample);

const listing = (names: string[], host = RAW) => [
  ...names.map(name => ({ name, download_url: `${host}${encodeURIComponent(name)}` })),
  { name: 'README.md', download_url: `${host}README.md` },
];

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** A fetch that answers the listing call and the data call, and records every URL asked for. */
function fakeFetch(files: unknown, data: string = DATA, listStatus = 200) {
  const calls: string[] = [];
  const fn = jest.fn(async (url: string) => {
    calls.push(url);
    if (url.includes('api.github.com')) return { ok: listStatus === 200, status: listStatus, json: async () => files, text: async () => JSON.stringify(files) };
    return { ok: true, status: 200, json: async () => JSON.parse(data), text: async () => data };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('parseVolumeName', () => {
  it('reads the volume number and a readable label', () => {
    expect(parseVolumeName(V34)).toEqual({ volume: 34, label: 'Vol. 34 · April 2026' });
    expect(parseVolumeName(V33)).toEqual({ volume: 33, label: 'Vol. 33 · November 2025' });
  });

  it('ignores files that are not volumes', () => {
    expect(parseVolumeName('README.md')).toBeNull();
  });
});

describe('loadLatestRadar', () => {
  it('loads the highest volume, ignoring other files', async () => {
    const f = fakeFetch(listing([V33, V34]));
    const { radar, stale } = await loadLatestRadar({ fetchImpl: f.fn, storage: fakeStorage(), now: () => 1000 });
    expect(stale).toBe(false);
    expect(radar.volume).toBe(34);
    expect(radar.blips).toHaveLength(118);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toContain('api.github.com');
    expect(f.calls[1]).toBe(`${RAW}${encodeURIComponent(V34)}`);
  });

  it('serves a fresh cache without any network call', async () => {
    const storage = fakeStorage();
    const first = fakeFetch(listing([V34]));
    await loadLatestRadar({ fetchImpl: first.fn, storage, now: () => 0 });
    const second = fakeFetch(listing([V34]));
    const { radar, stale } = await loadLatestRadar({ fetchImpl: second.fn, storage, now: () => DAY - 1 });
    expect(second.calls).toHaveLength(0);
    expect(stale).toBe(false);
    expect(radar.blips).toHaveLength(118);
  });

  it('after 24 h checks for a newer volume, and does not re-download the same one', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V34])).fn, storage, now: () => 0 });
    const again = fakeFetch(listing([V34]));
    await loadLatestRadar({ fetchImpl: again.fn, storage, now: () => DAY + 1 });
    expect(again.calls).toHaveLength(1);
    expect(again.calls[0]).toContain('api.github.com');
  });

  it('replaces an older cached volume with a newer one', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V33])).fn, storage, now: () => 0 });
    expect([...storage.map.keys()].some(k => k.includes('Volume 33'))).toBe(true);
    const { radar } = await loadLatestRadar({ fetchImpl: fakeFetch(listing([V33, V34])).fn, storage, now: () => DAY + 1 });
    expect(radar.volume).toBe(34);
    expect([...storage.map.keys()].some(k => k.includes('Volume 33'))).toBe(false);
  });

  it('shows the saved copy, marked stale, when GitHub cannot be reached', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V34])).fn, storage, now: () => 0 });
    const down = fakeFetch([], DATA, 403);
    const { radar, stale } = await loadLatestRadar({ fetchImpl: down.fn, storage, now: () => 5 * DAY });
    expect(stale).toBe(true);
    expect(radar.blips).toHaveLength(118);
  });

  it('says what went wrong when GitHub fails and nothing is saved', async () => {
    const down = fakeFetch([], DATA, 403);
    await expect(loadLatestRadar({ fetchImpl: down.fn, storage: fakeStorage() })).rejects.toThrow(/GitHub answered 403/);
    const offline = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(loadLatestRadar({ fetchImpl: offline, storage: fakeStorage() })).rejects.toThrow(RadarLoadError);
  });

  it('does not accept a volume with no usable technologies: it keeps the last good copy (a renamed quadrant would otherwise empty the page for a day)', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V33])).fn, storage, now: () => 0 });
    const renamed = JSON.stringify((sample as any[]).map(b => ({ ...b, quadrant: 'dev-tools' })));
    const { radar, stale } = await loadLatestRadar({ fetchImpl: fakeFetch(listing([V33, V34]), renamed).fn, storage, now: () => DAY + 1 });
    expect(stale).toBe(true);
    expect(radar.volume).toBe(33);
    expect([...storage.map.keys()].some(k => k.includes('Volume 34'))).toBe(false); // the bad one was not saved
  });

  it('says so when a new volume is unusable and nothing is saved', async () => {
    const renamed = JSON.stringify((sample as any[]).map(b => ({ ...b, ring: 'discontinued' })));
    await expect(loadLatestRadar({ fetchImpl: fakeFetch(listing([V34]), renamed).fn, storage: fakeStorage() })).rejects.toThrow(/looks wrong: 0 usable/);
  });

  it('replaces a corrupt saved copy instead of failing on it for ever', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V34])).fn, storage, now: () => 0 });
    storage.map.set(`techradar:v1:data:${V34}`, '{broken');
    const f = fakeFetch(listing([V34]));
    const { radar, stale } = await loadLatestRadar({ fetchImpl: f.fn, storage, now: () => 1 });
    expect(radar.blips).toHaveLength(118);
    expect(stale).toBe(false);
    expect(f.calls).toHaveLength(2); // it downloaded the data again
    expect(storage.map.get(`techradar:v1:data:${V34}`)).toBe(DATA);
  });

  it('gives up on a GitHub that does not answer, and uses the saved copy', async () => {
    const storage = fakeStorage();
    await loadLatestRadar({ fetchImpl: fakeFetch(listing([V34])).fn, storage, now: () => 0 });
    const hang = jest.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const { radar, stale } = await loadLatestRadar({ fetchImpl: hang, storage, now: () => 2 * DAY, timeoutMs: 30 });
    expect(stale).toBe(true);
    expect(radar.blips).toHaveLength(118);
    await expect(loadLatestRadar({ fetchImpl: hang, storage: fakeStorage(), timeoutMs: 30 })).rejects.toThrow(/did not answer within/);
  });

  it('still reports a real abort as an abort when the timeout is set', async () => {
    const controller = new AbortController();
    const hang = jest.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const pending = loadLatestRadar({ fetchImpl: hang, storage: fakeStorage(), timeoutMs: 10_000 }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses a download link that is not on the expected host', async () => {
    const f = fakeFetch(listing([V34], 'https://evil.example/'));
    await expect(loadLatestRadar({ fetchImpl: f.fn, storage: fakeStorage() })).rejects.toThrow(/expected host/);
    expect(f.calls).toHaveLength(1); // the data was never requested
  });

  it('rejects data that is not valid JSON', async () => {
    const f = fakeFetch(listing([V34]), 'not json');
    await expect(loadLatestRadar({ fetchImpl: f.fn, storage: fakeStorage() })).rejects.toThrow(/could not be read/);
  });

  it('ignores a corrupt cache entry and fetches fresh', async () => {
    const storage = fakeStorage();
    storage.map.set('techradar:v1:latest', '{broken');
    const f = fakeFetch(listing([V34]));
    const { radar } = await loadLatestRadar({ fetchImpl: f.fn, storage, now: () => 0 });
    expect(radar.blips).toHaveLength(118);
    expect(f.calls).toHaveLength(2);
  });

  it('lets an abort through as an abort (not a load error)', async () => {
    const aborted = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    await expect(loadLatestRadar({ fetchImpl: aborted, storage: fakeStorage() })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('works when the browser blocks storage', async () => {
    const f = fakeFetch(listing([V34]));
    const { radar } = await loadLatestRadar({ fetchImpl: f.fn, storage: null });
    expect(radar.blips).toHaveLength(118);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const g = fakeFetch(listing([V34]));
    expect((await loadLatestRadar({ fetchImpl: g.fn, storage: throwing })).radar.blips).toHaveLength(118);
  });
});
