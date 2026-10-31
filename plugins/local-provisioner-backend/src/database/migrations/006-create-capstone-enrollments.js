/**
 * Database migration: capstone enrollments (training-platform Phase 2).
 *
 * One row per trainee per brownfield capstone (strat-training/*-training-capstone). The seed's
 * manifest, credentials and answer key are instructor-only: they are never sent to a trainee or
 * written to a trainee repo, and only the instructor routes read them.
 *
 *   status: seeded (trainee files generated) → active (trainee repo recorded)
 *   Laptop-seeded capstones (Terraform: the seed must run against the trainee's local MiniStack)
 *   get a single-use seed-report token: only its sha256 and an expiry are stored; the report
 *   endpoint clears the hash atomically when it accepts the report.
 *   A trainee number is held while an enrollment is seeded/active; a seeded enrollment that never
 *   got a repo (the scaffolder run failed after seeding) releases its number after an hour.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('capstone_enrollments', table => {
    table.uuid('id').primary();
    table.string('capstone', 32).notNullable().comment('Capstone id, e.g. nodejs');
    table.string('trainee_email', 320).notNullable();
    table.string('trainee_no', 2).notNullable().comment('01-99, passed to the seed as --trainee');
    table.string('status', 16).notNullable().defaultTo('seeded');
    table.string('repo_url', 512).nullable();
    table.jsonb('seed_manifest').nullable().comment('Instructor-only');
    table.text('credentials').nullable().comment('Instructor-only');
    table.text('answer_key').nullable().comment('Instructor-only');
    table.string('handout_pr_url', 512).nullable();
    table.timestamp('handout_at').nullable();
    table.jsonb('grades').nullable();
    table.string('seed_token_hash', 64).nullable().comment('sha256 of the single-use seed-report token');
    table.timestamp('seed_token_expires_at').nullable();
    table.timestamp('seed_reported_at').nullable().comment('Set when a laptop seed reported (unverified)');
    table.text('handover').nullable().comment('Trainee-facing handover note, committed to the repo as HANDOVER.md');
    table.timestamp('handover_committed_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['capstone', 'trainee_no']);
    table.index(['trainee_email']);
  });

  console.log('Migration 006: created capstone_enrollments');
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('capstone_enrollments');
};
