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

// Read version from package.json
const packageJson = require('../package.json');

const program = new Command();

program
  .name('backstage-agent')
  .description('Backstage Local Provisioner Agent - Provision local development resources')
  .version(packageJson.version);

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
