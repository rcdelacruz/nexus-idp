/**
 * Loads the latest Thoughtworks Technology Radar volume from GitHub, in the browser.
 *
 * GitHub's unauthenticated API allows 60 requests an hour per IP, and a whole office shares one,
 * so the result is cached in localStorage for 24 h and a stale copy is served if GitHub can't be
 * reached: the page degrades to "showing a saved copy" instead of going blank.
 */
import { Radar, VolumeMeta, parseRadar } from './radarModel';

const VOLUMES_API = 'https://api.github.com/repos/setchy/thoughtworks-tech-radar-volumes/contents/volumes/json';
const RAW_PREFIX = 'https://raw.githubusercontent.com/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LATEST_KEY = 'techradar:v1:latest';
const dataKey = (fileName: string) => `techradar:v1:data:${fileName}`;

export class RadarLoadError extends Error {}

interface GitHubFile {
  name: string;
  download_url: string | null;
}

interface Latest {
  at: number;
  fileName: string;
  downloadUrl: string;
}

export interface RadarSourceDeps {
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  /** How long to wait for GitHub before using the saved copy (tests shorten it). */
  timeoutMs?: number;
}

/** "Thoughtworks Technology Radar Volume 33 (Nov 2025).json" -> { volume: 33, label: "Vol. 33 · November 2025" } */
export function parseVolumeName(filename: string): VolumeMeta | null {
  const m = filename.match(/Volume\s+(\d+)\s+\((\w+)\s+(\d{4})\)/i);
  if (!m) return null;
  const volume = parseInt(m[1], 10);
  const date = new Date(`${m[2]} 1, ${m[3]}`);
  const month = Number.isNaN(date.getTime()) ? m[2] : date.toLocaleString('en-US', { month: 'long' });
  return { volume, label: `Vol. ${volume} · ${month} ${m[3]}` };
}

function defaultStorage(): RadarSourceDeps['storage'] {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // blocked site data
  }
}

function read(storage: RadarSourceDeps['storage'], key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: RadarSourceDeps['storage'], key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // quota or blocked: the page works without the cache
  }
}

function readLatest(storage: RadarSourceDeps['storage']): Latest | undefined {
  const raw = read(storage, LATEST_KEY);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.at === 'number' && typeof v.fileName === 'string' && typeof v.downloadUrl === 'string') return v;
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Parses a volume, and refuses one that is empty or mostly unreadable: if Thoughtworks renamed a
 * quadrant or ring, every item would be skipped, and an empty radar must not replace (or be cached
 * over) the last good one.
 */
function build(text: string, fileName: string): Radar {
  const meta = parseVolumeName(fileName);
  if (!meta) throw new RadarLoadError(`Unexpected radar file name: ${fileName}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RadarLoadError('The radar data could not be read');
  }
  const { radar, skipped } = parseRadar(json, meta);
  if (radar.blips.length === 0 || skipped > radar.blips.length) {
    throw new RadarLoadError(`The radar data looks wrong: ${radar.blips.length} usable technologies, ${skipped} unreadable`);
  }
  return radar;
}

const FETCH_TIMEOUT_MS = 8000;

/** fetch with a deadline, so a network that drops packets falls back to the saved copy instead of waiting forever. */
async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, signal: AbortSignal | undefined, ms: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RadarLoadError(`GitHub did not answer within ${ms / 1000} seconds`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function loadLatestRadar(
  deps: RadarSourceDeps = {},
  signal?: AbortSignal,
): Promise<{ radar: Radar; stale: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;

  let cached = readLatest(storage);
  let cachedText = cached ? read(storage, dataKey(cached.fileName)) : null;

  if (cached && cachedText) {
    try {
      const radar = build(cachedText, cached.fileName);
      if (now() - cached.at < CACHE_TTL_MS) return { radar, stale: false };
    } catch {
      // A corrupt saved copy is worth nothing: forget it, so it is neither reused as "the same
      // volume" below nor offered as a stale fallback, and the fresh download replaces it.
      cached = undefined;
      cachedText = null;
    }
  }

  try {
    const listRes = await fetchWithTimeout(fetchImpl, VOLUMES_API, signal, timeoutMs);
    if (!listRes.ok) throw new RadarLoadError(`GitHub answered ${listRes.status} when listing the radar volumes`);
    const files = (await listRes.json()) as GitHubFile[];
    const latest = (Array.isArray(files) ? files : [])
      .map(f => ({ f, meta: parseVolumeName(f.name) }))
      .filter((x): x is { f: GitHubFile; meta: VolumeMeta } => x.meta !== null && !!x.f.download_url)
      .sort((a, b) => b.meta.volume - a.meta.volume)[0];
    if (!latest) throw new RadarLoadError('No radar volumes were found');
    const downloadUrl = latest.f.download_url!;
    if (!downloadUrl.startsWith(RAW_PREFIX)) throw new RadarLoadError('The radar data is not on the expected host');

    let text = latest.f.name === cached?.fileName ? cachedText : null;
    if (!text) {
      const dataRes = await fetchWithTimeout(fetchImpl, downloadUrl, signal, timeoutMs);
      if (!dataRes.ok) throw new RadarLoadError(`GitHub answered ${dataRes.status} when loading the radar data`);
      text = await dataRes.text();
    }
    const radar = build(text, latest.f.name);

    write(storage, dataKey(latest.f.name), text);
    write(storage, LATEST_KEY, JSON.stringify({ at: now(), fileName: latest.f.name, downloadUrl }));
    if (cached && cached.fileName !== latest.f.name) {
      try {
        storage?.removeItem(dataKey(cached.fileName));
      } catch {
        // ignore
      }
    }
    return { radar, stale: false };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    if (cached && cachedText) {
      try {
        return { radar: build(cachedText, cached.fileName), stale: true };
      } catch {
        // nothing usable cached
      }
    }
    throw error instanceof RadarLoadError
      ? error
      : new RadarLoadError(`Could not reach GitHub to load the radar (${(error as Error)?.message ?? 'network error'})`);
  }
}
