import knexFactory, { Knex } from 'knex';
import { randomUUID } from 'crypto';

/**
 * Tests only: an in-memory sqlite database with the tables the Trainees view reads (`provisioning_tasks`, `agent_registrations`,
 * `trainee_removals`, and the capstone tables through their real migrations), so the real TaskStore queries run in unit tests.
 */
export async function createTrainingDb(): Promise<Knex> {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('provisioning_tasks', t => {
    t.string('task_id').primary();
    t.string('agent_id');
    t.string('user_id');
    t.string('task_type');
    t.string('resource_name');
    t.json('config');
    t.string('status');
    t.string('catalog_entity_ref');
    t.text('error_message');
    t.text('logs');
    t.json('metadata');
    t.json('connection_details');
    t.string('created_at');
    t.string('updated_at');
    t.string('started_at');
    t.string('completed_at');
  });
  await db.schema.createTable('agent_registrations', t => {
    t.string('agent_id').primary();
    t.string('user_id');
    t.string('hostname');
    t.string('machine_name');
    t.string('os_platform');
    t.string('platform_version');
    t.string('agent_version');
    t.json('capabilities');
    t.string('last_seen');
    t.string('created_at');
  });
  await db.schema.createTable('trainee_removals', t => {
    t.string('id').primary();
    t.string('agent_id');
    t.string('resource_name');
    t.string('enrollment_id');
    t.string('trainee_email');
    t.text('repo_url');
    t.boolean('repo_deleted');
    t.string('removed_by');
    t.string('removed_at');
  });
  // eslint-disable-next-line @backstage/no-relative-monorepo-imports
  await require('../database/migrations/006-create-capstone-enrollments.js').up(db);
  // eslint-disable-next-line @backstage/no-relative-monorepo-imports
  await require('../database/migrations/010-capstone-completion.js').up(db);
  return db;
}

let counter = 0;
/** A task row as the database holds it; `config` and `metadata` are given as objects. */
export async function addTask(
  db: Knex,
  row: {
    agent: string;
    resource: string;
    type: string;
    status?: string;
    user?: string;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    logs?: string;
    error?: string;
    /** Minutes after a fixed start (2026-11-01T00:00:00Z) at which the task was created; it completes a minute later. */
    at?: number;
    id?: string;
    connection?: Record<string, unknown>;
  },
): Promise<string> {
  const id = row.id ?? `t-${++counter}-${randomUUID().slice(0, 8)}`;
  const created = new Date(Date.UTC(2026, 10, 1) + (row.at ?? counter) * 60_000).toISOString();
  const completed = new Date(Date.parse(created) + 60_000).toISOString();
  const status = row.status ?? 'completed';
  await db('provisioning_tasks').insert({
    task_id: id,
    agent_id: row.agent,
    user_id: row.user ?? 'trainee@example.com',
    task_type: row.type,
    resource_name: row.resource,
    config: JSON.stringify(row.config ?? {}),
    status,
    catalog_entity_ref: null,
    error_message: row.error ?? null,
    logs: row.logs ?? null,
    metadata: row.metadata ? JSON.stringify(row.metadata) : null,
    connection_details: row.connection ? JSON.stringify(row.connection) : null,
    created_at: created,
    updated_at: status === 'pending' || status === 'in-progress' ? created : completed,
    started_at: created,
    completed_at: status === 'pending' || status === 'in-progress' ? null : completed,
  });
  return id;
}

export async function addAgent(db: Knex, agentId: string, lastSeen: Date, user = 'trainee@example.com'): Promise<void> {
  await db('agent_registrations').insert({
    agent_id: agentId,
    user_id: user,
    hostname: agentId, // unique per agent: Postgres has a unique (hostname, user) constraint
    machine_name: 'm',
    os_platform: 'darwin',
    platform_version: '25',
    agent_version: '0.1.32',
    last_seen: lastSeen.toISOString(),
    created_at: lastSeen.toISOString(),
  });
}
