/**
 * Database migration: Add machine-based agent identification
 *
 * Changes:
 * 1. Add platform_version column for detailed OS info
 * 2. Add hostname column for human-readable machine identification
 * 3. Modify agent_id to support custom values (not auto-generated UUID)
 * 4. Add unique constraint on (hostname, user_id) for machine-based identification
 */

exports.up = async function up(knex) {
  // 1. Add platform_version column
  await knex.schema.alterTable('agent_registrations', table => {
    table
      .string('platform_version', 100)
      .nullable()
      .comment('Detailed platform version (e.g., macOS 14.2, Ubuntu 22.04)');
  });

  // 2. Add hostname column (separate from machine_name for clarity)
  await knex.schema.alterTable('agent_registrations', table => {
    table
      .string('hostname', 255)
      .nullable()
      .comment('Machine hostname (e.g., macbook-pro.local)');
  });

  // 3. Modify agent_id to be a string (not UUID) for machine-based IDs
  // Note: We can't change the column type directly in PostgreSQL with data,
  // but since agent_id is already generated as UUID, we'll keep it as is
  // and just allow custom values to be inserted
  // The registerAgent method will handle inserting custom agent_ids

  // 4. Add unique constraint on (hostname, user_id)
  // This ensures one agent per machine per user
  await knex.schema.alterTable('agent_registrations', table => {
    table.unique(['hostname', 'user_id'], {
      indexName: 'idx_agent_hostname_user_unique',
    });
  });

  console.log('Migration 002: Added platform_version, hostname columns and unique constraint');
};

exports.down = async function down(knex) {
  // Remove unique constraint
  await knex.schema.alterTable('agent_registrations', table => {
    table.dropUnique(['hostname', 'user_id'], 'idx_agent_hostname_user_unique');
  });

  // Remove columns
  await knex.schema.alterTable('agent_registrations', table => {
    table.dropColumn('hostname');
    table.dropColumn('platform_version');
  });

  console.log('Migration 002: Rolled back machine info changes');
};
