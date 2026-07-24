/**
 * Offline resource-management commands.
 *
 * These operate entirely on local Docker + the local registry — no portal, no internet. This is
 * the offline management path: the portal UI is cloud-hosted and unreachable without a connection,
 * but a developer can still list and control their provisioned resources here.
 */

import { Command } from 'commander';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LocalResourceRegistry } from '../registry/LocalResourceRegistry';
import { DockerComposeExecutor } from '../executor/DockerComposeExecutor';
import logger from '../utils/logger';

const execAsync = promisify(exec);

export const resourcesCommand = new Command('resources')
  .description('List locally-provisioned resources (works offline)')
  .action(() => {
    const registry = new LocalResourceRegistry();
    const resources = registry.list();
    if (resources.length === 0) {
      logger.info('No local resources. Provision one from the portal, then it appears here.');
      return;
    }
    logger.info(`Local resources (${resources.length}):\n`);
    for (const r of resources) {
      const conn = r.connectionDetails?.connectionString
        ? `  ${r.connectionDetails.connectionString}`
        : '';
      // eslint-disable-next-line no-console
      console.log(`  ${r.resourceName}  [${r.taskType}]  ${r.state}${conn}`);
    }
  });

export const resourceCommand = new Command('resource')
  .description('Manage a local resource offline: stop | start | restart | logs | remove <name>')
  .argument('<action>', 'stop | start | restart | logs | remove')
  .argument('<name>', 'resource name (see `backstage-agent resources`)')
  .action(async (action: string, name: string) => {
    const registry = new LocalResourceRegistry();
    const executor = new DockerComposeExecutor();
    const resource = registry.get(name);

    if (!resource) {
      logger.error(`Resource "${name}" not found. Run \`backstage-agent resources\` to list.`);
      process.exit(1);
    }

    try {
      switch (action) {
        case 'stop': {
          const r = await executor.stopResource(resource.taskId);
          if (!r.success) throw new Error(r.error);
          registry.setState(name, 'stopped');
          logger.info(`Stopped ${name}`);
          break;
        }
        case 'start': {
          const r = await executor.startResource(resource.taskId);
          if (!r.success) throw new Error(r.error);
          registry.setState(name, 'running');
          logger.info(`Started ${name}`);
          break;
        }
        case 'restart': {
          const r = await executor.restartResource(resource.taskId);
          if (!r.success) throw new Error(r.error);
          registry.setState(name, 'running');
          logger.info(`Restarted ${name}`);
          break;
        }
        case 'remove': {
          const r = await executor.cleanupTask(resource.taskId);
          if (!r.success) throw new Error(r.error);
          registry.remove(name);
          logger.info(`Removed ${name} (containers + volumes deleted)`);
          break;
        }
        case 'logs': {
          const { stdout } = await execAsync('docker-compose logs --tail 200', {
            cwd: resource.taskDir,
          });
          // eslint-disable-next-line no-console
          console.log(stdout);
          break;
        }
        default:
          logger.error(`Unknown action "${action}". Use stop | start | restart | logs | remove.`);
          process.exit(1);
      }
    } catch (error: any) {
      logger.error(`Failed to ${action} ${name}: ${error.message}`);
      process.exit(1);
    }
  });
