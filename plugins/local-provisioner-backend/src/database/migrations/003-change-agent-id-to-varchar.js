/**
 * Migration: Change agent_id from UUID to VARCHAR
 *
 * Reason: To support machine-based agent IDs like "agent-hostname-machash"
 * instead of random UUIDs. This enables stable agent IDs across re-registrations.
 */

exports.up = async function up(knex) {
  // Step 1: Drop foreign key constraints if any exist
  // (None exist currently, but good practice for future)

  // Step 2: Drop the primary key constraint temporarily
  await knex.schema.raw('ALTER TABLE agent_registrations DROP CONSTRAINT agent_registrations_pkey;');

  // Step 3: Change column type from UUID to VARCHAR(255)
  await knex.schema.alterTable('agent_registrations', table => {
    table.string('agent_id', 255).notNullable().alter();
  });

  // Step 4: Re-add primary key constraint
  await knex.schema.raw('ALTER TABLE agent_registrations ADD PRIMARY KEY (agent_id);');

  console.log('✓ Changed agent_id column from UUID to VARCHAR(255)');
};

exports.down = async function down(knex) {
  // Revert back to UUID (this will fail if non-UUID values exist)
  await knex.schema.raw('ALTER TABLE agent_registrations DROP CONSTRAINT agent_registrations_pkey;');

  await knex.schema.alterTable('agent_registrations', table => {
    table.uuid('agent_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')).alter();
  });

  await knex.schema.raw('ALTER TABLE agent_registrations ADD PRIMARY KEY (agent_id);');

  console.log('✓ Reverted agent_id column back to UUID');
};
