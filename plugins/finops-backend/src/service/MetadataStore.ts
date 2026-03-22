import { DatabaseService } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

const TABLE = 'finops_metadata';

export class MetadataStore {
  private db!: Knex;

  constructor(private readonly databaseService: DatabaseService) {}

  async init(): Promise<void> {
    this.db = await this.databaseService.getClient();
    const exists = await this.db.schema.hasTable(TABLE);
    if (!exists) {
      await this.db.schema.createTable(TABLE, table => {
        table.string('key').primary();
        table.text('value').notNullable();
        table.timestamp('updated_at').notNullable().defaultTo(this.db.fn.now());
      });
    }
  }

  async get(key: string): Promise<string | null> {
    const row = await this.db(TABLE).where({ key }).first();
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db(TABLE)
      .insert({ key, value, updated_at: new Date() })
      .onConflict('key')
      .merge(['value', 'updated_at']);
  }
}
