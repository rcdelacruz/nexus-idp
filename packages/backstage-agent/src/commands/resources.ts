/**
 * Offline resource-management commands.
 *
 * These operate entirely on local Docker / Multipass + the local registry — no portal, no
 * internet. This is the offline management path: the portal UI is cloud-hosted and unreachable
 * without a connection, but a developer can still list and control their provisioned resources here.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { LocalResourceRegistry } from '../registry/LocalResourceRegistry';
import { DockerComposeExecutor } from '../executor/DockerComposeExecutor';
import { MultipassExecutor } from '../executor/MultipassExecutor';
import { ConfigManager } from '../config/ConfigManager';
import { TaskExecutionResult } from '../types';
import { displayError, displayInfo, displaySuccess } from '../utils/logo';

/** One local resource's lifecycle ops: a Multipass VM lab or a Docker Compose resource, like the daemon routes them. */
export interface LocalExecutor {
  stopResource(taskId: string): Promise<TaskExecutionResult>;
  startResource(taskId: string): Promise<TaskExecutionResult>;
  restartResource(taskId: string): Promise<TaskExecutionResult>;
  cleanupTask(taskId: string): Promise<TaskExecutionResult>;
}

export function executorFor(taskId: string, vm: MultipassExecutor, docker: DockerComposeExecutor): { kind: 'vm' | 'docker'; executor: LocalExecutor } {
  return vm.isVmTask(taskId) ? { kind: 'vm', executor: vm } : { kind: 'docker', executor: docker };
}

const STATE_COLOR: Record<string, (s: string) => string> = {
  running: chalk.green,
  stopped: chalk.yellow,
};

export const resourcesCommand = new Command('resources')
  .description('List locally-provisioned resources (works offline)')
  .action(() => {
    const resources = new LocalResourceRegistry().list();
    if (resources.length === 0) {
      displayInfo('No local resources yet. Provision one from the portal and it appears here.');
      return;
    }
    const nameW = Math.max(4, ...resources.map(r => r.resourceName.length));
    const stateW = Math.max(5, ...resources.map(r => r.state.length));
    console.log(`  ${chalk.dim('NAME'.padEnd(nameW))}  ${chalk.dim('STATE'.padEnd(stateW))}  ${chalk.dim('CONNECT')}`);
    for (const r of resources) {
      const color = STATE_COLOR[r.state] ?? chalk.dim;
      const connect = r.connectionDetails?.connectionString ?? '';
      console.log(`  ${r.resourceName.padEnd(nameW)}  ${color(r.state.padEnd(stateW))}  ${connect}`);
    }
    console.log('');
    console.log(chalk.dim('  Manage one offline: backstage-agent resource stop|start|restart|logs|remove <name>'));
  });

export const resourceCommand = new Command('resource')
  .description('Manage a local resource offline: stop | start | restart | logs | remove <name>')
  .argument('<action>', 'stop | start | restart | logs | remove')
  .argument('<name>', 'resource name (see `backstage-agent resources`)')
  .action(async (action: string, name: string) => {
    const registry = new LocalResourceRegistry();
    const resource = registry.get(name);
    if (!resource) {
      displayError(`No local resource named "${name}". List them with: backstage-agent resources`);
      process.exit(1);
    }

    const configManager = new ConfigManager();
    const docker = new DockerComposeExecutor();
    const { kind, executor } = executorFor(resource.taskId, new MultipassExecutor(configManager), docker);
    const fail = (r: TaskExecutionResult) => {
      throw new Error(r.error || 'unknown error');
    };

    try {
      switch (action) {
        case 'stop': {
          const r = await executor.stopResource(resource.taskId);
          if (!r.success) fail(r);
          registry.setState(name, 'stopped');
          displaySuccess(`Stopped ${name}. Its data is kept; start it again with: backstage-agent resource start ${name}`);
          break;
        }
        case 'start': {
          const r = await executor.startResource(resource.taskId);
          if (!r.success) fail(r);
          registry.setState(name, 'running');
          displaySuccess(`Started ${name}`);
          break;
        }
        case 'restart': {
          const r = await executor.restartResource(resource.taskId);
          if (!r.success) fail(r);
          registry.setState(name, 'running');
          displaySuccess(`Restarted ${name}`);
          break;
        }
        case 'remove': {
          const r = await executor.cleanupTask(resource.taskId);
          if (!r.success) fail(r);
          registry.remove(name);
          displaySuccess(kind === 'vm' ? `Removed ${name} (the VM and its key are deleted)` : `Removed ${name} (containers and volumes are deleted)`);
          break;
        }
        case 'logs': {
          if (kind === 'vm') {
            displayInfo(`${name} is a VM lab; it has no container logs. Connect to it with:`);
            console.log(`  ${resource.connectionDetails?.connectionString ?? `multipass shell ${name}`}`);
            break;
          }
          const r = await docker.logs(resource.taskId);
          if (!r.success) fail(r);
          console.log(r.logs ?? '');
          break;
        }
        default:
          displayError(`Unknown action "${action}". Use stop, start, restart, logs or remove.`);
          process.exit(1);
      }
    } catch (error: any) {
      displayError(`Could not ${action} ${name}: ${error.message}`);
      process.exit(1);
    }
  });
