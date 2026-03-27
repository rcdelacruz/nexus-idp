// Use any to avoid Knex version conflicts with @backstage/backend-plugin-api's bundled knex
type Knex = any;

export interface UserRecord {
  name: string;
  display_name: string;
  email: string;
  teams: string[];
  is_lead: boolean;
  is_admin: boolean;
  github_username: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserInput {
  name: string;
  displayName: string;
  email: string;
  teams: string[];
  isLead?: boolean;
  isAdmin?: boolean;
  githubUsername?: string;
}

const TABLE = 'user_management_users';

export class UserStore {
  constructor(private readonly db: Knex) {}

  static async create(db: Knex): Promise<UserStore> {
    await UserStore.runMigrations(db);
    return new UserStore(db);
  }

  private static async runMigrations(db: Knex): Promise<void> {
    const hasTable = await db.schema.hasTable(TABLE);
    if (!hasTable) {
      await db.schema.createTable(TABLE, (table: any) => {
        table.string('name').primary();
        table.string('display_name').notNullable();
        table.string('email').notNullable();
        table.specificType('teams', 'text[]').notNullable().defaultTo('{}');
        table.boolean('is_lead').notNullable().defaultTo(false);
        table.boolean('is_admin').notNullable().defaultTo(false);
        table.string('github_username').nullable();
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
      });
    } else {
      // Add is_admin column to existing tables (migration)
      const hasIsAdmin = await db.schema.hasColumn(TABLE, 'is_admin');
      if (!hasIsAdmin) {
        await db.schema.alterTable(TABLE, (table: any) => {
          table.boolean('is_admin').notNullable().defaultTo(false);
        });
      }
    }
  }

  async upsert(input: UserInput): Promise<void> {
    const existing = await this.db(TABLE).where({ name: input.name }).first();
    const now = new Date();

    if (existing) {
      await this.db(TABLE)
        .where({ name: input.name })
        .update({
          display_name: input.displayName,
          email: input.email,
          teams: this.db.raw('?::text[]', [JSON.stringify(input.teams).replace('[', '{').replace(']', '}').replace(/"/g, '')]),
          is_lead: input.isLead ?? existing.is_lead,
          is_admin: input.isAdmin ?? existing.is_admin,
          github_username: input.githubUsername ?? existing.github_username,
          updated_at: now,
        });
    } else {
      await this.db(TABLE).insert({
        name: input.name,
        display_name: input.displayName,
        email: input.email,
        teams: this.db.raw('?::text[]', [this.toPostgresArray(input.teams)]),
        is_lead: input.isLead ?? false,
        is_admin: input.isAdmin ?? false,
        github_username: input.githubUsername ?? null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async updateGithubUsername(name: string, githubUsername: string, domain?: string): Promise<void> {
    const now = new Date();
    const updated = await this.db(TABLE)
      .where({ name })
      .update({ github_username: githubUsername, updated_at: now });

    // If no row existed yet (user linked GitHub before completing registration),
    // create a minimal row so the annotation is persisted.
    if (!updated) {
      const emailDomain = domain ?? 'example.com';
      await this.db(TABLE).insert({
        name,
        display_name: name,
        email: `${name}@${emailDomain}`,
        teams: this.db.raw('?::text[]', ['{}' ]),
        is_lead: false,
        is_admin: false,
        github_username: githubUsername,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async setAdmin(name: string, isAdmin: boolean): Promise<void> {
    await this.db(TABLE)
      .where({ name })
      .update({ is_admin: isAdmin, updated_at: new Date() });
  }

  async delete(name: string): Promise<void> {
    await this.db(TABLE).where({ name }).delete();
  }

  async getAll(): Promise<UserRecord[]> {
    const rows = await this.db(TABLE).select('*').orderBy('name');
    return rows.map((row: any) => ({
      ...row,
      teams: this.parsePostgresArray(row.teams),
    }));
  }

  async getByName(name: string): Promise<UserRecord | undefined> {
    const row = await this.db(TABLE).where({ name }).first();
    if (!row) return undefined;
    return { ...row, teams: this.parsePostgresArray(row.teams) };
  }

  private toPostgresArray(arr: string[]): string {
    return `{${arr.map(s => `"${s}"`).join(',')}}`;
  }

  private parsePostgresArray(val: any): string[] {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map(s => s.replace(/^"|"$/g, ''));
    }
    return [];
  }
}
