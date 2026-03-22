/**
 * Database migration: Create provisioning_tasks and agent_registrations tables
 */

exports.up = async function(knex) {
  // Create provisioning_tasks table
  await knex.schema.createTable('provisioning_tasks', table => {
    table
      .uuid('task_id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'))
      .comment('Unique task identifier');

    table
      .string('agent_id', 255)
      .notNullable()
      .comment('Target agent for execution');

    table
      .string('user_id', 255)
      .notNullable()
      .comment('User email who created the task');

    table
      .string('task_type', 50)
      .notNullable()
      .comment('Type of provisioning task (e.g., provision-kafka)');

    table
      .string('resource_name', 255)
      .notNullable()
      .comment('Name of the resource to provision');

    table
      .jsonb('config')
      .notNullable()
      .comment('Task configuration (JSON)');

    table
      .string('status', 20)
      .notNullable()
      .defaultTo('pending')
      .comment('Task status: pending, assigned, running, completed, failed, cancelled');

    table
      .text('result')
      .nullable()
      .comment('Task result or error message');

    table
      .timestamp('created_at')
      .defaultTo(knex.fn.now())
      .notNullable()
      .comment('Task creation timestamp');

    table
      .timestamp('updated_at')
      .defaultTo(knex.fn.now())
      .notNullable()
      .comment('Last update timestamp');

    table
      .timestamp('assigned_at')
      .nullable()
      .comment('When task was assigned to agent');

    table
      .timestamp('completed_at')
      .nullable()
      .comment('When task completed');

    // Indexes
    table.index('agent_id');
    table.index('user_id');
    table.index('status');
    table.index('created_at');
  });

  // Create agent_registrations table
  await knex.schema.createTable('agent_registrations', table => {
    table
      .string('agent_id', 255)
      .primary()
      .comment('Unique agent identifier');

    table
      .string('user_id', 255)
      .notNullable()
      .comment('User email who registered the agent');

    table
      .text('service_token')
      .notNullable()
      .comment('JWT service token for authentication');

    table
      .timestamp('registered_at')
      .defaultTo(knex.fn.now())
      .notNullable()
      .comment('Registration timestamp');

    table
      .timestamp('last_heartbeat')
      .nullable()
      .comment('Last heartbeat from agent');

    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .comment('Agent status: active, inactive');

    // Indexes
    table.index('user_id');
    table.index('status');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('agent_registrations');
  await knex.schema.dropTableIfExists('provisioning_tasks');
};
