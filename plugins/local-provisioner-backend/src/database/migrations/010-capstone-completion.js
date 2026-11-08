/**
 * Database migration: an instructor can mark a capstone enrollment done.
 *
 *   capstone_enrollments.status       gains the value 'completed' (the column is a plain string)
 *   capstone_enrollments.completed_at when it was marked done
 *   capstone_enrollments.completed_by who marked it (the instructor's sign-in)
 *   capstone_enrollments.report       the lab report as it stood at that moment (JSON text), so it outlives the lab and its task rows
 *
 * Additive: existing rows keep working unchanged.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('capstone_enrollments', table => {
    table.timestamp('completed_at').nullable();
    table.string('completed_by', 320).nullable();
    table.text('report').nullable().comment('Lab report snapshot taken when the instructor marked the capstone done');
  });
  console.log('Migration 010: capstone completion (completed_at, completed_by, report)');
};

exports.down = async function down(knex) {
  await knex('capstone_enrollments').where({ status: 'completed' }).update({ status: 'active' });
  await knex.schema.alterTable('capstone_enrollments', table => {
    table.dropColumn('completed_at');
    table.dropColumn('completed_by');
    table.dropColumn('report');
  });
};
