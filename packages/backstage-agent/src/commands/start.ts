/**
 * Start command - Start the agent as a background daemon
 */

import { Command } from 'commander';
import { displayError, displayWarning } from '../utils/logo';
import { launchDaemon } from '../utils/daemonLauncher';
import { AGENT_VERSION } from '../utils/version';
import { checkForUpdate } from '../utils/versionCheck';

export const startCommand = new Command('start')
  .description('Start the Backstage Agent as a background daemon')
  .action(async () => {
    try {
      const result = await launchDaemon();

      // Non-blocking: notify if a newer agent version is available (never fails start).
      try {
        const info = await checkForUpdate(AGENT_VERSION);
        if (info?.updateAvailable) {
          displayWarning(`Update available: ${info.current} → ${info.latest}. Run: backstage-agent update`);
          console.log('');
        }
      } catch {
        // ignore — update check must never block startup
      }
      process.exit(result.ok ? 0 : 1);
    } catch (error: any) {
      displayError(`Failed to start the agent: ${error.message}`);
      console.log('');
      process.exit(1);
    }
  });
