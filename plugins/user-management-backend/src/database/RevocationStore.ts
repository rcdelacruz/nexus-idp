// Use any to avoid Knex version conflicts
type Knex = any;

const TABLE = 'session_revocations';

// Token lifetime + buffer — revocations older than this can be safely purged.
// Backstage default token lifetime is 1 hour; we keep 2 hours for safety.
const MAX_TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;

export class RevocationStore {
  // In-memory set for O(1) lookup on every request — no DB round-trip per request.
  private readonly revokedSet = new Set<string>();

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
      });
    }
  }

  /** Load all active revocations from DB into the in-memory set on startup. */
  private async loadAll(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_TOKEN_LIFETIME_MS);
    const rows = await this.db(TABLE).where('revoked_at', '>=', cutoff).select('user_entity_ref');
    for (const row of rows) {
      this.revokedSet.add(row.user_entity_ref);
    }
  }

  /** Revoke all sessions for the given user. Persists to DB and updates cache. */
  async revoke(userEntityRef: string): Promise<void> {
    await this.db(TABLE)
      .insert({ user_entity_ref: userEntityRef, revoked_at: new Date() })
      .onConflict('user_entity_ref')
      .merge({ revoked_at: new Date() });
    this.revokedSet.add(userEntityRef);
  }

  /** Check in-memory cache — called on every request, must be synchronous and fast. */
  isRevoked(userEntityRef: string): boolean {
    return this.revokedSet.has(userEntityRef);
  }

  /** Purge revocations older than MAX_TOKEN_LIFETIME_MS — call periodically. */
  async purgeExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_TOKEN_LIFETIME_MS);
    const purged = await this.db(TABLE).where('revoked_at', '<', cutoff).delete();
    if (purged > 0) {
      // Reload the cache after purging
      this.revokedSet.clear();
      await this.loadAll();
    }
  }
}
