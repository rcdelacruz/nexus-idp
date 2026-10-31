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
import { GitRunner, runGit, repoDirName } from './workspaceClone';
import { randomBytes } from 'crypto';
import logger from '../utils/logger';
import { findPortConflicts, parsePublishedPorts, portConflictMessage, portInUseFromDockerError, templateConnection } from './ports';
import { ComposeProgress, OutputTail, ProgressReporter } from './progress';

const execAsync = promisify(exec);

/** A slow image pull must never hang forever — bounded, but generous for large images on slow links. */
const PULL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const UP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const SHORT_TIMEOUT_MS = 60 * 1000; // ps / stop / start / down

export type { ProgressReporter } from './progress';

/** A one-off job next to a lab (e.g. a capstone grader), from an instructor `run-check` task. */
export interface LabJob {
  /** Container image, e.g. hashicorp/terraform:1.11.4 (name:tag only). */
  image: string;
  /** Written into the job folder (mounted at /job): flat file name → base64 content. */
  files: Record<string, string>;
  /** Cloned into /job/repo with the trainee's own git login; `ref` is tried first (e.g. a submission tag). */
  clone?: { url: string; ref?: string };
  /** Attach the job container to the network of this lab service (reach it by service name). */
  networkOfService?: string;
  command: string[];
  env?: Record<string, string>;
  /** Result file inside /job; its content becomes the check output. */
  outFile?: string;
  timeoutMs?: number;
}

/** Validates a job from the portal before anything runs. Returns an error message, or undefined. */
export function validateLabJob(job: any): string | undefined {
  if (!job || typeof job !== 'object') return 'job must be an object';
  if (typeof job.image !== 'string' || !/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/.test(job.image)) return 'invalid image';
  if (!job.files || typeof job.files !== 'object') return 'files must be an object';
  for (const [name, b64] of Object.entries(job.files)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..' || name === 'repo') return `invalid file name: ${name}`;
    if (typeof b64 !== 'string') return `invalid content for ${name}`;
  }
  if (!Array.isArray(job.command) || job.command.length === 0 || job.command.some((a: unknown) => typeof a !== 'string')) return 'command must be a non-empty string array';
  if (job.env && (typeof job.env !== 'object' || Object.entries(job.env).some(([k, v]) => !/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof v !== 'string'))) return 'invalid env';
  if (job.clone) {
    if (!repoDirName(String(job.clone.url))) return 'invalid clone url';
    if (job.clone.ref !== undefined && (typeof job.clone.ref !== 'string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(job.clone.ref) || job.clone.ref.includes('..'))) return 'invalid clone ref';
  }
  if (job.networkOfService !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(String(job.networkOfService))) return 'invalid networkOfService';
  if (job.outFile !== undefined && !/^[A-Za-z0-9._-]+$/.test(String(job.outFile))) return 'invalid outFile';
  return undefined;
}

export class DockerComposeExecutor {
  private configManager: ConfigManager;
  /** Overridable in tests (maps https URLs to local repos). */
  gitRunner: GitRunner = runGit;
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
    logger.debug(`Using compose command: ${this.composeCmd.join(' ')}`);
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

      // Taken host ports fail now, before a long image pull, with the service and port named.
      const taken = await this.portConflicts(taskDir);
      if (taken.length) {
        fs.rmSync(taskDir, { recursive: true, force: true });
        return { success: false, error: portConflictMessage(taken) };
      }

      // Image pull — skipped entirely when cached (offline-capable), else progress-reported.
      const pullResult = await this.pullImages(taskDir, onProgress);
      if (!pullResult.success) {
        return pullResult; // network-pull failure, distinct from a config failure
      }

      const result = await this.dockerComposeUp(taskDir, task, onProgress);
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

    try {
      const { output } = await this.runCompose(['pull'], taskDir, PULL_TIMEOUT_MS, this.progressLines('Downloading images', taskDir, onProgress));
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
    onProgress?: ProgressReporter,
  ): Promise<TaskExecutionResult> {
    try {
      logger.info(`Starting Docker Compose for resource: ${task.resource_name}`);
      const { output } = await this.runCompose(
        ['up', '-d'],
        taskDir,
        UP_TIMEOUT_MS,
        // `up` also builds images from source (DevOps/DevSecOps capstones): report each build step.
        this.progressLines('Starting the containers', taskDir, onProgress),
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
      // Don't leave a half-started lab holding ports (a retry with other ports must start clean).
      await this.runCompose(['down', '-v'], taskDir, SHORT_TIMEOUT_MS).catch(() => undefined);
      fs.rmSync(taskDir, { recursive: true, force: true });
      const port = portInUseFromDockerError(String(error.message));
      return {
        success: false,
        error: port
          ? portConflictMessage([{ service: 'a lab service', port, hostIp: '' }])
          : error.message,
        logs: error.stderr || error.stdout || error.message,
      };
    }
  }

  /** Host ports this lab publishes that something else already holds ([] when Compose can't say). */
  private async portConflicts(taskDir: string) {
    try {
      const { stdout } = await execAsync(await this.composeExec('config --format json'), { cwd: taskDir, timeout: SHORT_TIMEOUT_MS });
      return await findPortConflicts(parsePublishedPorts(stdout));
    } catch {
      return []; // older Compose without --format json: Docker still reports a clash at up time
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

    // A template can say how to connect: { service, url } with "{port}" for that service's
    // published port (e.g. postgresql://dev:dev@localhost:{port}/app) — the generic string above
    // has no user, password or database.
    const fromTemplate = templateConnection(task.config.connection, ports);
    if (fromTemplate) connectionString = fromTemplate;

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

  /**
   * Run a check inside one running service of an existing lab:
   * `docker compose exec -T <service> <argv…>`. The argv array is passed straight to compose (no
   * shell on this machine), runs only inside the lab's own container, and only for a lab this
   * agent provisioned. Output is capped. Exit code 0 = check passed.
   */
  async runCheck(taskId: string, service: string, argv: string[], timeoutMs = 120_000): Promise<TaskExecutionResult> {
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(path.join(taskDir, 'docker-compose.yml'))) {
      return { success: false, error: `Resource not found locally (task ${taskId}).` };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(service) || !Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== 'string')) {
      return { success: false, error: 'Invalid check: service must be a compose service name and argv a non-empty string array' };
    }
    const MAX = 64 * 1024;
    try {
      const { code, output } = await this.runCompose(['exec', '-T', service, ...argv], taskDir, Math.min(timeoutMs, 10 * 60_000));
      const out = output.length > MAX ? `${output.slice(0, MAX)}\n…(truncated)` : output;
      return { success: code === 0, logs: out, metadata: { check: { exitCode: code, output: out } }, ...(code === 0 ? {} : { error: `Check exited with ${code}` }) };
    } catch (error: any) {
      // runWithProgress rejects on a non-zero exit with "… exited with code N: <output tail>".
      const m = /exited with code (\d+): ([\s\S]*)$/.exec(String(error.message));
      const exitCode = m ? Number(m[1]) : -1;
      const output = m ? m[2] : String(error.message);
      return { success: false, error: `Check exited with ${exitCode}`, logs: output, metadata: { check: { exitCode, output } } };
    }
  }

  /**
   * Run a one-off job container next to a lab — e.g. a capstone grader that needs the trainee's
   * submitted repo and their local MiniStack. The job folder (portal files + a fresh clone of the
   * trainee repo, made with the trainee's own git login) is mounted at /job, the container joins
   * the lab's network, and everything is deleted afterwards. Instructor data in the job (a seed
   * manifest) is on this machine only for the duration of the job.
   */
  async runJob(taskId: string, job: LabJob): Promise<TaskExecutionResult> {
    const invalid = validateLabJob(job);
    if (invalid) return { success: false, error: `Invalid job: ${invalid}` };
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(path.join(taskDir, 'docker-compose.yml'))) {
      return { success: false, error: `Resource not found locally (task ${taskId}).` };
    }
    const jobDir = path.join(taskDir, 'jobs', randomBytes(6).toString('hex'));
    const MAX = 64 * 1024;
    try {
      fs.mkdirSync(jobDir, { recursive: true });
      for (const [name, b64] of Object.entries(job.files)) fs.writeFileSync(path.join(jobDir, name), Buffer.from(b64, 'base64'));

      if (job.clone) {
        const dest = path.join(jobDir, 'repo');
        let r = job.clone.ref ? await this.gitRunner(['clone', '--branch', job.clone.ref, '--', job.clone.url, dest]) : { code: 1, stdout: '', stderr: '' };
        if (r.code !== 0) {
          fs.rmSync(dest, { recursive: true, force: true });
          r = await this.gitRunner(['clone', '--', job.clone.url, dest]); // no submission tag yet → default branch
        }
        if (r.code !== 0) {
          return { success: false, error: 'Could not clone the trainee repo with this machine\'s git login', logs: r.stderr.slice(-2000) };
        }
      }

      let network: string | undefined;
      if (job.networkOfService) {
        const { output } = await this.runCompose(['ps', '-q', job.networkOfService], taskDir, 60_000);
        const id = output.trim().split('\n').pop();
        if (!id) return { success: false, error: `Lab service ${job.networkOfService} is not running` };
        const inspect = await this.runWithProgress('docker', ['inspect', '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', id], taskDir, 30_000);
        network = inspect.output.trim().split(/\s+/)[0];
      }

      const args = ['run', '--rm', '-v', `${jobDir}:/job`, '-w', '/job'];
      if (network) args.push('--network', network);
      for (const [k, v] of Object.entries(job.env ?? {})) args.push('-e', `${k}=${v}`);
      args.push('--entrypoint', job.command[0], job.image, ...job.command.slice(1));

      let code = 0;
      let output = '';
      try {
        ({ code, output } = await this.runWithProgress('docker', args, taskDir, Math.min(job.timeoutMs ?? 15 * 60_000, 30 * 60_000)));
      } catch (error: any) {
        const m = /exited with code (\d+): ([\s\S]*)$/.exec(String(error.message));
        code = m ? Number(m[1]) : -1;
        output = m ? m[2] : String(error.message);
      }
      const outPath = job.outFile ? path.join(jobDir, job.outFile) : undefined;
      const result = outPath && fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : undefined;
      const out = (result ?? output).slice(-MAX);
      return {
        success: code === 0,
        logs: output.slice(-MAX),
        metadata: { check: { exitCode: code, output: out } },
        ...(code === 0 ? {} : { error: `Job exited with ${code}` }),
      };
    } catch (error: any) {
      return { success: false, error: error.message, metadata: { check: { exitCode: -1, output: String(error.message) } } };
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
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

  /** The last `tail` log lines of every service (`compose logs`, v2 or v1 like every other op). */
  async logs(taskId: string, tail = 200): Promise<TaskExecutionResult> {
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(path.join(taskDir, 'docker-compose.yml'))) {
      return { success: false, error: `Resource not found locally (task ${taskId}).` };
    }
    try {
      const { output } = await this.runCompose(['logs', '--no-color', '--tail', String(tail)], taskDir, UP_TIMEOUT_MS);
      return { success: true, logs: output };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /** Stop and remove containers + volumes for a task (`down -v`). */
  async cleanupTask(taskId: string): Promise<TaskExecutionResult> {
    const taskDir = this.configManager.getTaskDir(taskId);
    if (!fs.existsSync(taskDir)) {
      logger.warn(`Task directory not found: ${taskDir}`);
      return { success: true, logs: 'Nothing to tear down (no local task directory).' };
    }
    if (!fs.existsSync(path.join(taskDir, 'docker-compose.yml'))) {
      // A lab that failed before it started (port clash, missing Multipass…) can leave an empty
      // folder behind (getTaskDir creates it): nothing is running, so removing it is the teardown.
      fs.rmSync(taskDir, { recursive: true, force: true });
      return { success: true, logs: 'Nothing was running; removed the empty lab folder.' };
    }
    try {
      logger.info(`Tearing down task ${taskId}`);
      // Grouped with ps/stop/start under SHORT_TIMEOUT_MS above (down doesn't pull images) —
      // was previously coded to UP_TIMEOUT_MS (5 min) by mistake, so a wedged teardown made
      // the agent look hung for far longer than necessary before its own timeout even fired.
      // --rmi local: also the images this lab built from source (a capstone's app, ~1.8 GB),
      // never the pulled ones (postgres, kafka…), which stay cached for offline provisioning.
      const { output } = await this.runCompose(
        ['down', '-v', '--rmi', 'local'],
        taskDir,
        SHORT_TIMEOUT_MS,
      );
      // The lab's folder (compose file, its source files) goes too; the trainee's own repo clone
      // lives elsewhere (~/stratpoint) and is never touched.
      fs.rmSync(taskDir, { recursive: true, force: true });
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
  /**
   * A line handler for a long compose command: keeps the last lines of output and reports the step
   * the output shows (downloading, building <service> n/m, starting), with that output attached.
   */
  private progressLines(initial: string, taskDir: string, onProgress?: ProgressReporter): ((line: string) => void) | undefined {
    if (!onProgress) return undefined;
    onProgress(initial);
    const tail = new OutputTail();
    // Compose's default project name is the folder name, lower-cased.
    const parser = new ComposeProgress(path.basename(taskDir).toLowerCase());
    let phase = initial;
    let detail: Record<string, unknown> | undefined;
    return line => {
      tail.push(`${line}\n`);
      const p = parser.line(line);
      if (p) {
        phase = p.phase;
        detail = p.detail;
      }
      onProgress(phase, { ...detail, output: tail.text() });
    };
  }

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
