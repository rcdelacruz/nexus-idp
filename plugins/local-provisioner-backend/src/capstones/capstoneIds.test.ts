import knexFactory from 'knex';
import { CAPSTONES, LEGACY_CAPSTONE_IDS, capstoneById } from './definitions';

const create006 = require('../database/migrations/006-create-capstone-enrollments.js');
const rename009 = require('../database/migrations/009-rename-brownfield-capstones.js');

describe('capstone ids: every one ends in -a or -b', () => {
  it('names the six capstones', () => {
    expect(Object.keys(CAPSTONES).sort()).toEqual(['linux-a', 'linux-b', 'nodejs-a', 'nodejs-b', 'python-a', 'terraform-a', 'terraform-b']);
    for (const [key, def] of Object.entries(CAPSTONES)) {
      expect(def.id).toBe(key);
      expect(def.title).toMatch(new RegExp(`Capstone ${key.slice(-1).toUpperCase()}\\b`));
      expect(def.sourceRepo).toBe(`strat-training/${key.split('-')[0]}-training-capstone-${key.slice(-1)}`);
    }
  });

  it('still resolves the ids the brownfield capstones had before (old templates, old links)', () => {
    for (const [old, now] of Object.entries(LEGACY_CAPSTONE_IDS)) expect(capstoneById(old)).toBe(CAPSTONES[now]);
    expect(capstoneById('constructor')).toBeUndefined();
    expect(capstoneById('toString')).toBeUndefined();
    expect(capstoneById(undefined)).toBeUndefined();
  });
});

describe('migration 009', () => {
  it('renames existing enrollments to the -b ids, and back', async () => {
    const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await create006.up(db);
    const row = (id: string, capstone: string) => ({ id, capstone, trainee_email: `${id}@x.com`, trainee_no: '01', status: 'active', created_at: new Date().toISOString() });
    await db('capstone_enrollments').insert([row('a', 'nodejs'), row('b', 'terraform'), row('c', 'linux'), row('d', 'nodejs-a')]);
    await rename009.up(db);
    expect((await db('capstone_enrollments').orderBy('id')).map((r: any) => r.capstone)).toEqual(['nodejs-b', 'terraform-b', 'linux-b', 'nodejs-a']);
    await rename009.down(db);
    expect((await db('capstone_enrollments').orderBy('id')).map((r: any) => r.capstone)).toEqual(['nodejs', 'terraform', 'linux', 'nodejs-a']);
    await db.destroy();
  });
});
