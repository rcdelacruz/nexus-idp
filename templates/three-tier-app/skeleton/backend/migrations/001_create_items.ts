import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('items', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 255).notNullable();
    table.text('description');
    table.enum('status', ['active', 'inactive', 'archived']).notNullable().defaultTo('active');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Seed demo data
  await knex('items').insert([
    { name: 'Frontend Service', description: 'React frontend application', status: 'active' },
    { name: 'API Gateway', description: 'Express API gateway for microservices', status: 'active' },
    { name: 'Auth Service', description: 'Authentication and authorization service', status: 'active' },
    { name: 'Notification Service', description: 'Email and push notification handler', status: 'inactive' },
    { name: 'Legacy Monolith', description: 'Legacy application being decomposed', status: 'archived' },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('items');
}
