/**
 * The newest published Backstage Agent, so the portal can tell a trainee their agent is out of
 * date. One registry call per hour at most (failures retried after 10 min); never throws — an
 * unknown latest version just means no "update available" hint.
 */
const URL = 'https://registry.npmjs.org/@stratpoint%2Fbackstage-agent/latest';
const TTL_MS = 60 * 60_000;
const ERROR_TTL_MS = 10 * 60_000;

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<any> }>;

export class LatestAgentVersion {
  private value?: string;
  private fetchedAt = 0;
  private ttl = 0;
  private inflight?: Promise<string | undefined>;

  constructor(
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string | undefined> {
    if (this.now() - this.fetchedAt < this.ttl) return this.value;
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async load(): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(URL, { signal: AbortSignal.timeout(5000) });
      const version = res.ok ? (await res.json())?.version : undefined;
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('no version');
      this.value = version;
      this.ttl = TTL_MS;
    } catch {
      this.ttl = ERROR_TTL_MS; // keep the last known value, if any
    }
    this.fetchedAt = this.now();
    return this.value;
  }
}

/** True when `current` is an older x.y.z than `latest` (anything unparseable → false). */
export function isOlderVersion(current: string | undefined, latest: string | undefined): boolean {
  const parse = (v?: string) => (v && /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number)) || undefined;
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
