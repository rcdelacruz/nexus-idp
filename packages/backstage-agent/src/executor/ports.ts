/**
 * Port pre-flight for Docker labs: find the host ports a lab publishes and check they are free
 * before pulling images, so a taken port fails in seconds with a clear message instead of a
 * Docker "port is already allocated" buried in the compose output after a long pull.
 */
import * as net from 'net';

export interface PublishedPort {
  service: string;
  port: number;
  hostIp: string;
}

/** Published TCP host ports from `docker compose config --format json`. */
export function parsePublishedPorts(configJson: string): PublishedPort[] {
  let config: any;
  try {
    config = JSON.parse(configJson);
  } catch {
    return [];
  }
  const out: PublishedPort[] = [];
  for (const [service, def] of Object.entries<any>(config?.services ?? {})) {
    for (const p of def?.ports ?? []) {
      const port = Number(p?.published);
      if (!Number.isInteger(port) || port <= 0 || (p.protocol && p.protocol !== 'tcp')) continue; // unpublished → Docker picks one
      out.push({ service, port, hostIp: p.host_ip || '0.0.0.0' });
    }
  }
  return out;
}

export type TryBind = (port: number, host: string) => Promise<'free' | 'in-use' | 'unknown'>;

/** Bind and release; only EADDRINUSE counts as taken (permission or odd errors never block a lab). */
export const tryBind: TryBind = (port, host) =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once('error', (e: any) => resolve(e?.code === 'EADDRINUSE' ? 'in-use' : 'unknown'));
    server.once('listening', () => server.close(() => resolve('free')));
    server.listen(port, host);
  });

export async function findPortConflicts(ports: PublishedPort[], bind: TryBind = tryBind): Promise<PublishedPort[]> {
  const taken: PublishedPort[] = [];
  for (const p of ports) if ((await bind(p.port, p.hostIp)) === 'in-use') taken.push(p);
  return taken;
}

const findCommand = (port: number) =>
  process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;

/** The message a trainee sees: which service, which port, what to do. */
export function portConflictMessage(taken: PublishedPort[]): string {
  const list = taken.map(p => `${p.port} (${p.service})`).join(', ');
  return (
    `${taken.length === 1 ? 'Port' : 'Ports'} ${list} ${taken.length === 1 ? 'is' : 'are'} already in use on this machine, so the lab can't start. ` +
    `Provision it again with ${taken.length === 1 ? 'another port' : 'other ports'} in the form, or stop the program using ${taken.length === 1 ? 'it' : 'them'} ` +
    `(find it with: ${findCommand(taken[0].port)}).`
  );
}

/** Docker's own wording when a port is taken at `up` time (a race, or a check that couldn't run). */
export function portInUseFromDockerError(text: string): number | undefined {
  const m = /(?:Bind for [^\s]*:(\d+) failed: port is already allocated|listen tcp4? [^\s]*:(\d+): bind: address already in use)/.exec(text);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

const CONNECTION_SCHEMES = /^(postgresql|postgres|redis|rediss|mongodb|mysql|http|https|kafka|amqp):\/\//;

/**
 * A template's own connection string: config.connection = { service, url } where url contains
 * "{port}" (that service's published port). Known schemes and localhost/127.0.0.1 only;
 * anything else is ignored and the generic string stays.
 */
export function templateConnection(spec: unknown, ports: Record<string, number>): string | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const { service, url } = spec as { service?: unknown; url?: unknown };
  if (typeof service !== 'string' || typeof url !== 'string' || url.length > 300) return undefined;
  if (!CONNECTION_SCHEMES.test(url) || !url.includes('{port}')) return undefined;
  const port = Object.prototype.hasOwnProperty.call(ports, service) ? ports[service] : undefined;
  if (!port) return undefined;
  const filled = url.split('{port}').join(String(port));
  try {
    const host = new URL(filled.replace(/^kafka:/, 'http:')).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return undefined;
  } catch {
    return undefined;
  }
  return filled;
}
