/**
 * CLI setup with Commander.js
 */

import { Command } from 'commander';
import { loginCommand } from './commands/login';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { logoutCommand } from './commands/logout';
import { statusCommand } from './commands/status';
import { resourcesCommand, resourceCommand } from './commands/resources';
import { prewarmCommand } from './commands/prewarm';
import { updateCommand } from './commands/update';
import { uninstallCommand } from './commands/uninstall';
import { displayLogo, logoText } from './utils/logo';

// Read version from package.json
const packageJson = require('../package.json');

const program = new Command();

program
  .name('backstage-agent')
  .description('Backstage Local Provisioner Agent - Provision local development resources')
  .version(packageJson.version);

// The banner heads every command and every help screen, printed once here rather than in each
// command. Machine-readable output (--json) stays clean.
program.hook('preAction', (_program, actionCommand) => {
  if (actionCommand.opts().json) return;
  displayLogo();
});
program.addHelpText('beforeAll', () => logoText());

// Add commands
program.addCommand(loginCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(logoutCommand);
program.addCommand(statusCommand);
program.addCommand(resourcesCommand);
program.addCommand(resourceCommand);
program.addCommand(prewarmCommand);
program.addCommand(updateCommand);
program.addCommand(uninstallCommand);

// `backstage-agent --uninstall` is the same as `backstage-agent uninstall`: listed under Options for people who look for the flag, and
// rewritten to the command (the only thing it can mean) before parsing.
program.option('--uninstall', 'Remove the agent from this machine (same as: backstage-agent uninstall)');
if (process.argv.length === 3 && process.argv[2] === '--uninstall') process.argv[2] = 'uninstall';

// Parse arguments
program.parse();
