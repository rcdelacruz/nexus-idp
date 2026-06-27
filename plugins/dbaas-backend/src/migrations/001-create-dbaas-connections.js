/**
 * Database migration: Create dbaas_connections table
 *
 * Idempotent: checks hasTable before creating so this migration is safe
 * to run against databases that were created with the prior inline-migration
 * approach (DbaasStore.runMigrations).
 */

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('dbaas_connections');
  if (exists) return;

  await knex.schema.createTable('dbaas_connections', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('user_ref').notNullable();
    table.text('provider').notNullable();
    table.text('label').notNullable();
    table.text('credentials').notNullable();
    table.text('visibility').notNullable().defaultTo('personal');
    table.text('owner_ref').notNullable();
    table.timestamp('last_synced').nullable();
    table.text('last_error').nullable();
    table.text('webhook_id').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Uniqueness: one connection per (user, provider, label) tuple
    table.unique(['user_ref', 'provider', 'label']);

    // M2: index on user_ref — getConnectionsByUser is the hot path
    table.index('user_ref');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('dbaas_connections');
};
