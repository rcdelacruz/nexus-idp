/**
 * Database migration: instructor "Remove trainee" (Trainees view).
 *
 *   trainee_removals  one row per removal — hides that lab from the Trainees view and records who
 *                     removed it and whether the trainee repo was deleted (the audit record).
 *                     The lab's own task history is left untouched.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('trainee_removals', table => {
    table.string('id', 36).primary();
    table.string('agent_id', 255).nullable().comment('Lab removed from the view (with resource_name); null for a capstone-only row');
    table.string('resource_name', 255).nullable();
    table.string('enrollment_id', 36).nullable().comment('Capstone enrollment withdrawn with it');
    table.string('trainee_email', 255).notNullable();
    table.text('repo_url').nullable();
    table.boolean('repo_deleted').notNullable().defaultTo(false);
    table.string('removed_by', 255).notNullable();
    table.timestamp('removed_at').notNullable();
    table.index(['agent_id', 'resource_name']);
  });
  console.log('Migration 008: created trainee_removals');
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('trainee_removals');
};
