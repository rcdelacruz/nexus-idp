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

// Parse arguments
program.parse();
