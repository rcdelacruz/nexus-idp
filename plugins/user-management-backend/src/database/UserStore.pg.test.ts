import knexFactory, { Knex } from 'knex';
import { UserStore } from './UserStore';

/**
 * Real-Postgres check of the user table (the `teams` column is a Postgres text[]). Skipped unless
 * USER_MGMT_TEST_PG_URL points at a throwaway database, e.g.:
 *   docker run -d --rm --name um-pg -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:17-alpine
 *   USER_MGMT_TEST_PG_URL=postgres://postgres:pw@localhost:55433/postgres CI=true yarn backstage-cli package test UserStore.pg
 */
const url = process.env.USER_MGMT_TEST_PG_URL;
const maybe = url ? describe : describe.skip;

maybe('UserStore on real Postgres — instructor flag', () => {
  let db: Knex;

  // Own schema: Jest runs test files in parallel and the other Postgres test must not see this one's tables.
  const SCHEMA = 'um_userstore_test';

  beforeEach(async () => {
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: [SCHEMA] });
  });
  afterEach(async () => {
    await db?.destroy();
  });

  const input = (name: string) => ({ name, displayName: name, email: `${name}@example.com`, teams: ['web-team'] });

  it('creates the column on a fresh database, false by default', async () => {
    const store = await UserStore.create(db);
    await store.upsert(input('ann'));
    expect((await store.getByName('ann'))?.is_instructor).toBe(false);
  });

  it('adds the column to a table that predates it, keeps its rows, and is safe to run again', async () => {
    // The table as it was before this feature: every column except is_instructor.
    await db.schema.createTable('user_management_users', t => {
      t.string('name').primary();
      t.string('display_name').notNullable();
      t.string('email').notNullable();
      t.specificType('teams', 'text[]').notNullable().defaultTo('{}');
      t.boolean('is_lead').notNullable().defaultTo(false);
      t.boolean('is_admin').notNullable().defaultTo(false);
      t.string('github_username').nullable();
      t.string('gitlab_username').nullable();
      t.boolean('onboarding_catalog_tour').notNullable().defaultTo(false);
      t.boolean('onboarding_engineering_docs').notNullable().defaultTo(false);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
    await db('user_management_users').insert({ name: 'old', display_name: 'Old', email: 'old@example.com', is_admin: true });
    expect(await db.schema.hasColumn('user_management_users', 'is_instructor')).toBe(false);

    const store = await UserStore.create(db);
    expect(await db.schema.hasColumn('user_management_users', 'is_instructor')).toBe(true);
    const old = await store.getByName('old');
    expect(old).toMatchObject({ name: 'old', is_admin: true, is_instructor: false });

    await UserStore.create(db); // second start: nothing to do, no error
    expect((await store.getByName('old'))?.is_admin).toBe(true);
  });

  it('sets and clears the flag without touching anything else about the user', async () => {
    const store = await UserStore.create(db);
    await store.upsert({ ...input('ann'), isLead: true, githubUsername: 'ann-gh' });
    const before = await store.getByName('ann');

    await store.setInstructor('ann', true);
    expect(await store.getByName('ann')).toMatchObject({
      teams: ['web-team'], is_lead: true, is_admin: false, github_username: 'ann-gh', is_instructor: true,
    });
    await store.setInstructor('ann', false);
    const after = await store.getByName('ann');
    expect(after).toMatchObject({ is_instructor: false, teams: before?.teams, is_lead: true });
  });

  it('keeps the flag when an admin reassigns the user to other teams (upsert)', async () => {
    const store = await UserStore.create(db);
    await store.upsert(input('ann'));
    await store.setInstructor('ann', true);

    await store.upsert({ ...input('ann'), teams: ['cloud-team', 'ai-team'], isLead: true });
    expect(await store.getByName('ann')).toMatchObject({ teams: ['cloud-team', 'ai-team'], is_lead: true, is_instructor: true });
  });

  it('shows the flag in the full user list', async () => {
    const store = await UserStore.create(db);
    await store.upsert(input('ann'));
    await store.upsert(input('bob'));
    await store.setInstructor('bob', true);
    const all = await store.getAll();
    expect(all.map(u => [u.name, u.is_instructor])).toEqual([['ann', false], ['bob', true]]);
  });
});
