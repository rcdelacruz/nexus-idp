import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Real-Postgres check of migration 009 (the brownfield capstones became -b): enrollments made under the
 * old ids are found under the new ones, nothing else changes, and it reverses. Skipped unless
 * LP_TEST_PG_URL points at a throwaway database (see traineeRemovals.pg.test.ts).
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;

maybe('migration 009 on real Postgres', () => {
  let db: Knex;
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d{3}-.*\.js$/.test(f)).sort();

  beforeAll(async () => {
    // Its own schema: Jest runs test files in parallel, and files that reset `public` wipe each other.
    const admin = knexFactory({ client: 'pg', connection: url });
    await admin.raw('DROP SCHEMA IF EXISTS lp_rename_brownfield_test CASCADE; CREATE SCHEMA lp_rename_brownfield_test');
    await admin.destroy();
    db = knexFactory({ client: 'pg', connection: url, searchPath: ['lp_rename_brownfield_test'] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    for (const f of files.filter(x => x < '009')) await require(path.join(dir, f)).up(db);
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('renames the old ids, leaves the -a ones, and reverses', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const row = (n: number, capstone: string) => ({ id: ids[n], capstone, trainee_email: `t${n}@x.com`, trainee_no: '01', status: 'active', created_at: new Date() });
    await db('capstone_enrollments').insert([row(0, 'nodejs'), row(1, 'terraform'), row(2, 'linux'), row(3, 'nodejs-a')]);
    const read = async () => (await Promise.all(ids.map(id => db('capstone_enrollments').where({ id }).first()))).map(r => r.capstone);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m009 = require(path.join(dir, '009-rename-brownfield-capstones.js'));
    await m009.up(db);
    expect(await read()).toEqual(['nodejs-b', 'terraform-b', 'linux-b', 'nodejs-a']);
    await m009.down(db);
    expect(await read()).toEqual(['nodejs', 'terraform', 'linux', 'nodejs-a']);
  });
});
