import express from 'express';
import knexFactory, { Knex } from 'knex';
import { AddressInfo } from 'net';
import { createRouter } from './service/router';
import { UserStore } from './database/UserStore';
import { UserEntityProvider } from './provider/UserEntityProvider';

/**
 * The whole chain for the instructor role on a real Postgres: the admin's HTTP call, the user table,
 * and the catalog entity the provider emits (its `memberOf` is what sign-in turns into the token's
 * groups). Skipped unless USER_MGMT_TEST_PG_URL points at a throwaway database (see UserStore.pg.test.ts).
 */
const url = process.env.USER_MGMT_TEST_PG_URL;
const maybe = url ? describe : describe.skip;

maybe('instructor role end to end on real Postgres', () => {
  let db: Knex;
  let store: UserStore;
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  let provider: UserEntityProvider;
  const applied: any[] = [];

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  /** What the catalog would hold for a user after the provider's next refresh. */
  const memberOf = async (name: string): Promise<string[] | undefined> => {
    await provider.refresh();
    const last = applied[applied.length - 1];
    return last.entities.map((e: any) => e.entity).find((e: any) => e.metadata.name === name)?.spec.memberOf;
  };

  beforeAll(async () => {
    // Own schema: Jest runs test files in parallel and UserStore.pg.test.ts must not see these tables.
    const SCHEMA = 'um_instructor_flow_test';
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: [SCHEMA] });
    store = await UserStore.create(db);
    const router = await createRouter({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any,
      httpAuth: { credentials: async () => ({ principal: { type: 'user' } }) } as any,
      userInfo: {
        getUserInfo: async () => ({
          userEntityRef: 'user:default/jane.doe',
          ownershipEntityRefs: ['user:default/jane.doe', 'group:default/backstage-admins'],
        }),
      } as any,
      userStore: store,
      revocationStore: {} as any,
      orgDomain: 'example.com',
    });
    server = express().use(router).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    provider = new UserEntityProvider(
      store,
      { run: async () => {} } as any,
      { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    );
    await provider.connect({ applyMutation: async (m: any) => { applied.push(m); }, refresh: async () => {} } as any);

    await store.upsert({ name: 'ann.cruz', displayName: 'Ann Cruz', email: 'ann.cruz@example.com', teams: ['web-team'] });
    await store.upsert({ name: 'tess.trainee', displayName: 'Tess Trainee', email: 'tess@example.com', teams: ['general-engineers'] });
    await store.updateGithubUsername('ghost', 'gus-gh', 'example.com'); // linked GitHub, never onboarded
  });
  afterAll(async () => {
    server?.close();
    await db?.destroy();
  });

  it('starts with nobody in the instructors group', async () => {
    expect(await memberOf('ann.cruz')).toEqual(['general-engineers', 'web-team']);
  });

  it('grant: the catalog entity gets the instructors group, next to the team', async () => {
    const res = await post('/instructor', { userName: 'ann.cruz', isInstructor: true });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe('Ann Cruz is now an instructor.');
    expect(await memberOf('ann.cruz')).toEqual(['general-engineers', 'web-team', 'instructors']);
  });

  it('reassigning the instructor to other teams keeps the group', async () => {
    const res = await post('/assign', { userName: 'ann.cruz', teams: ['cloud-team', 'ai-team'], isLead: true });
    expect(res.status).toBe(200);
    expect(await memberOf('ann.cruz')).toEqual(['general-engineers', 'cloud-team', 'cloud-lead', 'ai-team', 'ai-lead', 'instructors']);
  });

  it('a trainee with only general-engineers can be an instructor and is emitted to the catalog', async () => {
    expect(await memberOf('tess.trainee')).toBeUndefined(); // not emitted at all before: no department team
    expect((await post('/instructor', { userName: 'tess.trainee', isInstructor: true })).status).toBe(200);
    expect(await memberOf('tess.trainee')).toEqual(['general-engineers', 'instructors']);
  });

  it('revoke: the group goes away and the rest of the user is untouched', async () => {
    expect((await post('/instructor', { userName: 'ann.cruz', isInstructor: false })).status).toBe(200);
    expect(await memberOf('ann.cruz')).toEqual(['general-engineers', 'cloud-team', 'cloud-lead', 'ai-team', 'ai-lead']);
    const row = await store.getByName('ann.cruz');
    expect(row).toMatchObject({ is_instructor: false, teams: ['cloud-team', 'ai-team'], is_lead: true, is_admin: false });
    // revoking from the trainee-only user removes them from the catalog again (they never had a team)
    expect((await post('/instructor', { userName: 'tess.trainee', isInstructor: false })).status).toBe(200);
    expect(await memberOf('tess.trainee')).toBeUndefined();
  });

  it('can always revoke: an admin with no team, made instructor and then demoted, is still listed and can be revoked', async () => {
    await store.updateGithubUsername('fay.former', 'fay-gh', 'example.com');
    await store.setAdmin('fay.former', true); // admin with no department team
    expect((await post('/instructor', { userName: 'fay.former', isInstructor: true })).status).toBe(200);
    expect((await post('/promote', { userName: 'fay.former', isAdmin: false })).status).toBe(200);
    expect(await store.getByName('fay.former')).toMatchObject({ teams: [], is_admin: false, is_instructor: true });
    expect(await memberOf('fay.former')).toEqual(['general-engineers', 'instructors']); // still emitted: the flag keeps them in

    const revoke = await post('/instructor', { userName: 'fay.former', isInstructor: false });
    expect(revoke.status).toBe(200);
    expect((await store.getByName('fay.former'))?.is_instructor).toBe(false);
    expect(await memberOf('fay.former')).toBeUndefined();
  });

  it('refuses the person who linked GitHub but never finished onboarding, and saves nothing', async () => {
    const res = await post('/instructor', { userName: 'ghost', isInstructor: true });
    expect(res.status).toBe(400);
    expect((await store.getByName('ghost'))?.is_instructor).toBe(false);
    expect(await memberOf('ghost')).toBeUndefined();
  });
});
