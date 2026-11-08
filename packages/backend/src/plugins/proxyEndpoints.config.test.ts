/**
 * The proxy endpoints inject the portal's own tokens (ArgoCD, Grafana). Any signed-in user can call them, so they are read-only
 * (`allowedMethods: ['GET']`), and there is NO endpoint that carries the GitHub token (the CI/CD tab uses githubActionsApi.ts).
 * Audit 2026-11-07: the endpoints took every method and the GitHub one every path.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import request from 'supertest';
import yaml from 'yaml';
import proxyPlugin from '@backstage/plugin-proxy-backend';
import { mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';

jest.setTimeout(60_000);
const read = (file: string) => yaml.parse(fs.readFileSync(path.resolve(__dirname, '../../../../', file), 'utf8'));

describe('proxy endpoints in the shipped config', () => {
  // Backstage merges the config files object by object, so an endpoint is the merge of its entries in all three files.
  const byName: Record<string, any> = {};
  for (const f of ['app-config.yaml', 'app-config.production.yaml', 'app-config.on-prem.yaml']) {
    for (const [name, cfg] of Object.entries<any>(read(f).proxy?.endpoints ?? {})) {
      byName[name] = { ...byName[name], ...cfg, headers: { ...byName[name]?.headers, ...cfg.headers } };
    }
  }
  const merged = Object.entries(byName);

  it('has no endpoint that targets GitHub or carries GITHUB_TOKEN', () => {
    for (const [name, cfg] of merged as Array<[string, any]>) {
      expect(String(cfg.target)).not.toMatch(/github/i);
      expect(JSON.stringify(cfg.headers ?? {})).not.toMatch(/GITHUB_TOKEN/);
      expect(name).not.toMatch(/github/i);
    }
  });

  it('every endpoint that injects a credential is limited to GET', () => {
    const withCredentials = (merged as Array<[string, any]>).filter(([, cfg]) => Object.keys(cfg.headers ?? {}).some(h => /^(authorization|cookie)$/i.test(h)));
    expect(withCredentials.length).toBeGreaterThanOrEqual(2); // argocd and grafana
    for (const [, cfg] of withCredentials) expect(cfg.allowedMethods).toEqual(['GET']);
  });
});

describe('the real proxy plugin with allowedMethods: [GET]', () => {
  let target: http.Server;
  const seen: string[] = [];
  let server: any;

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} cookie=${req.headers.cookie ?? ''}`);
      res.end('ok');
    });
    await new Promise<void>(r => target.listen(0, '127.0.0.1', r));
    const port = (target.address() as AddressInfo).port;
    ({ server } = await startTestBackend({
      features: [
        proxyPlugin,
        mockServices.rootConfig.factory({
          data: { backend: { baseUrl: 'http://localhost:7007' }, proxy: { endpoints: { '/readonly': { target: `http://127.0.0.1:${port}`, allowedMethods: ['GET'], headers: { Cookie: 'argocd.token=secret' } } } } },
        }),
      ],
    }));
  });
  afterAll(async () => {
    target.closeAllConnections?.();
    await new Promise<void>(r => target.close(() => r()));
  });
  beforeEach(() => {
    seen.length = 0;
  });
  const auth = () => ({ Authorization: mockCredentials.user.header() });

  it('forwards a GET with the injected credential', async () => {
    const res = await request(server).get('/api/proxy/readonly/applications').set(auth());
    expect(res.status).toBe(200);
    expect(seen).toEqual(['GET /applications cookie=argocd.token=secret']);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('does not forward %s', async method => {
    const res = await request(server)[method]('/api/proxy/readonly/applications/x/sync').set(auth());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(seen).toEqual([]);
  });
});
