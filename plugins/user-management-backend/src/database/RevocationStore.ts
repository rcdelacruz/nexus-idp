// Use any to avoid Knex version conflicts
type Knex = any;

const TABLE = 'session_revocations';

// Token lifetime + buffer — revocations older than this can be safely purged.
// Backstage default token lifetime is 1 hour; we keep 2 hours for safety.
const MAX_TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;

/**
 * Two kinds of revocation:
 *  - `all`: the user was removed; every token of theirs is refused until the entry is purged (the kill switch);
 *  - `before`: their ROLES changed; tokens issued up to now are refused (they carry the old group claims) but a token from a fresh
 *    sign-in is accepted. Without this a demoted admin kept full admin rights for the rest of the token's life (audit 2026-11-07).
 */
type Scope = 'all' | 'before';

export class RevocationStore {
  // In-memory map for O(1) lookup on every request — no DB round-trip per request.
  private readonly revoked = new Map<string, { at: number; scope: Scope }>();

  constructor(private readonly db: Knex) {}

  static async create(db: Knex): Promise<RevocationStore> {
    await RevocationStore.runMigrations(db);
    const store = new RevocationStore(db);
    await store.loadAll();
    return store;
  }

  private static async runMigrations(db: Knex): Promise<void> {
    const hasTable = await db.schema.hasTable(TABLE);
    if (!hasTable) {
      await db.schema.createTable(TABLE, (table: any) => {
        table.string('user_entity_ref').primary();
        table.timestamp('revoked_at').notNullable().defaultTo(db.fn.now());
        table.string('scope').notNullable().defaultTo('all');
      });
    } else if (!(await db.schema.hasColumn(TABLE, 'scope'))) {
      // Existing rows are removals: they keep blocking everything.
      await db.schema.alterTable(TABLE, (table: any) => {
        table.string('scope').notNullable().defaultTo('all');
      });
    }
  }

  /** Load all active revocations from DB into the in-memory set on startup. */
  private async loadAll(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_TOKEN_LIFETIME_MS);
    const rows = await this.db(TABLE).where('revoked_at', '>=', cutoff).select('user_entity_ref', 'revoked_at', 'scope');
    for (const row of rows) {
      this.revoked.set(row.user_entity_ref, { at: new Date(row.revoked_at).getTime(), scope: row.scope === 'before' ? 'before' : 'all' });
    }
  }

  /** Revoke all sessions for the given user. Persists to DB and updates cache. */
  async revoke(userEntityRef: string): Promise<void> {
    await this.write(userEntityRef, new Date(), 'all');
  }

  /**
   * The user's roles changed: refuse every token issued up to now, accept a new sign-in. A token's `iat` has one-second resolution and
   * is compared as the START of its second, so a token minted in the same second as the change is refused too; a sign-in within that
   * second has to be repeated (rare, and harmless).
   */
  async invalidateSessionsBefore(userEntityRef: string, now: Date = new Date()): Promise<void> {
    // Never weaken a removal that is already in force.
    if (this.revoked.get(userEntityRef)?.scope === 'all') return;
    await this.write(userEntityRef, now, 'before');
  }

  private async write(userEntityRef: string, at: Date, scope: Scope): Promise<void> {
    await this.db(TABLE)
      .insert({ user_entity_ref: userEntityRef, revoked_at: at, scope })
      .onConflict('user_entity_ref')
      .merge({ revoked_at: at, scope });
    this.revoked.set(userEntityRef, { at: at.getTime(), scope });
  }

  /**
   * Check in-memory cache — called on every request, must be synchronous and fast. `iatSeconds` is the token's issue time: a role
   * change refuses only tokens issued before it; when the issue time is unknown the token is refused (stricter).
   */
  isRevoked(userEntityRef: string, iatSeconds?: number): boolean {
    const entry = this.revoked.get(userEntityRef);
    if (!entry) return false;
    if (entry.scope === 'all') return true;
    return iatSeconds === undefined || iatSeconds * 1000 <= entry.at;
  }

  /** Purge revocations older than MAX_TOKEN_LIFETIME_MS — call periodically. */
  async purgeExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_TOKEN_LIFETIME_MS);
    const purged = await this.db(TABLE).where('revoked_at', '<', cutoff).delete();
    if (purged > 0) {
      // Reload the cache after purging
      this.revoked.clear();
      await this.loadAll();
    }
  }
}
