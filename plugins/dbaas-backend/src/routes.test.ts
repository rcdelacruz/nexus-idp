import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('./providers/registry', () => ({
  getAllProviderInfo: () => [{ id: 'fake' }],
  getProvider: () => ({ fetchDatabases: async () => [] }),
}));
jest.mock('./sharedProvider', () => ({ triggerProviderRefresh: jest.fn() }));

import { createRouter } from './routes';

describe('POST /connections: sharing a connection with a team', () => {
  let server: http.Server;
  let base: string;
  let owns: string[] = [];
  const store = {
    addConnection: jest.fn(async (c: any) => ({ id: 'c1', provider: c.provider, label: c.label, visibility: c.visibility, owner_ref: c.ownerRef, created_at: new Date() })),
  };

  beforeAll(async () => {
    const app = express();
    app.use(
      '/',
      createRouter({
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any,
        httpAuth: { credentials: async () => ({}) } as any,
        userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ann', ownershipEntityRefs: owns }) } as any,
        config: { getConfigArray: () => [{ getString: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }] } as any,
        store: store as any,
      }),
    );
    // Backstage's error middleware maps these in the real backend.
    const statusOf: Record<string, number> = { InputError: 400, NotAllowedError: 403, NotFoundError: 404, ConflictError: 409 };
    app.use((err: any, _req: any, res: any, _next: any) => res.status(statusOf[err.name] ?? 500).json({ error: err.message }));
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  });
  beforeEach(() => {
    jest.clearAllMocks();
    owns = ['user:default/ann', 'group:default/web-team'];
  });

  const add = (body: Record<string, unknown>) =>
    fetch(`${base}/connections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fake', label: 'mine', credentials: { key: 'k' }, ...body }) });

  it('a member shares a connection with their own team', async () => {
    const res = await add({ visibility: 'team', teamRef: 'group:default/web-team' });
    expect(res.status).toBe(201);
    expect(store.addConnection).toHaveBeenCalledWith(expect.objectContaining({ ownerRef: 'group:default/web-team', visibility: 'team' }));
  });

  it('membership is compared without regard to letter case, whichever side has the capitals', async () => {
    expect((await add({ visibility: 'team', teamRef: 'group:default/Web-Team' })).status).toBe(201);
    owns = ['user:default/ann', 'group:default/Web-Team'];
    expect((await add({ visibility: 'team', teamRef: 'group:default/web-team' })).status).toBe(201);
  });

  it('someone who is not in the team cannot file databases under its name', async () => {
    const res = await add({ visibility: 'team', teamRef: 'group:default/devops-team' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not a member of group:default\/devops-team/);
    expect(store.addConnection).not.toHaveBeenCalled();
  });

  it('a platform admin may share with any team', async () => {
    owns = ['user:default/root', 'group:default/backstage-admins'];
    expect((await add({ visibility: 'team', teamRef: 'group:default/devops-team' })).status).toBe(201);
  });

  it('a personal connection needs no team at all', async () => {
    const res = await add({ visibility: 'personal' });
    expect(res.status).toBe(201);
    expect(store.addConnection).toHaveBeenCalledWith(expect.objectContaining({ ownerRef: 'user:default/ann' }));
  });

  it('still refuses a team ref that is not a group ref', async () => {
    expect((await add({ visibility: 'team', teamRef: 'web-team' })).status).toBe(400);
  });
});
