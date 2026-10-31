/**
 * What this machine can run, reported to the portal on every poll so labs can stop early with a
 * clear fix ("Docker has 2 GB, this lab needs 4 GB") instead of half-starting. Docker's own view
 * matters, not the host's: on Mac/Windows, Docker Desktop runs in a VM with its own memory limit.
 */
import { execFile } from 'child_process';

export interface Capabilities {
  arch: string;
  cpus?: number;
  dockerMemoryBytes?: number;
  dockerOs?: string;
}

export function parseDockerInfo(json: string): Omit<Capabilities, 'arch'> {
  try {
    const d = JSON.parse(json);
    return {
      cpus: Number.isInteger(d.NCPU) && d.NCPU > 0 ? d.NCPU : undefined,
      dockerMemoryBytes: Number.isFinite(d.MemTotal) && d.MemTotal > 0 ? d.MemTotal : undefined,
      dockerOs: d.OSType === 'linux' || d.OSType === 'windows' ? d.OSType : undefined,
    };
  } catch {
    return {};
  }
}

const dockerInfo = (): Promise<string> =>
  new Promise(resolve =>
    execFile('docker', ['info', '--format', '{{json .}}'], { timeout: 15_000 }, (err, stdout) => resolve(err ? '' : String(stdout))),
  );

let cache: { at: number; value: Capabilities } | undefined;

/** Cached for 10 minutes (Docker Desktop's limit can change when the trainee raises it). */
export async function getCapabilities(now = Date.now()): Promise<Capabilities> {
  if (cache && now - cache.at < 10 * 60_000) return cache.value;
  const value: Capabilities = { arch: process.arch, ...parseDockerInfo(await dockerInfo()) };
  cache = { at: now, value };
  return value;
}

/** Poll query parameters for the capabilities (only the ones known). */
export function capabilitiesQuery(c: Capabilities): string {
  const p: string[] = [`arch=${encodeURIComponent(c.arch)}`];
  if (c.cpus) p.push(`cpus=${c.cpus}`);
  if (c.dockerMemoryBytes) p.push(`dockerMem=${c.dockerMemoryBytes}`);
  if (c.dockerOs) p.push(`dockerOs=${c.dockerOs}`);
  return p.join('&');
}
