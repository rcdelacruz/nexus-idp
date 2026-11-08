/**
 * SwaggerUI "Try it out" calls an API on another origin through the portal's CORS proxy
 * (`/api/cors-proxy/forward?url=...`). The proxy only serves signed-in users: the portal login token goes in `Authorization`,
 * and the credential the user typed for the API itself (SwaggerUI "Authorize") is moved to `X-Target-Authorization`, which
 * the proxy hands to the target as `Authorization`. The portal token is never forwarded to the target.
 */
export interface ProxyInterceptorOptions {
  /** `${backend.baseUrl}/api/cors-proxy` */
  proxyBase: string;
  /** The page's own origin: requests to it are not proxied. */
  origin: string;
  getToken: () => Promise<string | undefined>;
}

export function makeProxyInterceptor({ proxyBase, origin, getToken }: ProxyInterceptorOptions) {
  return async (req: any) => {
    let reqUrl: URL;
    try {
      reqUrl = new URL(req.url);
    } catch {
      return req; // not an absolute URL: pass through unchanged
    }
    if (reqUrl.origin === origin) return req; // only cross-origin requests need the proxy

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (name.toLowerCase() === 'authorization') headers['X-Target-Authorization'] = String(value);
      else headers[name] = String(value);
    }
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    req.url = `${proxyBase}/forward?url=${encodeURIComponent(req.url)}`;
    req.headers = headers;
    return req;
  };
}
