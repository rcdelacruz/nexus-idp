/**
 * Database migration: Reconcile schema with what TaskStore actually uses
 *
 * Migrations 001-003 drifted from `src/database/TaskStore.ts`, leaving the module
 * non-functional: agent registration, heartbeats and SSE connect all threw on
 * missing columns, so no agent could ever complete a lifecycle.
 *
 * Verified read-only against the Talos homelab on 2026-07-24 — both
 * `provisioning_tasks` and `agent_registrations` held 0 rows, so the renames and
 * the drop below are non-destructive.
 *
 * provisioning_tasks
 *   + started_at          TaskStore.updateTaskStatus (:91), mapTaskFromDb (:269)
 *   + error_message       TaskStore.updateTaskStatus (:99), mapTaskFromDb (:266)
 *   + catalog_entity_ref  TaskStore.updateTaskStatus (:103), mapTaskFromDb (:265)
 *
 * agent_registrations
 *   + machine_name        TaskStore.registerAgent (:132), upsertAgent (:165)
 *   + os_platform         TaskStore.registerAgent (:133), upsertAgent (:163)
 *   + agent_version       TaskStore.registerAgent (:134), upsertAgent (:166)
 *   ~ last_heartbeat -> last_seen    TaskStore uses last_seen throughout (:167,213,225,286)
 *   ~ registered_at  -> created_at   TaskStore.mapAgentFromDb reads created_at (:287)
 *   - service_token                  written by no code path, read by none, and NOT NULL —
 *                                    every agent INSERT violated the constraint
 */

exports.up = async function up(knex) {
  // --- provisioning_tasks: add the three columns updateTaskStatus writes ---
  await knex.schema.alterTable('provisioning_tasks', table => {
    table
      .timestamp('started_at')
      .nullable()
      .comment('When the agent began executing the task');

    table
      .text('error_message')
      .nullable()
      .comment('Failure detail reported by the agent');

    table
      .string('catalog_entity_ref', 255)
      .nullable()
      .comment('Catalog entity created for the provisioned resource');
  });

  // --- agent_registrations: add the three machine-info columns TaskStore writes ---
  await knex.schema.alterTable('agent_registrations', table => {
    table
      .string('machine_name', 255)
      .nullable()
      .comment('Human-readable machine name reported by the CLI');

    table
      .string('os_platform', 50)
      .nullable()
      .comment('Platform type (darwin, linux, win32)');

    table
      .string('agent_version', 50)
      .nullable()
      .comment('Version of the backstage-agent CLI');
  });

  // --- align names with TaskStore ---
  await knex.schema.alterTable('agent_registrations', table => {
    table.renameColumn('last_heartbeat', 'last_seen');
    table.renameColumn('registered_at', 'created_at');
  });

  // last_seen must always be populated: upsertAgent's INSERT path (:178) does not set it,
  // and mapAgentFromDb does `new Date(row.last_seen)` which yields Invalid Date when null.
  await knex.schema.alterTable('agent_registrations', table => {
    table
      .timestamp('last_seen')
      .notNullable()
      .defaultTo(knex.fn.now())
      .alter();
  });

  // service_token was created NOT NULL by migration 001 but is written by no code path,
  // so every agent INSERT violated the constraint. Dropping it also removes plaintext
  // agent credentials at rest.
  await knex.schema.alterTable('agent_registrations', table => {
    table.dropColumn('service_token');
  });

  console.log(
    'Migration 004: reconciled schema with TaskStore — added 3 task columns, 3 agent columns, renamed 2, dropped 1',
  );
};

exports.down = async function down(knex) {
  // Re-added as nullable rather than NOT NULL: rows may exist on rollback, and the
  // original NOT NULL constraint was itself the bug.
  await knex.schema.alterTable('agent_registrations', table => {
    table
      .text('service_token')
      .nullable()
      .comment('Deprecated: agent service token (unused)');
  });

  await knex.schema.alterTable('agent_registrations', table => {
    table.timestamp('last_seen').nullable().alter();
  });

  await knex.schema.alterTable('agent_registrations', table => {
    table.renameColumn('created_at', 'registered_at');
    table.renameColumn('last_seen', 'last_heartbeat');
  });

  await knex.schema.alterTable('agent_registrations', table => {
    table.dropColumn('agent_version');
    table.dropColumn('os_platform');
    table.dropColumn('machine_name');
  });

  await knex.schema.alterTable('provisioning_tasks', table => {
    table.dropColumn('catalog_entity_ref');
    table.dropColumn('error_message');
    table.dropColumn('started_at');
  });

  console.log('Migration 004: rolled back schema reconciliation');
};
