import express from 'express';
import { AddressInfo } from 'net';
import { createRouter } from './router';

/**
 * A trainee's linked GitHub account is shared on every repo the portal creates for them. The
 * organization's own account (organization.githubOwner) owns those repos and GitHub refuses it as a
 * collaborator — linking it left a Linux capstone repo with no one invited (2026-10-31).
 */
describe('user-management router — linking GitHub', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  const linked: string[] = [];

  beforeAll(async () => {
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user', userEntityRef: 'user:default/ronaldo.delacruz' } }) } as any,
      userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ronaldo.delacruz', ownershipEntityRefs: [] }) } as any,
      userStore: { updateGithubUsername: async (_n: string, u: string) => { linked.push(u); } } as any,
      revocationStore: {} as any,
      orgDomain: 'example.com',
      githubOwner: 'stratpoint-engineering',
    });
    const app = express().use(router).use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'InputError' ? 400 : 500).json({ error: err.message }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("refuses the organization's own account, whatever its case, and saves nothing", async () => {
    for (const githubUsername of ['stratpoint-engineering', 'Stratpoint-Engineering ']) {
      const res = await fetch(`${base}/link-github`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubUsername }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/organization's own GitHub account, not yours.*Sign in to github.com with your personal GitHub account/);
    }
    expect(linked).toEqual([]);
  });
});
