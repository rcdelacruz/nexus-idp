/**
 * Docker Compose executor for provisioning resources.
 *
 * Handles the full resource lifecycle (up / down / stop / start / restart) and is built for
 * slow or intermittent internet: image pulls are explicit, report progress, honour a timeout
 * (so a slow pull can never hang forever), and are skipped when images are already cached
 * (fully-offline provisioning). Every op reports container status + connection details back.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import Mustache from 'mustache';
import {
  ProvisioningTask,
  TaskExecutionResult,
  DockerComposeConfig,
  ConnectionDetails,
} from '../types';
import { ConfigManager } from '../config/ConfigManager';
import logger from '../utils/logger';

const execAsync = promisify(exec);

/** A slow image pull must never hang forever — bounded, but generous for large images on slow links. */
const PULL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const UP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const SHORT_TIMEOUT_MS = 60 * 1000; // ps / stop / start / down

export type ProgressReporter = (phase: string, detail?: Record<string, any>) => void;

export class DockerComposeExecutor {
  private configManager: ConfigManager;
  private templatesDir: string;
  // Resolved once: the Compose CLI available on this machine — v2 `docker compose` (modern,
  // shipped as a Docker plugin) or the legacy standalone `docker-compose` binary. Modern Docker
  // installs frequently have ONLY v2, so hardcoding `docker-compose` broke on them.
  private composeCmd: string[] | null = null;

  constructor() {
    this.configManager = new ConfigManager();
    this.templatesDir = path.join(__dirname, '../../templates');
  }

  /** Detect the Compose command once: prefer `docker compose` (v2), fall back to `docker-compose`. */
  private async resolveComposeCmd(): Promise<string[]> {
    if (this.composeCmd) return this.composeCmd;
    try {
      await execAsync('docker compose version', { timeout: SHORT_TIMEOUT_MS });
      this.composeCmd = ['docker', 'compose'];
    } catch {
      try {
        await execAsync('docker-compose version', { timeout: SHORT_TIMEOUT_MS });
        this.composeCmd = ['docker-compose'];
      } catch {
        throw new Error(
          'Neither `docker compose` (v2) nor `docker-compose` (v1) is available. Install Docker Compose.',
        );
      }
    }
    logger.info(`Using compose command: ${this.composeCmd.join(' ')}`);
    return this.composeCmd;
  }

  /** Build a shell string "docker compose <args>" (or "docker-compose <args>") for execAsync. */
  private async composeExec(args: string): Promise<string> {
    const [base, ...sub] = await this.resolveComposeCmd();
    return [base, ...sub, args].join(' ');
  }

  /** Check if Docker is installed and running. */
  async checkDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version', { timeout: SHORT_TIMEOUT_MS });
      await execAsync('docker ps', { timeout: SHORT_TIMEOUT_MS });
      logger.debug('Docker is available and running');
      return true;
    } catch (error: any) {
      logger.error('Docker is not available or not running');
      logger.error(error.message);
      return false;
    }
  }

  /**
   * Provision a resource: resolve compose → pull images (progress + timeout, cache-aware) → up.
   * `onProgress` lets the agent stream interim status ("pulling kafka", "starting") to the portal.
   */
  async executeTask(
    task: ProvisioningTask,
    onProgress?: ProgressReporter,
  ): Promise<TaskExecutionResult> {
    try {
      logger.info(`Executing task ${task.task_id} for resource: ${task.resource_name}`);

      if (!(await this.checkDockerAvailable())) {
        return {
          success: false,
          error:
            'Docker is not available or not running. Please install Docker and ensure it is running.',
        };
      }

      const taskDir = this.configManager.getTaskDir(task.task_id);
      const composeContent = this.getDockerComposeContent(task);
      const composePath = path.join(taskDir, 'docker-compose.yml');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(composePath, composeContent, 'utf-8');
      logger.info(`Docker Compose file written to: ${composePath}`);
      if (!task.config.dockerCompose) {
        // Only for bundled templates (task.config.dockerCompose absent) — a pre-rendered
        // compose from the scaffolder/UI has no matching bundled asset directory to copy.
        this.copyTemplateAssets(task.task_type, taskDir);
      }
      if (task.config.sourceFiles) {
        // Scaffolder-driven templates that build images from source (e.g. devops/devsecops
        // capstone) send the source tree as part of the task payload, since there's no bundled
        // asset directory for the agent to copy from and no guarantee git is installed on the
        // trainee's machine to clone it directly.
        this.writeSourceFiles(task.config.sourceFiles, taskDir);
      }

      // Image pull — skipped entirely when cached (offline-capable), else progress-reported.
      const pullResult = await this.pullImages(taskDir, onProgress);
      if (!pullResult.success) {
        return pullResult; // network-pull failure, distinct from a config failure
      }

      onProgress?.('starting');
      const result = await this.dockerComposeUp(taskDir, task);
      return result;
    } catch (error: any) {
      logger.error(`Task execution failed: ${error.message}`);
      return { success: false, error: error.message, logs: error.stack };
    }
  }

  /**
   * Pull images with progress + a hard timeout, skipping the pull when everything is cached.
   * Returns success even with no network if the images are already local (offline provisioning).
   */
  private async pullImages(
    taskDir: string,
    onProgress?: ProgressReporter,
  ): Promise<TaskExecutionResult> {
    if (await this.imagesCached(taskDir)) {
      logger.info('All images already cached — skipping pull (offline-capable)');
      onProgress?.('images-cached');
      return { success: true };
    }

    onProgress?.('pulling-images');
    try {
      const { output } = await this.runCompose(
        ['pull'],
        taskDir,
        PULL_TIMEOUT_MS,
        line => {
          // docker-compose pull emits "Pulling <service> ..." — report per-service coarse progress.
          const m = line.match(/^Pulling\s+([^\s.]+)/i);
          if (m) onProgress?.('pulling-images', { service: m[1] });
        },
      );
      logger.info('Image pull complete');
      return { success: true, logs: output };
    } catch (error: any) {
      logger.error(`Image pull failed: ${error.message}`);
      return {
        success: false,
        error: `Failed to pull images (network?): ${error.message}. If you are offline, pre-warm images on a good connection with \`backstage-agent prewarm\`.`,
        logs: error.message,
      };
    }
  }

  /** True when every image referenced by the compose file is already present locally. */
  private async imagesCached(taskDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(await this.composeExec('config --images'), {
        cwd: taskDir,
        timeout: SHORT_TIMEOUT_MS,
      });
      const images = stdout.split('\n').map(s => s.trim()).filter(Boolean);
      if (images.length === 0) return false;
      for (const image of images) {
        const { stdout: found } = await execAsync(
          `docker images -q ${JSON.stringify(image)}`,
          { timeout: SHORT_TIMEOUT_MS },
        );
        if (!found.trim()) return false;
      }
      return true;
    } catch {
      return false; // if we cannot tell, don't skip the pull
    }
  }

  /** docker-compose up -d with a timeout; reports container status + connection details. */
  private async dockerComposeUp(
    taskDir: string,
    task: ProvisioningTask,
  ): Promise<TaskExecutionResult> {
    try {
      logger.info(`Starting Docker Compose for resource: ${task.resource_name}`);
      const { output } = await this.runCompose(
        ['up', '-d'],
        taskDir,
        UP_TIMEOUT_MS,
      );

      if (!(await this.validateContainers(taskDir))) {
        throw new Error('Docker containers failed to start');
      }

      const containers = await this.getContainerInfo(taskDir);
      const connectionDetails = this.extractConnectionDetails(task, containers);

      return {
        success: true,
        metadata: { resourceName: task.resource_name, containers, directory: taskDir },
        connectionDetails,
        logs: output,
      };
    } catch (error: any) {
      logger.error(`Docker Compose execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs: error.stderr || error.stdout || error.message,
      };
    }
  }

  /** Build "how to connect" details from published container ports and the resource type. */
  private extractConnectionDetails(
    task: ProvisioningTask,
    containers: any[],
  ): ConnectionDetails {
    const ports: Record<string, number> = {};
    for (const c of containers) {
      const publishers = c.Publishers || c.publishers || [];
      for (const p of publishers) {
        const published = p.PublishedPort || p.published;
        const service = c.Service || c.service || c.Name || 'service';
        if (published) ports[service] = Number(published);
      }
    }

    const host = 'localhost';
    const primaryPort = Object.values(ports)[0] ?? task.config.port;
    let connectionString: string | undefined;
    switch (task.task_type) {
      case 'provision-postgres':
        connectionString = `postgresql://${host}:${primaryPort ?? 5432}`;
        break;
      case 'provision-redis':
        connectionString = `redis://${host}:${primaryPort ?? 6379}`;
        break;
      case 'provision-mongodb':
        connectionString = `mongodb://${host}:${primaryPort ?? 27017}`;
        break;
      case 'provision-kafka':
        connectionString = `${host}:${primaryPort ?? 9092}`;
        break;
      default:
        connectionString = primaryPort ? `${host}:${primaryPort}` : undefined;
    }

    // uiPort (Kafka UI) or frontendPort (devops/devsecops capstone) — whichever browsable
    // dashboard this resource type has — becomes a proper http:// URL so the drawer can
    // render it as a real link, not just a raw host:port in the ports list.
    const uiPort = task.config.uiPort ?? task.config.frontendPort;
    const ui = uiPort ? `http://${host}:${uiPort}` : undefined;
    return { host, ports, connectionString, ui };
  }

  /** Resolve docker-compose.yml from the task config, falling back to a bundled template. */
  private getDockerComposeContent(task: ProvisioningTask): string {
    if (task.config.dockerCompose) {
      logger.debug('Using pre-rendered docker-compose.yml from task config');
      return task.config.dockerCompose;
    }

    const templateName = this.getTemplateForTaskType(task.task_type);
    const templatePath = path.join(this.templatesDir, templateName, 'docker-compose.yml');
    if (fs.existsSync(templatePath)) {
      logger.info(`Rendering bundled template for ${task.task_type}`);
      const template = fs.readFileSync(templatePath, 'utf-8');
      const templateData: DockerComposeConfig = {
        resourceName: task.resource_name,
        kafkaVersion: task.config.kafkaVersion || '7.5.0',
        port: task.config.port || 9092,
        zookeeperPort: task.config.zookeeperPort || 2181,
        uiPort: task.config.uiPort || 8080,
        autoCreateTopics:
          task.config.autoCreateTopics !== undefined ? task.config.autoCreateTopics : true,
        numPartitions: task.config.numPartitions || 3,
        replicationFactor: task.config.replicationFactor || 1,
        ...task.config,
      };
      return Mustache.render(template, templateData);
    }

    throw new Error(
      `No docker-compose.yml for ${task.task_type}: provide it via the scaffolder/UI, or ship a bundled template.`,
    );
  }

  private async validateContainers(taskDir: string): Promise<boolean> {
    try {
      const containers = await this.getContainerInfo(taskDir);
      const allRunning =
        containers.length > 0 &&
        containers.every((c: any) => (c.State || c.state) === 'running');
      logger.info(
        allRunning
          ? `All ${containers.length} containers are running`
          : 'Some containers are not running',
      );
      return allRunning;
    } catch (error: any) {
      logger.error(`Failed to validate containers: ${error.message}`);
      return false;
    }
  }

  private async getContainerInfo(taskDir: string): Promise<any[]> {
    try {
      const { stdout } = await execAsync(await this.composeExec('ps --format json'), {
        cwd: taskDir,
        timeout: SHORT_TIMEOUT_MS,
      });
      // Newer compose emits a JSON array; older emits one object per line — handle both.
      const trimmed = stdout.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) return JSON.parse(trimmed);
      return trimmed.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (error: any) {
      logger.warn(`Failed to get container info: ${error.message}`);
      return [];
    }
  }

  private getTemplateForTaskType(taskType: string): string {
    const map: Record<string, string> = {
      'provision-kafka': 'kafka',
      'provision-postgres': 'postgres',
      'provision-redis': 'redis',
      'provision-mongodb': 'mongodb',
      'provision-devops-capstone-training': 'devops-capstone-training',
      'provision-devsecops-capstone-training': 'devsecops-capstone-training',
    };
    return map[taskType] || 'kafka';
  }

  /**
   * Materialize a flat { relativePath: base64Content } map into the task directory — how
   * scaffolder-driven "build from source" templates (devops/devsecops capstone) deliver their
   * app source to the agent, since stratpoint:local-provision only ever sent the rendered
   * docker-compose.yml text before this, leaving `build: context: ./app/...` with nothing to
   * build from. Rejects any path that would escape taskDir (defense against a compromised or
   * buggy scaffolder template writing outside the task's own directory).
   */
  private writeSourceFiles(sourceFiles: Record<string, string>, taskDir: string): void {
    const resolvedTaskDir = path.resolve(taskDir);
    for (const [relPath, base64Content] of Object.entries(sourceFiles)) {
      const destPath = path.resolve(taskDir, relPath);
      if (!destPath.startsWith(resolvedTaskDir + path.sep)) {
        logger.warn(`Refusing to write source file outside task dir: ${relPath}`);
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(base64Content, 'base64'));
    }
    logger.info(`Materialized ${Object.keys(sourceFiles).length} source file(s) into ${taskDir}`);
  }

  /**
   * Copy any bundled asset directories (e.g. `app/` source for templates that build images
   * from source rather than pulling public ones) from the template dir into the task's working
   * directory, alongside the rendered docker-compose.yml. No-op for templates that only ship a
   * docker-compose.yml (kafka/postgres/redis/mongodb — public-image-only, nothing to copy).
   */
  private copyTemplateAssets(taskType: string, taskDir: string): void {
    const templateName = this.getTemplateForTaskType(taskType);
    const templateDir = path.join(this.templatesDir, templateName);
    if (!fs.existsSync(templateDir)) return;

    for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
      if (entry.name === 'docker-compose.yml') continue; // rendered separately, not copied raw
      const src = path.join(templateDir, entry.name);
      const dest = path.join(taskDir, entry.name);
      fs.cpSync(src, dest, { recursive: true });
      logger.info(`Copied bundled template asset ${entry.name} -> ${dest}`);
    }
  }

  /**
   * Pre-pull the images for a resource type ahead of time (e.g. on good wifi before going
   * offline), so a later provision of that type works from cache with no internet.
   */
  async prewarm(taskType: string): Promise<TaskExecutionResult> {
    if (!(await this.checkDockerAvailable())) {
      return { success: false, error: 'Docker is not available or not running.' };
    }
    const dir = this.configManager.getTaskDir(`prewarm-${this.getTemplateForTaskType(taskType)}`);
    const fakeTask: ProvisioningTask = {
      task_id: `prewarm-${taskType}`,
      agent_id: '',
      user_id: '',
      task_type: taskType,
      resource_name: `prewarm-${taskType}`,
      config: {},
      status: 'pending' as any,
      created_at: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'docker-compose.yml'),
        this.getDockerComposeContent(fakeTask),
        'utf-8',
      );
      const { output } = await this.runCompose(
        ['pull'],
        dir,
        PULL_TIMEOUT_MS,
        line => {
          const m = line.match(/^Pulling\s+([^\s.]+)/i);
          if (m) logger.info(`Pulling ${m[1]}...`);
        },
      );
      return { success: true, logs: output };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ---- Lifecycle ops on an existing resource (identified by its provision taskId) ----

  /** `docker-compose stop` — keeps volumes/data, container stopped. */
  async stopResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycleOp(taskId, ['stop'], 'stopped');
  }

  /** `docker-compose start` — restart previously-stopped containers. */
  async startResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycleOp(taskId, ['start'], 'running');
  }

  /** `docker-compose restart`. */
  async restartResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycleOp(taskId, ['restart'], 'running');
  }

  private async lifecycleOp(
    taskId: string,
    args: string[],
    _state: string,
  ): Promise<TaskExecutionResult> {
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(path.join(taskDir, 'docker-compose.yml'))) {
      return { success: false, error: `Resource not found locally (task ${taskId}).` };
    }
    try {
      const { output } = await this.runCompose(
        args,
        taskDir,
        UP_TIMEOUT_MS,
      );
      const containers = await this.getContainerInfo(taskDir);
      return { success: true, metadata: { containers }, logs: output };
    } catch (error: any) {
      return { success: false, error: error.message, logs: error.message };
    }
  }

  /** Stop and remove containers + volumes for a task (`down -v`). */
  async cleanupTask(taskId: string): Promise<TaskExecutionResult> {
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(taskDir)) {
      logger.warn(`Task directory not found: ${taskDir}`);
      return { success: true, logs: 'Nothing to tear down (no local task directory).' };
    }
    try {
      logger.info(`Tearing down task ${taskId}`);
      // Grouped with ps/stop/start under SHORT_TIMEOUT_MS above (down doesn't pull images) —
      // was previously coded to UP_TIMEOUT_MS (5 min) by mistake, so a wedged teardown made
      // the agent look hung for far longer than necessary before its own timeout even fired.
      const { output } = await this.runCompose(
        ['down', '-v'],
        taskDir,
        SHORT_TIMEOUT_MS,
      );
      logger.info('Teardown completed');
      return { success: true, logs: output };
    } catch (error: any) {
      logger.error(`Teardown failed: ${error.message}`);
      return { success: false, error: error.message, logs: error.message };
    }
  }

  /**
   * Run a command streaming stdout/stderr, with a hard timeout (SIGKILL on expiry) so a slow
   * or wedged docker operation can never hang the agent. `onLine` receives each output line.
   */
  /** Run a Compose subcommand using the detected CLI (docker compose | docker-compose). */
  private async runCompose(
    args: string[],
    cwd: string,
    timeoutMs: number,
    onLine?: (line: string) => void,
  ): Promise<{ code: number; output: string }> {
    const [base, ...sub] = await this.resolveComposeCmd();
    return this.runWithProgress(base, [...sub, ...args], cwd, timeoutMs, onLine);
  }

  private runWithProgress(
    cmd: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    onLine?: (line: string) => void,
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      // detached: true (POSIX) makes `child` the leader of a new process group, so killing
      // -child.pid on timeout reaches any subprocesses docker/docker-compose spawns too — a
      // plain child.kill() only signals the wrapper CLI itself, which can leave a wedged
      // compose operation (a container not responding to its stop signal, a busy volume)
      // running and the agent looking permanently hung even after "timing out."
      const child = spawn(cmd, args, { cwd, detached: process.platform !== 'win32' });
      let output = '';
      const killTree = (signal: NodeJS.Signals) => {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            // Fall through to single-process kill (e.g. group already gone).
          }
        }
        child.kill(signal);
      };
      const timer = setTimeout(() => {
        killTree('SIGKILL');
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd} ${args.join(' ')}`));
      }, timeoutMs);

      const onData = (buf: Buffer) => {
        const text = buf.toString();
        output += text;
        if (onLine) {
          for (const line of text.split('\n')) {
            const t = line.trim();
            if (t) onLine(t);
          }
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve({ code: 0, output });
        else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}: ${output.slice(-500)}`));
      });
    });
  }
}
