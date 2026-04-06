/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('project_registration_projects', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('client_name').notNullable();
    table.string('type').notNullable().defaultTo('client'); // client | system
    // AWS tags (auto-generated from name/client, can be overridden)
    table.string('aws_tag_project').notNullable();
    table.string('aws_tag_client').notNullable();
    table.string('aws_tag_team').notNullable();
    // Project dates
    table.date('start_date').nullable();
    table.date('end_date').nullable();
    // Project management tool (optional)
    table.string('pm_tool').nullable();           // jira | github | none
    table.string('jira_key').nullable();
    table.string('jira_template').nullable();
    table.string('jira_project_id').nullable();
    table.string('github_project_id').nullable();
    // Team
    table.string('team_name').nullable();
    table.jsonb('team_members').nullable();
    // Status
    table.string('status').notNullable().defaultTo('active'); // active | archived
    table.string('created_by').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Pre-seed system projects — always available in scaffolder dropdown
  await knex('project_registration_projects').insert([
    {
      name: 'Internal Tools',
      client_name: 'Stratpoint',
      type: 'system',
      aws_tag_project: 'internal-tools',
      aws_tag_client: 'stratpoint',
      aws_tag_team: 'internal',
      created_by: 'system',
    },
    {
      name: 'R&D / Experiments',
      client_name: 'Stratpoint',
      type: 'system',
      aws_tag_project: 'rnd-experiments',
      aws_tag_client: 'stratpoint',
      aws_tag_team: 'rnd',
      created_by: 'system',
    },
  ]);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('project_registration_projects');
};
