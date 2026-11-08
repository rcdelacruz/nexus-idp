import { Limiter } from './limiter';

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('Limiter', () => {
  it('runs at most `max` calls at once, however many are queued, and runs them all', async () => {
    const limiter = new Limiter(3);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(done).toHaveLength(25);
  });

  it('starts waiting calls in the order they arrived', async () => {
    const limiter = new Limiter(1);
    const started: number[] = [];
    await Promise.all([0, 1, 2, 3].map(i => limiter.run(async () => { started.push(i); await tick(); })));
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('a call that arrives while a slot is being handed over does not take an extra slot', async () => {
    // The release and the waiter's turn are separate microtasks; a new call in between must queue, not run.
    const limiter = new Limiter(1);
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };
    const first = limiter.run(work);
    const second = limiter.run(work); // waits
    await first; // the slot is handed to `second` in the same turn in which this resolves
    const third = limiter.run(work); // arrives right after the hand-over
    await Promise.all([second, third]);
    expect(peak).toBe(1);
  });

  it('a call that throws gives its slot back, and the error reaches the caller', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
    const results = await Promise.allSettled([
      limiter.run(async () => { throw new Error('a'); }),
      limiter.run(async () => 'b'),
      limiter.run(async () => 'c'),
    ]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });

  it('returns what the call returns', async () => {
    expect(await new Limiter(2).run(async () => 42)).toBe(42);
  });

  it('never goes negative: a long run of calls leaves it ready for a full set again', async () => {
    const limiter = new Limiter(2);
    for (let round = 0; round < 5; round++) await Promise.all(Array.from({ length: 7 }, () => limiter.run(tick)));
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => limiter.run(async () => { active++; peak = Math.max(peak, active); await tick(); active--; })));
    expect(peak).toBe(2);
  });
});
