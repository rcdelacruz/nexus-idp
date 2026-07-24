/**
 * Database migration: persist agent-reported logs, metadata, and connection details.
 *
 * The professional UX surfaces live logs, container/port status, image-pull progress, and
 * "how to connect" details. The agent reports these on each status update; these columns
 * store them so the UI can render them and the catalog EntityProvider can read connection
 * details for running resources.
 *
 *   + logs                text   docker-compose output captured by the agent
 *   + metadata            jsonb  container status, ports, pull progress, arbitrary agent detail
 *   + connection_details  jsonb  host/ports/connectionString/ui for the provisioned resource
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('provisioning_tasks', table => {
    table
      .text('logs')
      .nullable()
      .comment('docker-compose output captured by the agent');

    table
      .jsonb('metadata')
      .nullable()
      .comment('Container status, ports, image-pull progress, arbitrary agent detail');

    table
      .jsonb('connection_details')
      .nullable()
      .comment('How to connect: host, ports, connectionString, ui');
  });

  console.log('Migration 005: added logs, metadata, connection_details to provisioning_tasks');
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('provisioning_tasks', table => {
    table.dropColumn('connection_details');
    table.dropColumn('metadata');
    table.dropColumn('logs');
  });

  console.log('Migration 005: rolled back logs/metadata/connection_details');
};
