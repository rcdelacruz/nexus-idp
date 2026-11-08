/**
 * At most `max` calls run at once; the rest wait their turn. One instance is shared by every request of the service, so the number of
 * GitHub repositories being read at the same time is bounded for the whole process, however many instructors have the page open.
 */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      // The slot is handed over by release(), so `active` never rises above `max` between a release and the waiter's turn.
      await new Promise<void>(resolve => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
