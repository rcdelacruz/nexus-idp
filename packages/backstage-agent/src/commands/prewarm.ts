/**
 * Prewarm command — pull a resource type's images ahead of time.
 *
 * Run this on a good connection (e.g. before travelling) so you can later provision that resource
 * type entirely offline, from the local Docker image cache.
 */

import { Command } from 'commander';
import { DockerComposeExecutor } from '../executor/DockerComposeExecutor';
import logger from '../utils/logger';

const TYPE_MAP: Record<string, string> = {
  kafka: 'provision-kafka',
  postgres: 'provision-postgres',
  redis: 'provision-redis',
  mongodb: 'provision-mongodb',
};

export const prewarmCommand = new Command('prewarm')
  .description('Pull a resource type\'s images ahead of time (for later offline provisioning)')
  .argument('<type>', 'kafka | postgres | redis | mongodb')
  .action(async (type: string) => {
    const taskType = TYPE_MAP[type];
    if (!taskType) {
      logger.error(`Unknown type "${type}". Use one of: ${Object.keys(TYPE_MAP).join(', ')}.`);
      process.exit(1);
    }
    logger.info(`Pre-warming images for ${type}... (this may take a while on a slow connection)`);
    const executor = new DockerComposeExecutor();
    const result = await executor.prewarm(taskType);
    if (result.success) {
      logger.info(`Done. You can now provision ${type} offline from cache.`);
    } else {
      logger.error(`Prewarm failed: ${result.error}`);
      process.exit(1);
    }
  });
