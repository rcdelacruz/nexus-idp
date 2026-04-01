import type { Knex } from 'knex';

export const knexConfig: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? '${{ values.dbName }}',
    user: process.env.DB_USER ?? '${{ values.appName }}',
    password: process.env.DB_PASSWORD ?? 'password',
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: __dirname + '/../../migrations',
    tableName: 'knex_migrations',
  },
};

export default knexConfig;
