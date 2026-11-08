import { ActivityQueue, ActivityQueueOptions, entryKey } from './activityQueue';
import type { TraineeActivityItem } from '../../api/types';

const item = (key: string, over: Partial<TraineeActivityItem> = {}): TraineeActivityItem => ({
  key,
  repoUrl: `https://github.com/o/${key}`,
  fetchedAt: '2026-11-07T10:00:00.000Z',
  code: 'ok',
  ...over,
});
const target = (key: string) => ({ key, repoUrl: `https://github.com/o/${key}` });
const targets = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => target(`${prefix}${String(i).padStart(3, '0')}`));
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A fetchChunk whose answers the test releases by hand, so it can look at the queue in between. */
function manual() {
  const calls: Array<{ keys: string[]; refresh: boolean; resolve(items: TraineeActivityItem[]): void; reject(e: Error): void }> = [];
  const fetchChunk: ActivityQueueOptions['fetchChunk'] = (keys, refresh) =>
    new Promise((resolve, reject) => {
      calls.push({ keys, refresh, resolve, reject });
    });
  return { calls, fetchChunk };
}
const answerAll = (call: { keys: string[]; resolve(items: TraineeActivityItem[]): void }) => call.resolve(call.keys.map(k => item(k)));

describe('ActivityQueue', () => {
  const make = (extra: Partial<ActivityQueueOptions> = {}) => {
    const m = manual();
    let changes = 0;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let clock = 1_000_000;
    const queue = new ActivityQueue({
      fetchChunk: m.fetchChunk,
      onChange: () => changes++,
      now: () => clock,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => undefined,
      ...extra,
    });
    return { queue, calls: m.calls, changes: () => changes, timers, tick: (ms: number) => (clock += ms) };
  };

  it('asks for ten rows at a time, two requests at a time, and starts the next as soon as one finishes', async () => {
    const { queue, calls } = make();
    queue.enqueue(targets(45));
    expect(calls.map(c => c.keys.length)).toEqual([10, 10]); // two in flight, 25 waiting
    answerAll(calls[0]);
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].keys).toHaveLength(10);
    expect(queue.busy).toBe(35); // 20 being read and 15 waiting; the first 10 are done
  });

  it('marks rows queued, then loading, then done, and reports progress', async () => {
    const { queue, calls } = make();
    const all = targets(12);
    queue.enqueue(all);
    expect(queue.get(all[0].key, all[0].repoUrl)?.status).toBe('loading');
    expect(queue.get(all[11].key, all[11].repoUrl)?.status).toBe('loading');
    expect(queue.progress(all)).toEqual({ done: 0, total: 12 });
    answerAll(calls[0]);
    await flush();
    expect(queue.get(all[0].key, all[0].repoUrl)).toMatchObject({ status: 'done', item: { code: 'ok' } });
    expect(queue.progress(all)).toEqual({ done: 10, total: 12 });
    answerAll(calls[1]);
    await flush();
    expect(queue.progress(all)).toEqual({ done: 12, total: 12 });
    expect(queue.busy).toBe(0);
  });

  it('rows on screen go first: `front` puts them before everything already waiting', async () => {
    const { queue, calls } = make({ concurrency: 1, chunkSize: 5 });
    queue.enqueue(targets(20, 'later')); // 5 in flight, 15 waiting
    queue.enqueue(targets(5, 'visible'), { front: true });
    answerAll(calls[0]);
    await flush();
    expect(calls[1].keys.every(k => k.startsWith('visible'))).toBe(true);
  });

  it('a row already waiting is moved to the front, not asked for twice', async () => {
    const { queue, calls } = make({ concurrency: 1, chunkSize: 2 });
    queue.enqueue(targets(6)); // r000,r001 in flight; r002..r005 waiting
    queue.enqueue([target('r005')], { front: true });
    answerAll(calls[0]);
    await flush();
    expect(calls[1].keys[0]).toBe('r005');
    expect(calls.flatMap(c => c.keys).filter(k => k === 'r005')).toHaveLength(1);
  });

  it('asking again for rows that are done, loading or waiting does nothing', async () => {
    const { queue, calls } = make();
    const all = targets(3);
    queue.enqueue(all);
    queue.enqueue(all);
    expect(calls).toHaveLength(1);
    answerAll(calls[0]);
    await flush();
    queue.enqueue(all);
    expect(calls).toHaveLength(1);
  });

  it('asking again for rows that are done, loading or waiting tells nobody: no change, no new draw of the page', async () => {
    // The page asks for its visible rows every time a cell is drawn. If that said "something changed" each time, the page would draw
    // again, ask again, and never stop (this happened).
    const { queue, calls, changes } = make();
    const all = targets(3);
    queue.enqueue(all);
    const afterFirst = changes();
    queue.enqueue(all); // loading
    queue.enqueue(all, { front: true }); // loading: left alone even in front
    expect(changes()).toBe(afterFirst);
    answerAll(calls[0]);
    await flush();
    const settled = changes();
    queue.enqueue(all); // done
    queue.enqueue(all, { front: true });
    expect(changes()).toBe(settled);
  });

  it('a refresh asks again, keeps the old values on screen meanwhile, and sends refresh=true', async () => {
    const { queue, calls } = make();
    const all = targets(2);
    queue.enqueue(all);
    answerAll(calls[0]);
    await flush();
    queue.enqueue(all, { refresh: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].refresh).toBe(true);
    expect(queue.get(all[0].key, all[0].repoUrl)).toMatchObject({ status: 'loading', item: { code: 'ok' } }); // the old value is still there
  });

  it('never mixes refresh and normal rows in one request', async () => {
    const { queue, calls } = make({ concurrency: 4 });
    queue.enqueue(targets(3, 'a'));
    queue.enqueue(targets(3, 'b'), { refresh: true });
    queue.enqueue(targets(3, 'c'));
    expect(calls.map(c => [c.refresh, c.keys[0][0]])).toEqual([[false, 'a'], [true, 'b'], [false, 'c']]);
  });

  it('a late answer never replaces a newer one', async () => {
    const { queue, calls } = make();
    const t = [target('r1')];
    queue.enqueue(t);
    calls[0].resolve([item('r1', { fetchedAt: '2026-11-07T10:05:00.000Z', note: 'newer' })]);
    await flush();
    queue.enqueue(t, { refresh: true });
    calls[1].resolve([item('r1', { fetchedAt: '2026-11-07T10:01:00.000Z', note: 'older' })]);
    await flush();
    expect(queue.get('r1', t[0].repoUrl)?.item?.note).toBe('newer');
  });

  it('a row the server does not know any more is marked missing and counts as done', async () => {
    const { queue, calls } = make();
    const all = targets(3);
    queue.enqueue(all);
    calls[0].resolve([item(all[0].key), item(all[2].key)]);
    await flush();
    expect(queue.get(all[1].key, all[1].repoUrl)).toEqual({ status: 'done', missing: true });
    expect(queue.progress(all)).toEqual({ done: 3, total: 3 });
  });

  it('an answer for another repository than the row had is not used for it', async () => {
    const { queue, calls } = make();
    queue.enqueue([target('r1')]);
    calls[0].resolve([item('r1', { repoUrl: 'https://github.com/o/ANOTHER' })]);
    await flush();
    expect(queue.get('r1', 'https://github.com/o/r1')).toEqual({ status: 'done', missing: true });
  });

  it('a failed request settles its rows as unavailable (they are not asked again by themselves) and the queue goes on', async () => {
    const { queue, calls } = make({ concurrency: 1, chunkSize: 2 });
    const all = targets(4);
    queue.enqueue(all);
    calls[0].reject(new Error('Failed to load GitHub activity: Bad Gateway'));
    await flush();
    expect(queue.get(all[0].key, all[0].repoUrl)).toMatchObject({ status: 'done', item: { code: 'unavailable', note: 'Failed to load GitHub activity: Bad Gateway' } });
    expect(calls).toHaveLength(2); // the next chunk was sent
    answerAll(calls[1]);
    await flush();
    expect(queue.progress(all)).toEqual({ done: 4, total: 4 });
  });

  describe('when GitHub says slow down', () => {
    it('stops sending, asks for those rows again as a refresh once the pause is over, and shows how long it waits', async () => {
      const { queue, calls, timers } = make({ concurrency: 1, chunkSize: 2, rateLimitPauseMs: 30_000 });
      const all = targets(4);
      queue.enqueue(all);
      calls[0].resolve([item(all[0].key), item(all[1].key, { code: 'rate_limited' })]);
      await flush();
      expect(queue.pausedUntil).toBe(1_000_000 + 30_000);
      expect(calls).toHaveLength(1); // nothing more is sent while paused
      expect(queue.get(all[1].key, all[1].repoUrl)?.status).toBe('queued');
      expect(queue.get(all[0].key, all[0].repoUrl)?.status).toBe('done');
      expect(timers).toHaveLength(1);
      expect(timers[0].ms).toBe(30_000);

      timers[0].fn(); // the pause is over
      expect(queue.pausedUntil).toBeUndefined();
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ refresh: true, keys: [all[1].key] }); // the limited row goes first, as a refresh
      answerAll(calls[1]);
      await flush();
      expect(calls).toHaveLength(3);
      expect(calls[2].refresh).toBe(false);
      expect(calls[2].keys).toEqual([all[2].key, all[3].key]);
    });

    it('rows asked for during the pause wait for it', async () => {
      const { queue, calls, timers } = make();
      queue.enqueue([target('a')]);
      calls[0].resolve([item('a', { code: 'rate_limited' })]);
      await flush();
      queue.enqueue(targets(3, 'later'), { front: true });
      expect(calls).toHaveLength(1);
      timers[0].fn();
      expect(calls).toHaveLength(3); // the rows asked for meanwhile (on screen, so first) and the limited row as a refresh
      expect(calls[1]).toMatchObject({ refresh: false, keys: ['later000', 'later001', 'later002'] });
      expect(calls[2]).toMatchObject({ refresh: true, keys: ['a'] });
    });
  });

  it('dispose stops everything: nothing more is sent and late answers change nothing', async () => {
    const { queue, calls, changes } = make();
    const all = targets(30);
    queue.enqueue(all);
    queue.dispose();
    const before = changes();
    answerAll(calls[0]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(changes()).toBe(before);
    expect(queue.get(all[0].key, all[0].repoUrl)?.status).toBe('loading');
    queue.enqueue(targets(3, 'x'));
    expect(calls).toHaveLength(2);
  });

  it('keys with the same text but another repository are different entries', () => {
    expect(entryKey('lab:a::b', 'https://github.com/o/r1')).not.toBe(entryKey('lab:a::b', 'https://github.com/o/r2'));
    expect(entryKey('lab:a::b')).toBe('lab:a::b|');
  });
});
