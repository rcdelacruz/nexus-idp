import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Outbound fetch for the CORS proxy that can only reach the public internet.
 *
 * Why not `fetch`: a host-name filter on the URL (what the proxy used to do) is bypassed by `0.0.0.0`, `[::1]`, the ECS task
 * metadata address, in-cluster DNS names, a public name that resolves to a private address, and a redirect to any of those.
 * Here every connection goes through `safeLookup`, which looks the name up itself and refuses the request when ANY address it
 * resolves to is not a public one. The address that was checked is the address that is connected to (no second lookup, so DNS
 * rebinding cannot swap it). Redirects are followed by hand and every hop is checked the same way.
 */

// IPv4: every range that is not routable public unicast. (Node's BlockList treats an IPv4 address as an IPv4-mapped IPv6 one,
// so IPv6 is judged separately below, with no BlockList, to keep the two from catching each other.)
const NOT_PUBLIC_V4 = new net.BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT, also used by Tailscale
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud and ECS metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
for (const [addr, prefix] of V4) NOT_PUBLIC_V4.addSubnet(addr, prefix, 'ipv4');

/** The 16 bytes of an IPv6 address (zone id and an embedded dotted IPv4 tail handled), or undefined. */
function ipv6Bytes(ip: string): number[] | undefined {
  let text = ip.split('%')[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return undefined;
    const o = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 0xff);
  }
  return out.length === 16 ? out : undefined;
}

/**
 * IPv6: only global unicast (2000::/3) is public, minus the ranges inside it that embed an IPv4 address or are not globally
 * routed: the IETF protocol block 2001:0000-2001:01ff (Teredo, benchmarking, ORCHID...), documentation 2001:db8::/32 and
 * 3fff::/20, and 6to4 2002::/16. Everything else (loopback, unspecified, IPv4-mapped, NAT64, unique-local, link-local,
 * multicast, the deprecated compatible forms) is outside 2000::/3 and so refused.
 */
function isPublicV6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return false;
  if ((b[0] & 0xe0) !== 0x20) return false;
  const first = (b[0] << 8) | b[1];
  const second = (b[2] << 8) | b[3];
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && second <= 0x0fff) return false;
  return true;
}

/** True only for a public unicast IPv4/IPv6 address. Anything it cannot parse is not public. */
export function isPublicIp(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (net.isIPv4(bare)) {
    try {
      return !NOT_PUBLIC_V4.check(bare, 'ipv4');
    } catch {
      return false;
    }
  }
  if (net.isIPv6(bare)) return isPublicV6(bare);
  return false;
}

export class BlockedTargetError extends Error {
  readonly code = 'EBLOCKED';
}

export class ResponseTooLargeError extends Error {
  readonly code = 'ETOOLARGE';
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void;
export type LookupFn = (hostname: string, options: any, callback: LookupCallback) => void;

/** `dns.lookup` that refuses to answer when any resolved address is not public. */
export const safeLookup: LookupFn = (hostname, options, callback) => {
  const opts = typeof options === 'function' ? {} : options ?? {};
  const cb: LookupCallback = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as unknown as dns.LookupAddress[];
    if (list.length === 0 || list.some(a => !isPublicIp(a.address))) {
      return cb(new BlockedTargetError(`${hostname} does not resolve to a public address`));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
};

export interface ProxyFetchOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  maxBytes: number;
  /** Idle time on a connection before giving up. */
  timeoutMs: number;
  /** Total time for the whole fetch, all redirects included. An idle timeout alone lets a target drip a byte at a time forever. */
  totalTimeoutMs?: number;
  maxRedirects: number;
  /** Test seam. Production always uses `safeLookup`. */
  lookup?: LookupFn;
  /** Test seam: skip the literal-IP check (tests talk to a local server). Production never sets it. */
  allowLiteralIp?: (ip: string) => boolean;
}

export interface ProxyFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function assertTarget(url: URL, allowLiteralIp: (ip: string) => boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedTargetError('Only http and https targets are allowed');
  }
  if (url.username || url.password) {
    throw new BlockedTargetError('Credentials in the URL are not allowed');
  }
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  // An IP written in the URL never reaches the lookup (the socket connects straight to it), so check it here.
  if (net.isIP(host) && !allowLiteralIp(host)) {
    throw new BlockedTargetError(`${host} is not a public address`);
  }
}

function once(opts: ProxyFetchOptions, url: URL, method: string, headers: Record<string, string>, deadline: number, body?: string | Buffer) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error('The target took too long'));
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: body === undefined ? headers : { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        agent: false, // no keep-alive pool shared between callers
        lookup: (opts.lookup ?? safeLookup) as any,
        timeout: opts.timeoutMs,
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            reject(new ResponseTooLargeError(`Response too large (limit: ${opts.maxBytes} bytes)`));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('The target did not answer in time')));
    // The whole fetch, not just one idle gap: a target that sends a byte every few seconds must not hold the connection open.
    const overall = setTimeout(() => req.destroy(new Error('The target took too long')), remaining);
    req.on('close', () => clearTimeout(overall));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Fetch `url` through `safeLookup`, following redirects by hand and checking every hop. Never touches a private address. */
export async function proxyFetch(opts: ProxyFetchOptions): Promise<ProxyFetchResult> {
  const allowLiteralIp = opts.allowLiteralIp ?? isPublicIp;
  let url = new URL(opts.url);
  let method = opts.method;
  let headers = { ...opts.headers };
  let body = opts.body;
  const deadline = Date.now() + (opts.totalTimeoutMs ?? 30_000);

  for (let hop = 0; ; hop++) {
    assertTarget(url, allowLiteralIp);
    const result = await once(opts, url, method, headers, deadline, body);
    const location = result.headers.location;
    if (!REDIRECT.has(result.status) || !location) {
      return { ...result, finalUrl: url.toString() };
    }
    if (hop >= opts.maxRedirects) throw new BlockedTargetError('Too many redirects');
    const next = new URL(location, url);
    // A credential meant for one origin must not follow a redirect to another, whatever the header is called (x-auth-token, a cookie
    // the user typed...): only plain content negotiation headers continue.
    if (next.origin !== url.origin) {
      const carryOver = new Set(['accept', 'accept-language', 'accept-encoding', 'user-agent', 'content-type']);
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => carryOver.has(k.toLowerCase())));
    }
    if (result.status === 303 || ((result.status === 301 || result.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !['content-type', 'content-length'].includes(k.toLowerCase())));
    }
    url = next;
  }
}
