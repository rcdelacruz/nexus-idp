import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { createRouter } from './router';
import { PROJECT_TEAM_NAMES, teamNameError } from './teams';

describe('teamNameError', () => {
  it('accepts nothing and the seven teams of the registration form', () => {
    for (const ok of [undefined, null, '', ...PROJECT_TEAM_NAMES]) expect(teamNameError(ok)).toBeUndefined();
  });
  it('refuses every other name, including the platform groups whose catalog entities a project manager could otherwise read', () => {
    for (const bad of ['devops-team', 'backstage-admins', 'instructors', 'pm-team', 'general-engineers', 'web-lead', 'Web-Team', ' web-team', 'web-team ', 'a/b', 5, {}, ['web-team']]) {
      expect(teamNameError(bad as unknown)).toMatch(/team_name must be one of/);
    }
  });
});

describe('project routes: the team of a project', () => {
  let server: http.Server;
  let base: string;
  const store = {
    createProject: jest.fn(async (input: any) => ({ id: 'p1', name: input.name, ...input })),
    updateProject: jest.fn(async (id: string, input: any) => ({ id, ...input })),
  };
  let groups: string[] = ['group:default/pm-team'];

  beforeAll(async () => {
    const app = express();
    app.use(
      '/',
      createRouter({
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any,
        httpAuth: { credentials: async () => ({}) } as any,
        userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/pm.one', ownershipEntityRefs: groups }) } as any,
        projectStore: store as any,
      }),
    );
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
    groups = ['group:default/pm-team'];
  });

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('creates a project for one of the form\'s teams, or for none', async () => {
    expect((await send('POST', '/projects', { name: 'n', client_name: 'c', team_name: 'web-team' })).status).toBe(201);
    expect((await send('POST', '/projects', { name: 'n', client_name: 'c' })).status).toBe(201);
    expect(store.createProject).toHaveBeenCalledTimes(2);
  });

  it('refuses a project whose team is a platform group, and creates nothing', async () => {
    for (const team of ['devops-team', 'backstage-admins', 'instructors']) {
      const res = await send('POST', '/projects', { name: 'n', client_name: 'c', team_name: team });
      expect(res.status).toBe(400);
    }
    expect(store.createProject).not.toHaveBeenCalled();
  });

  it('refuses to change a project\'s team to a platform group, and changes nothing', async () => {
    expect((await send('PATCH', '/projects/p1', { team_name: 'devops-team' })).status).toBe(400);
    expect(store.updateProject).not.toHaveBeenCalled();
    expect((await send('PATCH', '/projects/p1', { team_name: 'qa-team' })).status).toBe(200);
    expect(store.updateProject).toHaveBeenCalledTimes(1);
  });

  it('still lets only project managers and admins create projects', async () => {
    groups = ['group:default/web-team'];
    expect((await send('POST', '/projects', { name: 'n', client_name: 'c', team_name: 'web-team' })).status).toBe(403);
  });
});
