import { makeProxyInterceptor } from './apiDocsProxy';

const make = (...args: [token?: string]) =>
  makeProxyInterceptor({
    proxyBase: 'https://portal.example/api/cors-proxy',
    origin: 'https://portal.example',
    getToken: async () => (args.length ? args[0] : 'portal-token'),
  });

describe('API docs "Try it out" proxy interceptor', () => {
  it('sends a cross-origin call through the proxy with the portal token', async () => {
    const out = await make()({ url: 'https://api.partner.com/v1/items?x=1', headers: { Accept: 'application/json' } });
    expect(out.url).toBe(`https://portal.example/api/cors-proxy/forward?url=${encodeURIComponent('https://api.partner.com/v1/items?x=1')}`);
    expect(out.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer portal-token' });
  });

  it('moves the credential the user entered for the API to X-Target-Authorization, never overwriting it silently', async () => {
    const out = await make()({ url: 'https://api.partner.com/v1/items', headers: { authorization: 'Bearer partner-key' } });
    expect(out.headers['X-Target-Authorization']).toBe('Bearer partner-key');
    expect(out.headers.Authorization).toBe('Bearer portal-token');
    expect(out.headers.authorization).toBeUndefined();
  });

  it('leaves same-origin calls alone (no proxy, no token sent anywhere new)', async () => {
    const req = { url: 'https://portal.example/api/catalog/entities', headers: { Accept: 'x' } };
    expect(await make()(req)).toEqual({ url: 'https://portal.example/api/catalog/entities', headers: { Accept: 'x' } });
  });

  it('leaves a non-absolute URL alone', async () => {
    const req = { url: '/relative/path', headers: {} };
    expect(await make()(req)).toEqual({ url: '/relative/path', headers: {} });
  });

  it('without a portal token it still proxies (the proxy answers 401, nothing is sent to the target unauthenticated)', async () => {
    const out = await make(undefined as unknown as string)({ url: 'https://api.partner.com/v1', headers: {} });
    expect(out.url).toContain('/api/cors-proxy/forward?url=');
    expect(out.headers.Authorization).toBeUndefined();
  });

  it('works when the request has no headers object', async () => {
    const out = await make()({ url: 'https://api.partner.com/v1' });
    expect(out.headers).toEqual({ Authorization: 'Bearer portal-token' });
  });
});
