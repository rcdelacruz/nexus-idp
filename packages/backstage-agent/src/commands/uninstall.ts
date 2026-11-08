/**
 * Uninstall command: `backstage-agent uninstall` (also `backstage-agent --uninstall`).
 * Removes the agent from this machine. The login, logs and labs are kept.
 */
import { Command } from 'commander';
import * as os from 'os';
import { displayError, displayInfo, displaySuccess } from '../utils/logo';
import { PACKAGE_ROOT } from '../utils/installLocation';
import { stopAgent } from '../utils/stopAgent';
import { uninstallGlobal } from '../utils/selfUpdate';
import { uninstall } from '../utils/uninstall';

const PACKAGE_NAME = '@stratpoint/backstage-agent';

/** Returns the process exit code. */
export async function runUninstall(): Promise<number> {
  displayInfo('Removing the Backstage Agent...');
  const report = await uninstall({
    packageRoot: PACKAGE_ROOT,
    homeDir: os.homedir(),
    env: process.env,
    platform: process.platform,
    stop: () => stopAgent(),
    npmUninstall: prefix => uninstallGlobal(prefix, PACKAGE_NAME),
  });

  if (report.kind === 'other') {
    displayInfo(`This copy of the agent runs from ${PACKAGE_ROOT}. It was not put there by the installer or by "npm install -g", so there is nothing for --uninstall to remove.`);
    return 0;
  }
  for (const line of report.done) displaySuccess(line);
  for (const problem of report.problems) displayError(problem);
  if (report.problems.length) {
    displayInfo('Some steps did not work (above). Fix that and run backstage-agent --uninstall again, or remove what is left by hand.');
    return 1;
  }
  displaySuccess('The Backstage Agent is removed.');
  displayInfo(
    `Kept: your login, logs and labs${report.keptIn ? ` in ${report.keptIn}` : ' in ~/.backstage-agent'}. Labs that are running keep running. Delete that folder as well to remove everything. Windows that are already open may still list the command until you open a new one.`,
  );
  return 0;
}

export const uninstallCommand = new Command('uninstall')
  .description('Remove the agent from this machine (your login, logs and labs are kept). Same as: backstage-agent --uninstall')
  .action(async () => {
    process.exit(await runUninstall());
  });
