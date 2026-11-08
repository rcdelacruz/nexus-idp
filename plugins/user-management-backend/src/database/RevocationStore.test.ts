import knexFactory from 'knex';
import { RevocationStore } from './RevocationStore';
import { createRevocationMiddleware } from '../revocationModule';

jest.setTimeout(60_000);

/**
 * Two kinds of revocation. A removed user is refused whatever token they hold. A user whose ROLES changed has the tokens issued before
 * the change refused (they carry the old groups), while a token from a fresh sign-in is accepted. Audit 2026-11-07: a demoted admin kept
 * full admin rights for the rest of the token's life. Real database (SQLite), real store.
 */
describe('RevocationStore', () => {
  const newDb = () => knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const USER = 'user:default/ann.cruz';
  const at = (iso: string) => new Date(iso);
  const iat = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  async function store() {
    const knex = newDb();
    return { knex, store: await RevocationStore.create(knex) };
  }

  it('after a role change, a token issued before it is refused and one issued after it is accepted', async () => {
    const { store: s } = await store();
    await s.invalidateSessionsBefore(USER, at('2026-11-07T10:00:00.400Z'));
    expect(s.isRevoked(USER, iat('2026-11-07T09:59:59Z'))).toBe(true); // an hour-old token
    expect(s.isRevoked(USER, iat('2026-11-07T10:00:00Z'))).toBe(true); // minted in the same second: refused, the user signs in again
    expect(s.isRevoked(USER, iat('2026-11-07T10:00:01Z'))).toBe(false); // the next sign-in
    expect(s.isRevoked(USER, iat('2026-11-07T10:30:00Z'))).toBe(false);
  });

  it('a token with no issue time is refused after a role change (stricter), and other users are untouched', async () => {
    const { store: s } = await store();
    await s.invalidateSessionsBefore(USER, at('2026-11-07T10:00:00.400Z'));
    expect(s.isRevoked(USER)).toBe(true);
    expect(s.isRevoked('user:default/someone.else', iat('2026-11-07T09:00:00Z'))).toBe(false);
  });

  it('a removal refuses every token, including one issued afterwards, and a later role change does not weaken it', async () => {
    const { store: s } = await store();
    await s.revoke(USER);
    expect(s.isRevoked(USER, Math.floor(Date.now() / 1000) + 3600)).toBe(true);
    await s.invalidateSessionsBefore(USER, new Date(Date.now() - 3_600_000));
    expect(s.isRevoked(USER, Math.floor(Date.now() / 1000) + 3600)).toBe(true);
  });

  it('is remembered across a restart, with its kind', async () => {
    const { knex, store: first } = await store();
    await first.invalidateSessionsBefore('user:default/role.change', new Date());
    await first.revoke('user:default/removed');
    const second = await RevocationStore.create(knex);
    expect(second.isRevoked('user:default/removed', Math.floor(Date.now() / 1000) + 3600)).toBe(true);
    expect(second.isRevoked('user:default/role.change', Math.floor(Date.now() / 1000) - 60)).toBe(true);
    expect(second.isRevoked('user:default/role.change', Math.floor(Date.now() / 1000) + 5)).toBe(false);
  });

  it('upgrades a table created before there were two kinds: old rows stay removals', async () => {
    const knex = newDb();
    await knex.schema.dropTableIfExists('session_revocations');
    await knex.schema.createTable('session_revocations', (t: any) => {
      t.string('user_entity_ref').primary();
      t.timestamp('revoked_at').notNullable();
    });
    await knex('session_revocations').insert({ user_entity_ref: 'user:default/old.removal', revoked_at: new Date() });
    const s = await RevocationStore.create(knex);
    expect(s.isRevoked('user:default/old.removal', Math.floor(Date.now() / 1000) + 3600)).toBe(true);
  });

  it('the /api middleware applies it using the token\'s own issue time', async () => {
    const { store: s } = await store();
    await s.invalidateSessionsBefore(USER, new Date());
    const token = (issuedAt: number) => `h.${Buffer.from(JSON.stringify({ sub: USER, iat: issuedAt })).toString('base64url')}.s`;
    const run = (issuedAt: number) => {
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      createRevocationMiddleware(() => s, { info: () => {} })({ headers: { authorization: `Bearer ${token(issuedAt)}` } }, res, next);
      return { res, next };
    };
    const now = Math.floor(Date.now() / 1000);
    expect(run(now - 600).res.status).toHaveBeenCalledWith(401); // issued before the change
    expect(run(now + 5).next).toHaveBeenCalled(); // a fresh sign-in after it
  });
});
