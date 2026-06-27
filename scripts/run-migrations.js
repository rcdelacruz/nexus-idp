#!/usr/bin/env node
/**
 * Backstage Database Migration Runner
 *
 * Runs database migrations for custom backend plugins that need a dedicated DB:
 *   - local-provisioner-backend (provisioning_tasks, agent_registrations)
 *
 * Note: dbaas-backend uses inline migrations via DbaasStore.create() — Backstage's
 * database.getClient() auto-creates backstage_plugin_dbaas and the store runs
 * db.migrate.latest() on startup. No init container step needed for dbaas.
 *
 * Designed to be executed as an init container before the main Backstage app starts.
 *
 * Usage:
 *   node run-migrations.js
 *
 * Environment variables required:
 *   - POSTGRES_HOST
 *   - POSTGRES_PORT
 *   - POSTGRES_USER
 *   - POSTGRES_PASSWORD
 *   - POSTGRES_DB
 */

const knex = require('knex');
const path = require('path');
const fs = require('fs');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function runMigrations() {
  log('='.repeat(80), colors.blue);
  log('Backstage Database Migration Runner', colors.blue);
  log('='.repeat(80), colors.blue);
  log('');

  // Validate required environment variables
  const requiredEnvVars = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    log(`ERROR: Missing required environment variables:`, colors.red);
    missingVars.forEach(varName => log(`  - ${varName}`, colors.red));
    process.exit(1);
  }

  // Database configuration
  const dbConfig = {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT, 10),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    },
    migrations: {
      tableName: 'knex_migrations',
    },
  };

  log(`Database Configuration:`, colors.blue);
  log(`  Host: ${dbConfig.connection.host}`, colors.blue);
  log(`  Port: ${dbConfig.connection.port}`, colors.blue);
  log(`  Database: ${dbConfig.connection.database}`, colors.blue);
  log(`  User: ${dbConfig.connection.user}`, colors.blue);
  log('');

  let db;
  try {
    // Create database connection
    log('Connecting to database...', colors.yellow);
    db = knex(dbConfig);

    // Test connection
    await db.raw('SELECT 1');
    log('✓ Database connection successful', colors.green);
    log('');

    // Clear any stale migration locks
    log('Clearing any stale migration locks...', colors.yellow);
    try {
      await db.raw('DELETE FROM knex_migrations_lock WHERE 1=1');
      log('✓ Stale locks cleared', colors.green);
    } catch (lockError) {
      // Table might not exist yet, which is fine
      log('✓ No existing locks to clear', colors.green);
    }
    log('');

    // Plugin migration sets: each entry is { label, directory, tableName }
    const migrationSets = [
      {
        label: 'local-provisioner-backend',
        directory: path.resolve(__dirname, '../plugins/local-provisioner-backend/src/database/migrations'),
        tableName: 'knex_migrations',
      },
    ];

    for (const { label, directory, tableName } of migrationSets) {
      log(`\n── ${label} ──`, colors.blue);
      log(`   Directory: ${directory}`, colors.blue);

      if (!fs.existsSync(directory)) {
        log(`   ERROR: Migrations directory not found: ${directory}`, colors.red);
        process.exit(1);
      }

      const migrationFiles = fs.readdirSync(directory)
        .filter(file => file.endsWith('.js'))
        .sort();

      log(`   Found ${migrationFiles.length} migration file(s)`, colors.blue);

      log('   Running...', colors.yellow);
      const [batchNo, migrationsList] = await db.migrate.latest({
        directory,
        tableName,
        loadExtensions: ['.js'],
      });

      if (migrationsList.length === 0) {
        log('   ✓ Already up to date', colors.green);
      } else {
        log(`   ✓ Batch ${batchNo}: ${migrationsList.length} migration(s) applied`, colors.green);
        migrationsList.forEach(m => log(`     ✓ ${m}`, colors.green));
      }
    }

    log('');
    log('='.repeat(80), colors.green);
    log('All migrations completed successfully!', colors.green);
    log('='.repeat(80), colors.green);

    process.exit(0);
  } catch (error) {
    log('');
    log('='.repeat(80), colors.red);
    log('Migration failed!', colors.red);
    log('='.repeat(80), colors.red);
    log('');
    log(`Error: ${error.message}`, colors.red);

    if (error.stack) {
      log('', colors.red);
      log('Stack trace:', colors.red);
      log(error.stack, colors.red);
    }

    process.exit(1);
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}

// Run migrations
runMigrations().catch(error => {
  log(`Unhandled error: ${error.message}`, colors.red);
  process.exit(1);
});
