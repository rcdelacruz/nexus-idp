import { resolvePackagePath } from '@backstage/backend-plugin-api';

// Use any to avoid Knex version conflicts with @backstage/backend-plugin-api's bundled knex
type Knex = any;

const TABLE = 'dbaas_connections';

export interface ConnectionRecord {
  id: string;
  user_ref: string;
  provider: string;
  label: string;
  credentials: string;   // AES-256-GCM encrypted JSON
  visibility: 'personal' | 'team';
  owner_ref: string;     // user_ref for personal, group ref for team
  last_synced: Date | null;
  last_error: string | null;
  webhook_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConnectionInput {
  userRef: string;
  provider: string;
  label: string;
  credentials: string;
  visibility: 'personal' | 'team';
  ownerRef: string;
}

export class DbaasStore {
  constructor(private readonly db: Knex) {}

  static async create(db: Knex): Promise<DbaasStore> {
    await db.migrate.latest({
      directory: resolvePackagePath('@stratpoint/plugin-dbaas-backend', 'src/migrations'),
      tableName: 'knex_migrations_dbaas',
      loadExtensions: ['.js'],
    });
    return new DbaasStore(db);
  }

  async addConnection(input: ConnectionInput): Promise<ConnectionRecord> {
    const [row] = await this.db(TABLE)
      .insert({
        user_ref: input.userRef,
        provider: input.provider,
        label: input.label,
        credentials: input.credentials,
        visibility: input.visibility,
        owner_ref: input.ownerRef,
        updated_at: new Date(),
      })
      .returning('*');
    return row;
  }

  async getConnectionsByUser(userRef: string): Promise<ConnectionRecord[]> {
    return this.db(TABLE).where({ user_ref: userRef }).orderBy('created_at', 'desc');
  }

  async getConnectionById(id: string): Promise<ConnectionRecord | undefined> {
    return this.db(TABLE).where({ id }).first();
  }

  async getAllConnections(): Promise<ConnectionRecord[]> {
    return this.db(TABLE).orderBy('created_at', 'asc');
  }

  async updateSyncStatus(
    id: string,
    status: { lastSynced?: Date | null; lastError?: string | null },
  ): Promise<void> {
    await this.db(TABLE).where({ id }).update({
      ...(status.lastSynced !== undefined ? { last_synced: status.lastSynced } : {}),
      ...(status.lastError !== undefined ? { last_error: status.lastError } : {}),
      updated_at: new Date(),
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db(TABLE).where({ id }).delete();
  }
}
