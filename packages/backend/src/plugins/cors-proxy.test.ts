import request from 'supertest';
import { mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import corsProxyPlugin, { buildTargetHeaders, passableResponseHeaders } from './cors-proxy';

jest.setTimeout(60_000);

describe('cors-proxy plugin (the real plugin in a test backend, default auth)', () => {
  let server: any;
  beforeAll(async () => {
    // The test backend treats a request with no Authorization header as a signed-in user unless told otherwise.
    // Production has no such default, so make "no header" mean "nobody" here.
    ({ server } = await startTestBackend({
      features: [corsProxyPlugin, mockServices.httpAuth.factory({ defaultCredentials: mockCredentials.none() })],
    }));
  });

  it('is NOT reachable without a login (it used to answer anyone on the internet)', async () => {
    const res = await request(server).get('/api/cors-proxy/forward').query({ url: 'http://example.com/' });
    expect(res.status).toBe(401);
    // And no outbound request was made on the caller's behalf: the body is the framework's error, not a proxied page.
    expect(res.text).not.toContain('Example Domain');
  });

  it('refuses a service credential (only a signed-in person may use it)', async () => {
    const res = await request(server)
      .get('/api/cors-proxy/forward')
      .query({ url: 'http://example.com/' })
      .set('Authorization', mockCredentials.service.header());
    expect(res.status).toBe(403);
  });

  it('answers a signed-in user: 400 without a url', async () => {
    const res = await request(server).get('/api/cors-proxy/forward').set('Authorization', mockCredentials.user.header());
    expect(res.status).toBe(400);
  });

  it.each([
    'http://0.0.0.0:7007/',
    'http://[::1]:7007/',
    'http://169.254.170.2/v2/credentials',
    'http://127.0.0.1:7007/',
    'http://localhost:7007/',
  ])('a signed-in user still cannot reach %s', async target => {
    const res = await request(server)
      .get('/api/cors-proxy/forward')
      .query({ url: target })
      .set('Authorization', mockCredentials.user.header());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Target host not allowed' });
  });

  it('rejects non-http schemes and garbage', async () => {
    const auth = mockCredentials.user.header();
    expect((await request(server).get('/api/cors-proxy/forward').query({ url: 'file:///etc/passwd' }).set('Authorization', auth)).status).toBe(400);
    expect((await request(server).get('/api/cors-proxy/forward').query({ url: 'not a url' }).set('Authorization', auth)).status).toBe(400);
  });
});

describe('buildTargetHeaders', () => {
  it('never passes the portal login token, cookies or proxy headers to the target', () => {
    const out = buildTargetHeaders({
      authorization: 'Bearer portal-user-token',
      cookie: 'session=1',
      host: 'portal',
      origin: 'https://portal',
      referer: 'https://portal/x',
      'x-forwarded-for': '1.2.3.4',
      'cf-connecting-ip': '1.2.3.4',
      'sec-fetch-site': 'same-origin',
      'accept-encoding': 'gzip',
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': 'k',
    });
    expect(out).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'x-api-key': 'k', 'accept-encoding': 'identity' });
  });

  it('carries the credential meant for the target in X-Target-Authorization', () => {
    const out = buildTargetHeaders({ authorization: 'Bearer portal-user-token', 'x-target-authorization': 'Bearer api-key' });
    expect(out.authorization).toBe('Bearer api-key');
    expect(out['x-target-authorization']).toBeUndefined();
  });
});

describe('passableResponseHeaders', () => {
  it('drops what would act on the portal origin: cookies, CORS, CSP, HSTS, framing and redirects', () => {
    const out = passableResponseHeaders({
      'content-type': 'application/json',
      etag: '"x"',
      'set-cookie': ['a=1; Domain=.portal'],
      'access-control-allow-origin': '*',
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=0',
      'content-length': '12',
      'content-encoding': 'gzip',
      location: 'http://169.254.170.2/',
      refresh: '0;url=http://evil',
      'clear-site-data': '"cookies"',
    });
    expect(out).toEqual({ 'content-type': 'application/json', etag: '"x"' });
  });
});
