/**
 * Database migration: the brownfield capstones became "-b" (Part 2 of the pair with the new "-a" capstones).
 *
 *   capstone_enrollments.capstone   nodejs -> nodejs-b, terraform -> terraform-b, linux -> linux-b
 *
 * Without this an existing enrollment would not be found under its new id, and the same trainee could
 * enroll a second time. The portal also still accepts the old ids (definitions.ts LEGACY_CAPSTONE_IDS).
 */
const RENAMES = { nodejs: 'nodejs-b', terraform: 'terraform-b', linux: 'linux-b' };

exports.up = async function up(knex) {
  for (const [from, to] of Object.entries(RENAMES)) {
    await knex('capstone_enrollments').where({ capstone: from }).update({ capstone: to });
  }
  console.log('Migration 009: brownfield capstone ids renamed to -b');
};

exports.down = async function down(knex) {
  for (const [from, to] of Object.entries(RENAMES)) {
    await knex('capstone_enrollments').where({ capstone: to }).update({ capstone: from });
  }
};
