import type { TraineeActivityItem } from '../../api/types';

/** What the page knows about one row's GitHub data. */
export interface ActivityEntry {
  status: 'queued' | 'loading' | 'done';
  /** The newest answer; kept while a refresh is running so the cell never goes blank. */
  item?: TraineeActivityItem;
  /** The server no longer knows this row (removed since the list was loaded). */
  missing?: boolean;
}

export interface ActivityTarget {
  key: string;
  repoUrl?: string;
}

export interface ActivityQueueOptions {
  /** Asks the server for GitHub data of up to `chunkSize` rows. */
  fetchChunk(keys: string[], refresh: boolean): Promise<TraineeActivityItem[]>;
  onChange(): void;
  chunkSize?: number;
  concurrency?: number;
  /** How long to leave GitHub alone after it said "slow down". */
  rateLimitPauseMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Pending extends ActivityTarget {
  refresh: boolean;
}

/** An entry is keyed by row AND repository: if a row's repository changes (a lab was started over) the old answer is not used for it. */
export const entryKey = (key: string, repoUrl?: string) => `${key}|${repoUrl ?? ''}`;

/**
 * Loads GitHub data for rows of the Trainees list in small chunks, a few at a time, rows that are on screen first. Plain TypeScript so
 * the rules are testable without React.
 *
 * - A row is asked for once; asking again does nothing unless `refresh` is set.
 * - When GitHub says "slow down" (a `rate_limited` item) the queue stops for a while and then asks for those rows again.
 * - A late answer never replaces a newer one (`fetchedAt`).
 * - A row the server does not know any more is marked `missing` so the page does not wait for it forever.
 */
export class ActivityQueue {
  private readonly entries = new Map<string, ActivityEntry>();
  private queue: Pending[] = [];
  private inFlight = 0;
  private timer?: unknown;
  private disposed = false;
  /** Set while the queue is waiting out a rate limit. */
  pausedUntil?: number;

  private readonly chunkSize: number;
  private readonly concurrency: number;
  private readonly pauseMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: ActivityQueueOptions) {
    this.chunkSize = opts.chunkSize ?? 10;
    this.concurrency = opts.concurrency ?? 2;
    this.pauseMs = opts.rateLimitPauseMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get(key: string, repoUrl?: string): ActivityEntry | undefined {
    return this.entries.get(entryKey(key, repoUrl));
  }

  /** Rows waiting or being read. */
  get busy(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.status !== 'done') n++;
    return n;
  }

  /** How many of these targets have an answer (or are known to have none), out of how many. */
  progress(targets: ActivityTarget[]): { done: number; total: number } {
    let done = 0;
    for (const t of targets) if (this.entries.get(entryKey(t.key, t.repoUrl))?.status === 'done') done++;
    return { done, total: targets.length };
  }

  /**
   * Asks for these rows. `front` puts them before everything already waiting (the page on screen). A row already queued or loading is
   * left alone (moved to the front if `front`); a row already answered is asked again only with `refresh`.
   */
  enqueue(targets: ActivityTarget[], opts: { front?: boolean; refresh?: boolean } = {}): void {
    if (this.disposed) return;
    const added: Pending[] = [];
    for (const t of targets) {
      const id = entryKey(t.key, t.repoUrl);
      const entry = this.entries.get(id);
      if (entry?.status === 'loading') continue;
      if (entry?.status === 'queued') {
        if (opts.front) {
          this.queue = this.queue.filter(p => entryKey(p.key, p.repoUrl) !== id);
          added.push({ ...t, refresh: opts.refresh === true });
        }
        continue;
      }
      if (entry?.status === 'done' && !opts.refresh) continue;
      this.entries.set(id, { status: 'queued', item: entry?.item });
      added.push({ ...t, refresh: opts.refresh === true });
    }
    // Nothing was added (every row was already answered or on its way): nothing changed, so nobody is told.
    if (added.length === 0) return;
    this.queue = opts.front ? [...added, ...this.queue] : [...this.queue, ...added];
    this.opts.onChange();
    this.pump();
  }

  /** Forgets everything (the list was replaced) and ignores answers still on their way. */
  dispose(): void {
    this.disposed = true;
    this.queue = [];
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private pump(): void {
    while (!this.disposed && this.pausedUntil === undefined && this.inFlight < this.concurrency && this.queue.length > 0) {
      const refresh = this.queue[0].refresh;
      const chunk: Pending[] = [];
      while (chunk.length < this.chunkSize && this.queue.length > 0 && this.queue[0].refresh === refresh) chunk.push(this.queue.shift()!);
      this.inFlight++;
      for (const t of chunk) {
        const id = entryKey(t.key, t.repoUrl);
        this.entries.set(id, { ...this.entries.get(id), status: 'loading' });
      }
      this.opts.onChange();
      void this.run(chunk, refresh);
    }
  }

  private async run(chunk: Pending[], refresh: boolean): Promise<void> {
    let items: TraineeActivityItem[] | undefined;
    let failure: string | undefined;
    try {
      items = await this.opts.fetchChunk(chunk.map(t => t.key), refresh);
    } catch (e: any) {
      failure = e?.message ?? 'Could not load GitHub activity';
    }
    this.inFlight--;
    if (this.disposed) return;

    const byKey = new Map((items ?? []).map(i => [i.key, i]));
    const limited: Pending[] = [];
    for (const t of chunk) {
      const id = entryKey(t.key, t.repoUrl);
      const previous = this.entries.get(id);
      const item = byKey.get(t.key);
      if (failure !== undefined) {
        this.entries.set(id, { status: 'done', item: { key: t.key, repoUrl: t.repoUrl, fetchedAt: new Date(this.now()).toISOString(), code: 'unavailable', note: failure } });
      } else if (!item) {
        this.entries.set(id, { status: 'done', missing: true });
      } else if (item.code === 'rate_limited') {
        // Not an answer: ask again (as a refresh, because the server remembers failures for a minute) once the pause is over.
        limited.push({ ...t, refresh: true });
        this.entries.set(id, { status: 'queued', item: previous?.item });
      } else if (item.repoUrl !== undefined && t.repoUrl !== undefined && item.repoUrl !== t.repoUrl) {
        // The server answered for another repository than the one this row had when it was asked: not for this row.
        this.entries.set(id, { status: 'done', missing: true });
      } else {
        const newer = !previous?.item || Date.parse(item.fetchedAt) >= Date.parse(previous.item.fetchedAt);
        this.entries.set(id, { status: 'done', item: newer ? item : previous.item });
      }
    }
    if (limited.length) {
      this.queue = [...limited, ...this.queue];
      this.pausedUntil = this.now() + this.pauseMs;
      if (this.timer !== undefined) this.clearTimer(this.timer);
      this.timer = this.setTimer(() => {
        this.pausedUntil = undefined;
        this.timer = undefined;
        this.opts.onChange();
        this.pump();
      }, this.pauseMs);
    }
    this.opts.onChange();
    this.pump();
  }
}
