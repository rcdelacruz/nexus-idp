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
import { globalPrefixOf, installedVersion, PACKAGE_ROOT } from '../utils/installLocation';
import logger from '../utils/logger';

const execAsync = promisify(exec);

import { AGENT_VERSION as currentVersion } from '../utils/version';
import { displayError, displayInfo, displaySuccess, displayWarning } from '../utils/logo';

export const updateCommand = new Command('update')
  .description('Update the agent to the latest version')
  .option('--check', 'Only check for a newer version; do not install')
  .action(async (options: { check?: boolean }) => {
    const info = await checkForUpdate(currentVersion);

    if (!info) {
      displayWarning(`Could not reach the npm registry (offline?). You are on ${currentVersion}; try again when connected.`);
      process.exit(1);
    }

    if (!info.updateAvailable) {
      displaySuccess(`You are on the latest version (${info.latest}).`);
      return;
    }

    if (options.check) {
      displayInfo(`Update available: ${info.current} → ${info.latest}. Install it with: backstage-agent update`);
      return;
    }

    if (!/^\d+\.\d+\.\d+$/.test(info.latest)) {
      displayError(`Unexpected version from the npm registry: ${info.latest}`);
      process.exit(1);
    }
    // Install the exact version into the folder THIS agent runs from (not wherever the shell's npm
    // points), then check the files on disk really changed before saying so.
    const prefix = globalPrefixOf(PACKAGE_ROOT);
    const install = `npm install -g ${prefix ? `--prefix "${prefix}" ` : ''}${PACKAGE_NAME}@${info.latest}`;
    displayInfo(`Updating ${info.current} → ${info.latest}...`);
    try {
      const { stdout, stderr } = await execAsync(install, { timeout: 5 * 60 * 1000 });
      if (stdout) logger.debug(stdout);
      if (stderr) logger.debug(stderr);
    } catch (error: any) {
      displayError(`Update failed: ${String(error.message).split('\n')[0]}`);
      displayInfo(
        process.platform === 'win32'
          ? `Try again from a terminal opened with "Run as administrator": ${install}`
          : `The npm folder may need admin rights. Try: sudo ${install}`,
      );
      process.exit(1);
    }
    const now = installedVersion();
    if (now !== info.latest) {
      displayError(`npm finished, but the agent at ${PACKAGE_ROOT} is still ${now ?? 'unknown'}.`);
      displayInfo(`Install it there yourself: ${install}`);
      process.exit(1);
    }
    displaySuccess(`Updated to ${info.latest}. Restart the agent to use it: backstage-agent stop && backstage-agent start`);
  });
