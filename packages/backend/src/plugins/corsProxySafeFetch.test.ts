import http from 'node:http';
import { AddressInfo } from 'node:net';
import { BlockedTargetError, ResponseTooLargeError, isPublicIp, proxyFetch, safeLookup } from './corsProxySafeFetch';

describe('isPublicIp', () => {
  it.each([
    // The exact addresses the old text filter let through, plus the ranges it never knew.
    '0.0.0.0', '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '169.254.170.2', '100.64.0.1', '100.127.255.255', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2002:a00:1::1', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '[::1]', 'not-an-ip', '', '999.1.1.1',
  ])('%s is not public', ip => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    '%s is public',
    ip => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );
});

describe('safeLookup', () => {
  const lookup = (host: string, options: any = {}) =>
    new Promise<{ err: any; address?: any }>(resolve => safeLookup(host, options, (err, address) => resolve({ err, address })));

  it('refuses a name that resolves to loopback', async () => {
    const r = await lookup('localhost');
    expect(r.err).toBeInstanceOf(BlockedTargetError);
  });

  it('refuses it with the all:true form http uses on Node 20+ too', async () => {
    const r = await lookup('localhost', { all: true });
    expect(r.err).toBeInstanceOf(BlockedTargetError);
  });

  it('passes a lookup failure through (an unresolvable name is not a block)', async () => {
    const r = await lookup('does-not-exist.invalid');
    expect(r.err).toBeTruthy();
    expect(r.err).not.toBeInstanceOf(BlockedTargetError);
  });
});

// A local server stands in for "the internet". The test seams (`lookup`, `allowLiteralIp`) let it be reached; the production
// defaults are exercised in the "defaults" block below.
describe('proxyFetch', () => {
  let server: http.Server;
  let other: http.Server; // a second origin (another port), for cross-origin redirects
  const seenOther: http.IncomingHttpHeaders[] = [];
  let base: string;
  let seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];

  const allowLocal = (ip: string) => ip === '127.0.0.1';
  const localLookup = (_host: string, options: any, cb: any) => (options?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
  const opts = (path: string, extra: Record<string, unknown> = {}) => ({
    url: `${base}${path}`,
    method: 'GET',
    headers: {} as Record<string, string>,
    maxBytes: 1024,
    timeoutMs: 2000,
    maxRedirects: 3,
    lookup: localLookup as any,
    allowLiteralIp: allowLocal,
    ...extra,
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url === '/ok') {
          res.setHeader('x-extra', '1');
          res.end('hello');
        } else if (req.url === '/big') {
          res.end('x'.repeat(5000));
        } else if (req.url === '/to-ok') {
          res.writeHead(302, { location: '/ok' }).end();
        } else if (req.url === '/to-metadata') {
          res.writeHead(302, { location: 'http://169.254.170.2/v2/credentials' }).end();
        } else if (req.url === '/to-loopback-v6') {
          res.writeHead(302, { location: 'http://[::1]:7007/' }).end();
        } else if (req.url === '/loop') {
          res.writeHead(302, { location: '/loop' }).end();
        } else if (req.url === '/to-post-303') {
          res.writeHead(303, { location: '/ok' }).end();
        } else if (req.url === '/slow') {
          setTimeout(() => res.end('late'), 3000);
        } else if (req.url === '/drip') {
          // A byte every 100 ms for 4 s: never idle for long, never finished.
          res.write('x');
          const t = setInterval(() => res.write('x'), 100);
          setTimeout(() => { clearInterval(t); res.end(); }, 4000);
          res.on('close', () => clearInterval(t));
        } else if (req.url === '/to-other-origin') {
          res.writeHead(302, { location: `http://127.0.0.1:${other.address() ? (other.address() as AddressInfo).port : 0}/ok` }).end();
        } else {
          res.statusCode = 404;
          res.end('nope');
        }
      });
    });
    other = http.createServer((req, res) => {
      seenOther.push(req.headers);
      res.end('other');
    });
    await new Promise<void>(r => other.listen(0, '127.0.0.1', r));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    other.closeAllConnections?.();
    await new Promise<void>(r => server.close(() => r()));
    await new Promise<void>(r => other.close(() => r()));
  });
  beforeEach(() => {
    seen = [];
  });

  it('returns status, headers and the body', async () => {
    const r = await proxyFetch(opts('/ok'));
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('hello');
    expect(r.headers['x-extra']).toBe('1');
  });

  it('follows a redirect to an allowed place', async () => {
    const r = await proxyFetch(opts('/to-ok'));
    expect(r.body.toString()).toBe('hello');
  });

  it('refuses a redirect to the ECS metadata address', async () => {
    await expect(proxyFetch(opts('/to-metadata'))).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it('refuses a redirect to IPv6 loopback', async () => {
    await expect(proxyFetch(opts('/to-loopback-v6'))).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it('stops a redirect loop', async () => {
    await expect(proxyFetch(opts('/loop'))).rejects.toThrow('Too many redirects');
    expect(seen.length).toBe(4); // first request + 3 redirects, then it gives up
  });

  it('refuses a response over the limit', async () => {
    await expect(proxyFetch(opts('/big'))).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('gives up on a target that does not answer', async () => {
    await expect(proxyFetch(opts('/slow', { timeoutMs: 300 }))).rejects.toThrow();
  });

  it('gives up on a target that keeps dripping bytes: the limit is on the whole fetch, not on idle time', async () => {
    const started = Date.now();
    await expect(proxyFetch(opts('/drip', { timeoutMs: 300, totalTimeoutMs: 700, maxBytes: 10_000 }))).rejects.toThrow(/too long/);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('a cross-origin redirect carries no credential headers of any name; a same-origin one keeps them', async () => {
    const headers = { authorization: 'Bearer k', 'x-auth-token': 't', cookie: 'a=b', 'x-api-key': 'k', accept: 'application/json' };
    await proxyFetch(opts('/to-other-origin', { headers }));
    expect(seenOther[0].accept).toBe('application/json');
    for (const h of ['authorization', 'x-auth-token', 'cookie', 'x-api-key']) expect(seenOther[0][h]).toBeUndefined();
    await proxyFetch(opts('/to-ok', { headers }));
    expect(seen[seen.length - 1].headers['x-auth-token']).toBe('t');
  });

  it('sends the body and a content-length', async () => {
    await proxyFetch(opts('/ok', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }));
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toBe('{"a":1}');
    expect(seen[0].headers['content-length']).toBe('7');
  });

  it('turns a 303 into a GET without the body', async () => {
    await proxyFetch(opts('/to-post-303', { method: 'POST', body: 'data', headers: { 'content-type': 'text/plain' } }));
    expect(seen[1].method).toBe('GET');
    expect(seen[1].body).toBe('');
    expect(seen[1].headers['content-type']).toBeUndefined();
  });

  it('keeps the target credential on a same-origin redirect', async () => {
    await proxyFetch(opts('/to-ok', { headers: { authorization: 'Bearer target-key' } }));
    expect(seen[1].headers.authorization).toBe('Bearer target-key');
  });

  it('refuses credentials written in the URL and non-http schemes', async () => {
    await expect(proxyFetch(opts('/ok', { url: `http://user:pw@127.0.0.1:1/` }))).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(proxyFetch(opts('/ok', { url: 'file:///etc/passwd' }))).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(proxyFetch(opts('/ok', { url: 'ftp://example.com/x' }))).rejects.toBeInstanceOf(BlockedTargetError);
  });

  describe('production defaults (no test seams)', () => {
    const real = (url: string) => ({ url, method: 'GET', headers: {}, maxBytes: 1024, timeoutMs: 2000, maxRedirects: 3 });

    it.each([
      'http://0.0.0.0:7007/',
      'http://[::1]:7007/',
      'http://169.254.170.2/v2/credentials',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://[::ffff:7f00:1]/',
      'http://127.0.0.1:1/',
      'http://2130706433/', // 127.0.0.1 written as one number
      'http://localhost:7007/',
      'http://localhost.:7007/',
    ])('refuses %s', async url => {
      await expect(proxyFetch(real(url))).rejects.toBeInstanceOf(BlockedTargetError);
    });

    it('does not turn an unresolvable in-cluster name into a connection', async () => {
      await expect(proxyFetch(real('http://kubernetes.default.svc/'))).rejects.toBeTruthy();
    });
  });
});
