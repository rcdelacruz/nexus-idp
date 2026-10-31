/**
 * Database migration: what each agent's machine can run (training-platform §5b, supported platforms).
 *
 *   + capabilities  jsonb  { arch, cpus, dockerMemoryBytes, dockerOs } as reported by agents ≥ 0.1.23
 *                          on every poll. Labs declare minimums; provisioning stops early with a fix
 *                          instead of half-starting on a machine that can't run them.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('agent_registrations', table => {
    table.jsonb('capabilities').nullable().comment('Machine capabilities reported by the agent (arch, cpus, Docker memory)');
  });
  console.log('Migration 007: added capabilities to agent_registrations');
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('agent_registrations', table => {
    table.dropColumn('capabilities');
  });
};
