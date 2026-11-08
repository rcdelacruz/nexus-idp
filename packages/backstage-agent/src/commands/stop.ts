/**
 * Stop command - Stop the running agent
 */

import { Command } from 'commander';
import { displaySuccess, displayInfo, displayError } from '../utils/logo';
import { stopAgent } from '../utils/stopAgent';

export const stopCommand = new Command('stop')
  .description('Stop the running Backstage Agent')
  .action(async () => {
    try {
      const result = await stopAgent();
      if (result.state === 'not-running') {
        // Not running is the state "stop" wants, so it succeeds (keeps `stop && start` working).
        displayInfo('The agent is not running.');
      } else {
        displaySuccess(result.forced ? `Agent stopped (PID ${result.pid}, forced after 5 s)` : `Agent stopped (PID ${result.pid})`);
      }
      process.exit(0);
    } catch (error: any) {
      displayError(`Could not stop the agent: ${error.message}`);
      process.exit(1);
    }
  });
