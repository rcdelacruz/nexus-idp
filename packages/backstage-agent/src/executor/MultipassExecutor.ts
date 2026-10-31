/**
 * VM labs (training platform Phase 7, the Linux capstone): an Ubuntu VM on the trainee's own
 * machine via Multipass (macOS, Windows, Linux), driven like the Docker labs — provision, stop,
 * start, restart, remove — plus instructor jobs (grading) that run inside the VM.
 *
 * Provision: launch → transfer the seed bundle → run the seed inside the VM (it reports its outputs
 * to the portal with the lab's single-use token; nothing instructor-only stays in the VM) →
 * snapshot "seeded" (best-effort; resets are re-provisions otherwise) → report how to SSH in.
 * The trainee gets a dedicated SSH key in ~/.backstage-agent/keys/<instance>.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { ProvisioningTask, TaskExecutionResult } from '../types';
import { GitRunner, repoDirName, runGit } from './workspaceClone';
import { OutputTail, percentIn } from './progress';

export interface VmSpec {
  /** Multipass image, e.g. "24.04". */
  image: string;
  cpus: number;
  memoryGb: number;
  diskGb: number;
  /** Seed bundle: flat file name → base64. Transferred to /tmp/lab-seed in the VM. */
  seedFiles: Record<string, string>;
  /** Run inside the VM with sudo from /tmp/lab-seed, e.g. ["bash", "/tmp/lab-seed/run-seed.sh"]. */
  seedCommand: string[];
  /** Environment for the seed command (e.g. SEED_REPORT_URL, SEED_TOKEN, TRAINEE_NO). */
  seedEnv?: Record<string, string>;
  /** Linux user the trainee logs in as (created by the seed with the dedicated public key). */
  sshUser: string;
}

export type Run = (
  cmd: string,
  args: string[],
  timeoutMs: number,
  /** Output as it arrives (stdout and stderr), for live progress. */
  onOutput?: (chunk: string) => void,
) => Promise<{ code: number; stdout: string; stderr: string; missing?: boolean }>;

/** Keeps only the end of very long output (a seed can print a lot). */
const MAX_CAPTURE = 4 * 1024 * 1024;

export const runCmd: Run = (cmd, args, timeoutMs, onOutput) =>
  new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: { code: number; stdout: string; stderr: string; missing?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: 1, stdout, stderr: `${stderr}\nTimed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => {
      stdout = (stdout + b.toString()).slice(-MAX_CAPTURE);
      onOutput?.(b.toString());
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-MAX_CAPTURE);
      onOutput?.(b.toString());
    });
    child.on('error', (err: any) =>
      finish({ code: 1, stdout, stderr: stderr || String(err.message), ...(err?.code === 'ENOENT' ? { missing: true } : {}) }),
    );
    child.on('close', code => finish({ code: code ?? 1, stdout, stderr }));
  });

const NAME = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Starts the seed DETACHED inside the VM and returns at once: its own session (setsid), output to
 * a log, exit code to a file. Running the seed on the `multipass exec` connection itself hung for
 * good on the Linux capstone — the course seed deliberately leaves programs running (a lock holder,
 * services), and `multipass exec` waits for every process holding its session. The agent then
 * reads the exit file and the log's tail with short commands instead (see waitForSeed).
 * Usage: lab-run.sh [NAME=value ...] command [args ...]   (LAB_LOG_DIR only for tests)
 */
export const SEED_RUNNER = `#!/bin/bash
set -u
dir="\${LAB_LOG_DIR:-/var/log}"
rm -f "$dir/lab-seed.exit"
: > "$dir/lab-seed.log"
setsid bash -c 'cd /tmp && env "$@" >>"$0/lab-seed.log" 2>&1 </dev/null; echo $? >"$0/lab-seed.exit"' "$dir" "$@" </dev/null >/dev/null 2>&1 &
echo started
`;
const SEED_LOG = '/var/log/lab-seed.log';
const SEED_EXIT = '/var/log/lab-seed.exit';
/** How often the agent looks at a running seed, and how long it waits in total. */
const SEED_POLL_MS = 5000;
const SEED_MAX_MS = 60 * 60_000;

export function validateVmSpec(v: any): string | undefined {
  if (!v || typeof v !== 'object') return 'vm must be an object';
  if (typeof v.image !== 'string' || !/^[0-9a-z.:-]{1,32}$/.test(v.image)) return 'invalid image';
  for (const [k, max] of [['cpus', 16], ['memoryGb', 64], ['diskGb', 256]] as const) {
    if (!Number.isInteger(v[k]) || v[k] < 1 || v[k] > max) return `invalid ${k}`;
  }
  if (!v.seedFiles || typeof v.seedFiles !== 'object') return 'seedFiles must be an object';
  for (const [n, b] of Object.entries(v.seedFiles)) if (!/^[A-Za-z0-9._-]+$/.test(n) || n === '.' || n === '..' || typeof b !== 'string') return `invalid seed file ${n}`;
  if (!Array.isArray(v.seedCommand) || !v.seedCommand.length || v.seedCommand.some((a: unknown) => typeof a !== 'string')) return 'invalid seedCommand';
  if (v.seedEnv && Object.entries(v.seedEnv).some(([k, val]) => !/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof val !== 'string')) return 'invalid seedEnv';
  if (typeof v.sshUser !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(v.sshUser)) return 'invalid sshUser';
  return undefined;
}

/** Multipass instance name from the resource name (Multipass: letters, digits, hyphens). */
export function instanceName(resourceName: string): string {
  const n = resourceName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63).replace(/-$/, '');
  return /^[a-z]/.test(n) ? n : `lab-${n}`.slice(0, 63);
}

const INSTALL_STEPS =
  '  • macOS: brew install --cask multipass  (or the installer from multipass.run)\n' +
  '  • Windows: the installer from multipass.run (Hyper-V on Pro/Enterprise, VirtualBox on Home)\n' +
  '  • Linux: sudo snap install multipass';
const INSTALL_HINT = `Multipass is not installed. Install it, then provision again:\n${INSTALL_STEPS}`;
/** An existing VM lab, but this machine can't run multipass (uninstalled, or not on PATH). */
const MISSING_HINT = `Multipass is not installed (or not on your PATH), so this VM lab can't be managed. Install it:\n${INSTALL_STEPS}`;

export class MultipassExecutor {
  constructor(
    private readonly configManager: ConfigManager,
    private readonly run: Run = runCmd,
    private readonly bin: string = process.env.BACKSTAGE_AGENT_MULTIPASS || 'multipass',
    private readonly keysDir: string = path.join(os.homedir(), '.backstage-agent', 'keys'),
    readonly gitRunner: GitRunner = runGit,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Wait for the detached seed (SEED_RUNNER): every few seconds read its exit file and the last
   * lines of its log with a short `multipass exec`. Output goes to the portal as live progress.
   * A poll that fails (the VM busy, a moment without SSH) is retried; only the overall limit or the
   * seed's own non-zero exit fails the step.
   */
  private async waitForSeed(instance: string, onProgress?: (phase: string, detail?: Record<string, unknown>) => void): Promise<{ code: number; output: string }> {
    const label = 'Setting up the server';
    const started = this.clock();
    let output = '';
    let failures = 0;
    while (this.clock() - started < SEED_MAX_MS) {
      await this.sleep(SEED_POLL_MS);
      const r = await this.mp(
        ['exec', instance, '--', 'sudo', 'sh', '-c', `printf 'EXIT:%s\\n' "$(cat ${SEED_EXIT} 2>/dev/null)"; tail -n 25 ${SEED_LOG} 2>/dev/null`],
        60_000,
      );
      const m = r.code === 0 ? /^EXIT:(\d*)\n?([\s\S]*)$/.exec(r.stdout) : null;
      if (!m) {
        failures++;
        onProgress?.(label, { output: `${output}${output ? '\n' : ''}(could not reach the VM to check on the setup — retrying; ${failures} so far)` });
        continue;
      }
      failures = 0;
      output = m[2].trimEnd();
      onProgress?.(label, { output });
      if (m[1] !== '') return { code: Number(m[1]), output };
    }
    return { code: 124, output: `${output}\nThe server setup did not finish within ${SEED_MAX_MS / 60_000} minutes.` };
  }

  /** True when this task's lab is a VM (lifecycle ops are routed here instead of Docker). */
  isVmTask(taskId: string): boolean {
    return fs.existsSync(path.join(this.configManager.getTaskDir(taskId), 'multipass.json'));
  }

  private state(taskId: string): { instance: string; sshUser: string; keyPath: string } {
    return JSON.parse(fs.readFileSync(path.join(this.configManager.getTaskDir(taskId), 'multipass.json'), 'utf8'));
  }

  private mp(args: string[], timeoutMs = 10 * 60_000, onOutput?: (chunk: string) => void) {
    return this.run(this.bin, args, timeoutMs, onOutput);
  }

  async executeTask(task: ProvisioningTask, onProgress?: (phase: string, detail?: Record<string, unknown>) => void): Promise<TaskExecutionResult> {
    const spec = task.config.vm as VmSpec;
    const invalid = validateVmSpec(spec);
    if (invalid) return { success: false, error: `Invalid VM lab: ${invalid}` };

    const version = await this.mp(['version'], 30_000);
    if (version.code !== 0) return { success: false, error: INSTALL_HINT };

    const instance = instanceName(task.resource_name);
    if (!NAME.test(instance)) return { success: false, error: `Cannot derive a VM name from ${task.resource_name}` };
    const taskDir = this.configManager.getTaskDir(task.task_id);
    fs.mkdirSync(taskDir, { recursive: true });
    const logs: string[] = [];
    // Each step reports its name; long ones also stream their output (and a percentage when the
    // command prints one, e.g. the Ubuntu image download) to the portal's activity timeline.
    const step = async (label: string, args: string[], timeoutMs?: number, live = false) => {
      onProgress?.(label);
      const tail = new OutputTail();
      const r = await this.mp(
        args,
        timeoutMs,
        live && onProgress
          ? chunk => {
              tail.push(chunk);
              // A progress bar redraws with "\r", so the latest frame is the last non-empty piece.
              const frames = chunk.split(/[\r\n]/).filter(f => f.trim());
              const percent = percentIn(frames[frames.length - 1] ?? '');
              onProgress(label, { output: tail.text(), ...(percent !== undefined ? { progress: { percent } } : {}) });
            }
          : undefined,
      );
      logs.push(`$ multipass ${args[0]} … (${label}) → ${r.code}`, (r.stdout + r.stderr).trim().slice(-2000));
      if (r.code !== 0) throw new Error(`${label} failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
      return r;
    };

    try {
      // Dedicated SSH key for the trainee user the seed creates.
      fs.mkdirSync(this.keysDir, { recursive: true, mode: 0o700 });
      const keyPath = path.join(this.keysDir, instance);
      if (!fs.existsSync(keyPath)) {
        const k = await this.run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${spec.sshUser}@${instance}`, '-f', keyPath], 30_000);
        if (k.code !== 0) return { success: false, error: `ssh-keygen failed: ${k.stderr.trim()}` };
      }
      fs.writeFileSync(path.join(taskDir, 'multipass.json'), JSON.stringify({ instance, sshUser: spec.sshUser, keyPath }));

      await step('Creating the VM', ['launch', spec.image, '--name', instance, '--cpus', String(spec.cpus), '--memory', `${spec.memoryGb}G`, '--disk', `${spec.diskGb}G`], 20 * 60_000, true);

      // Seed bundle (+ the trainee's public key) → /tmp/lab-seed inside the VM.
      const bundle = path.join(taskDir, 'seed');
      fs.rmSync(bundle, { recursive: true, force: true });
      fs.mkdirSync(bundle, { recursive: true });
      for (const [n, b64] of Object.entries(spec.seedFiles)) fs.writeFileSync(path.join(bundle, n), Buffer.from(b64, 'base64'));
      fs.copyFileSync(`${keyPath}.pub`, path.join(bundle, 'trainee.pub'));
      fs.writeFileSync(path.join(bundle, 'lab-run.sh'), SEED_RUNNER, { mode: 0o755 });
      await step('Copying the lab files into the VM', ['exec', instance, '--', 'mkdir', '-p', '/tmp/lab-seed'], 60_000);
      for (const n of fs.readdirSync(bundle)) await step('Copying the lab files into the VM', ['transfer', path.join(bundle, n), `${instance}:/tmp/lab-seed/${n}`], 5 * 60_000);
      fs.rmSync(bundle, { recursive: true, force: true }); // seed script never stays on the host

      const env = Object.entries(spec.seedEnv ?? {}).map(([k, v]) => `${k}=${v}`);
      await step('Setting up the server', ['exec', instance, '--', 'sudo', 'bash', '/tmp/lab-seed/lab-run.sh', ...env, ...spec.seedCommand], 2 * 60_000);
      const seed = await this.waitForSeed(instance, onProgress);
      logs.push(`[seed] exit ${seed.code}`, seed.output.slice(-4000));
      if (seed.code !== 0) {
        throw new Error(`Setting up the server failed (exit ${seed.code}): ${seed.output.trim().split('\n').pop() ?? ''}`);
      }

      // Snapshot for resets (best-effort: not every Multipass backend supports snapshots).
      let snapshot = false;
      onProgress?.('Saving a snapshot (for resets)');
      if ((await this.mp(['stop', instance], 5 * 60_000)).code === 0) {
        snapshot = (await this.mp(['snapshot', '--name', 'seeded', instance], 5 * 60_000)).code === 0;
        await step('Starting the VM', ['start', instance], 10 * 60_000);
      }

      const details = await this.connection(instance, spec.sshUser, keyPath);
      return {
        success: true,
        logs: logs.join('\n').slice(-64 * 1024),
        connectionDetails: details,
        metadata: { vm: { instance, snapshot, keyPath, multipass: version.stdout.trim().split('\n')[0] } },
      };
    } catch (e: any) {
      return { success: false, error: e.message, logs: logs.join('\n').slice(-64 * 1024) };
    }
  }

  private async connection(instance: string, sshUser: string, keyPath: string) {
    const info = await this.mp(['info', instance, '--format', 'json'], 60_000);
    let ip: string | undefined;
    try {
      ip = JSON.parse(info.stdout).info?.[instance]?.ipv4?.[0];
    } catch {
      ip = undefined;
    }
    return {
      host: ip,
      ports: { ssh: 22 },
      connectionString: ip ? `ssh -i ${keyPath} ${sshUser}@${ip}` : `multipass shell ${instance}`,
    };
  }

  async stopResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycle(taskId, ['stop']);
  }
  async startResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycle(taskId, ['start']);
  }
  async restartResource(taskId: string): Promise<TaskExecutionResult> {
    return this.lifecycle(taskId, ['restart']);
  }

  /** Remove the VM for good (and its key and task folder). The trainee's repo clone is never touched. */
  async cleanupTask(taskId: string): Promise<TaskExecutionResult> {
    if (!this.isVmTask(taskId)) return { success: true };
    const { instance, keyPath } = this.state(taskId);
    const r = await this.mp(['delete', '--purge', instance], 10 * 60_000);
    if (r.missing) return { success: false, error: MISSING_HINT };
    const gone = r.code === 0 || /does not exist/i.test(r.stderr);
    if (gone) {
      fs.rmSync(keyPath, { force: true });
      fs.rmSync(`${keyPath}.pub`, { force: true });
      fs.rmSync(this.configManager.getTaskDir(taskId), { recursive: true, force: true });
    }
    return gone ? { success: true, logs: r.stdout } : { success: false, error: r.stderr.trim() || 'multipass delete failed' };
  }

  private async lifecycle(taskId: string, args: string[]): Promise<TaskExecutionResult> {
    if (!this.isVmTask(taskId)) return { success: false, error: `VM lab not found locally (task ${taskId}).` };
    const { instance, sshUser, keyPath } = this.state(taskId);
    const r = await this.mp([...args, instance], 10 * 60_000);
    if (r.missing) return { success: false, error: MISSING_HINT };
    if (r.code !== 0) return { success: false, error: r.stderr.trim() || `multipass ${args[0]} failed` };
    return { success: true, logs: r.stdout, ...(args[0] === 'stop' ? {} : { connectionDetails: await this.connection(instance, sshUser, keyPath) }) };
  }

  /**
   * Instructor job inside the VM (e.g. the Linux grader, which inspects the server itself): clone
   * the trainee's submitted repo on this machine with their own git login, copy it and the job files
   * into the VM, run the command as root, return the out file, and clean up both sides.
   */
  async runJob(
    taskId: string,
    job: { files: Record<string, string>; clone?: { url: string; ref?: string }; command: string[]; outFile?: string; timeoutMs?: number },
  ): Promise<TaskExecutionResult> {
    if (!this.isVmTask(taskId)) return { success: false, error: `VM lab not found locally (task ${taskId}).` };
    for (const n of Object.keys(job.files ?? {})) if (!/^[A-Za-z0-9._-]+$/.test(n) || n === 'repo') return { success: false, error: `invalid job file ${n}` };
    if (!Array.isArray(job.command) || !job.command.length || job.command.some(a => typeof a !== 'string')) return { success: false, error: 'invalid job command' };
    if (job.outFile !== undefined && !/^[A-Za-z0-9._-]+$/.test(job.outFile)) return { success: false, error: 'invalid outFile' };
    const { instance } = this.state(taskId);
    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-job-'));
    const remote = `/tmp/lab-job-${path.basename(local)}`;
    try {
      for (const [n, b64] of Object.entries(job.files)) fs.writeFileSync(path.join(local, n), Buffer.from(b64, 'base64'));
      if (job.clone) {
        if (!repoDirName(job.clone.url)) return { success: false, error: 'invalid clone url' };
        const dest = path.join(local, 'repo');
        let g = job.clone.ref ? await this.gitRunner(['clone', '--branch', job.clone.ref, '--', job.clone.url, dest]) : { code: 1, stdout: '', stderr: '' };
        if (g.code !== 0) {
          fs.rmSync(dest, { recursive: true, force: true });
          g = await this.gitRunner(['clone', '--', job.clone.url, dest]);
        }
        if (g.code !== 0) return { success: false, error: "Could not clone the trainee repo with this machine's git login" };
      }
      const t = await this.mp(['transfer', '--recursive', local, `${instance}:${remote}`], 10 * 60_000);
      if (t.code !== 0) return { success: false, error: `copying the job into the VM failed: ${t.stderr.trim()}` };
      const cmd = job.command.map(a => a.split('{{job}}').join(remote));
      const r = await this.mp(['exec', instance, '--', 'sudo', ...cmd], Math.min(job.timeoutMs ?? 15 * 60_000, 30 * 60_000));
      let out = (r.stdout + r.stderr).slice(-64 * 1024);
      if (job.outFile) {
        const o = await this.mp(['exec', instance, '--', 'sudo', 'cat', `${remote}/${job.outFile}`], 60_000);
        if (o.code === 0) out = o.stdout.slice(-64 * 1024);
      }
      return {
        success: r.code === 0,
        logs: (r.stdout + r.stderr).slice(-64 * 1024),
        metadata: { check: { exitCode: r.code, output: out } },
        ...(r.code === 0 ? {} : { error: `Job exited with ${r.code}` }),
      };
    } finally {
      await this.mp(['exec', instance, '--', 'sudo', 'rm', '-rf', remote], 60_000).catch(() => undefined);
      fs.rmSync(local, { recursive: true, force: true });
    }
  }
}
