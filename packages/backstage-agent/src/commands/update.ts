/**
 * Update command — self-update the agent to the latest published version.
 *
 * `backstage-agent update`          → update if a newer version exists
 * `backstage-agent update --check`  → report only, don't install
 */

import { Command } from 'commander';
import { exec } from 'child_process';
import { promisify } from 'util';
import { checkForUpdate, PACKAGE_NAME } from '../utils/versionCheck';
import logger from '../utils/logger';

const execAsync = promisify(exec);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const currentVersion: string = require('../../package.json').version;

export const updateCommand = new Command('update')
  .description('Update the agent to the latest version')
  .option('--check', 'Only check for a newer version; do not install')
  .action(async (options: { check?: boolean }) => {
    logger.info(`Current version: ${currentVersion}`);
    const info = await checkForUpdate(currentVersion);

    if (!info) {
      logger.warn('Could not reach the npm registry (offline?). Try again when connected.');
      process.exit(1);
    }

    if (!info.updateAvailable) {
      logger.info(`You are on the latest version (${info.latest}).`);
      return;
    }

    logger.info(`A newer version is available: ${info.current} -> ${info.latest}`);

    if (options.check) {
      logger.info(`Run \`backstage-agent update\` to install it.`);
      return;
    }

    logger.info('Updating...');
    try {
      const { stdout, stderr } = await execAsync(
        `npm install -g ${PACKAGE_NAME}@latest`,
        { timeout: 5 * 60 * 1000 },
      );
      if (stdout) logger.debug(stdout);
      if (stderr) logger.debug(stderr);
      logger.info(`Updated to ${info.latest}. Restart the agent: \`backstage-agent stop && backstage-agent start\`.`);
    } catch (error: any) {
      logger.error(`Update failed: ${error.message}`);
      logger.error(
        `You may need elevated permissions. Try: sudo npm install -g ${PACKAGE_NAME}@latest`,
      );
      process.exit(1);
    }
  });
