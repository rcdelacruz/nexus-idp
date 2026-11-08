/**
 * `backstage-agent --uninstall`: remove the agent from this machine, whichever way it got here.
 *
 *  - installed by install.sh (~/.backstage-agent/npm + a launcher in ~/.backstage-agent/bin): stop the agent, remove the
 *    links the installer made, its lines in the shell startup files, and those two folders;
 *  - installed with `npm install -g`: stop the agent and `npm uninstall -g` this copy;
 *  - anything else (a clone, npx): nothing to remove.
 *
 * The login, logs and labs in ~/.backstage-agent are always kept.
 */
import * as fs from 'fs';
import * as path from 'path';
import { globalPrefixOf } from './installLocation';
import type { StopResult } from './stopAgent';

export const MARK_BEGIN = '# >>> backstage-agent >>>';
export const MARK_END = '# <<< backstage-agent <<<';

/**
 * The text without the installer's block. The block is only removed when both of its marker lines are there: with the end
 * marker missing (someone edited the block) nothing is cut, because "everything after the begin marker" is the rest of
 * the person's startup file.
 */
export function stripBlock(text: string): string {
  const lines = text.split('\n');
  const begin = lines.indexOf(MARK_BEGIN);
  if (begin === -1) return text;
  const end = lines.indexOf(MARK_END, begin + 1);
  if (end === -1) return text;
  return [...lines.slice(0, begin), ...lines.slice(end + 1)].join('\n');
}

export type InstallKind = { kind: 'installer'; home: string } | { kind: 'npm-global'; prefix: string } | { kind: 'other' };

/** Where this copy lives tells how it was installed. */
export function detectInstall(packageRoot: string, homeDir: string, platform: NodeJS.Platform = process.platform): InstallKind {
  if (platform !== 'win32') {
    const tail = path.sep + path.join('npm', 'lib', 'node_modules', '@stratpoint', 'backstage-agent');
    const root = path.resolve(packageRoot);
    if (root.endsWith(tail)) {
      const home = root.slice(0, root.length - tail.length);
      // The installer's folder must be a dedicated one: never the filesystem root or the person's home itself.
      if (home && path.isAbsolute(home) && home !== path.parse(home).root && path.resolve(home) !== path.resolve(homeDir)) {
        return { kind: 'installer', home };
      }
    }
  }
  const prefix = globalPrefixOf(packageRoot, platform);
  return prefix ? { kind: 'npm-global', prefix } : { kind: 'other' };
}

export interface UninstallDeps {
  packageRoot: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stop: () => Promise<StopResult>;
  npmUninstall: (prefix: string) => Promise<void>;
}

export interface UninstallReport {
  kind: InstallKind['kind'];
  /** What was done, one plain sentence each. */
  done: string[];
  /** What could not be done. */
  problems: string[];
  /** Where the kept data lives (the folder), for the closing message. */
  keptIn?: string;
}

function startupFiles(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const zdotdir = env.ZDOTDIR || homeDir;
  return [...new Set([path.join(zdotdir, '.zshrc'), path.join(homeDir, '.zshrc'), path.join(homeDir, '.bashrc'), path.join(homeDir, '.bash_profile'), path.join(homeDir, '.profile')])];
}

export async function uninstall(d: UninstallDeps): Promise<UninstallReport> {
  const install = detectInstall(d.packageRoot, d.homeDir, d.platform);
  const report: UninstallReport = { kind: install.kind, done: [], problems: [] };
  if (install.kind === 'other') return report;

  const attempt = async (what: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      report.problems.push(`${what}: ${String(e?.message ?? e).split('\n')[0]}`);
    }
  };

  await attempt('Stopping the agent', async () => {
    const stopped = await d.stop();
    if (stopped.state === 'stopped') report.done.push(`Stopped the running agent (PID ${stopped.pid}).`);
  });

  if (install.kind === 'npm-global') {
    await attempt('Removing the agent with npm', async () => {
      await d.npmUninstall(install.prefix);
      report.done.push('Removed the agent (npm uninstall -g).');
    });
    return report;
  }

  const home = install.home;
  const launcher = path.join(home, 'bin', 'backstage-agent');
  report.keptIn = home;

  // Links the installer made into folders that are on the PATH: only those that still point at its launcher.
  const linksFile = path.join(home, 'links');
  if (fs.existsSync(linksFile)) {
    for (const link of fs.readFileSync(linksFile, 'utf8').split('\n').filter(Boolean)) {
      await attempt(`Removing the link ${link}`, () => {
        if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(link) === launcher) {
          fs.unlinkSync(link);
          report.done.push(`Removed the link ${link}.`);
        }
      });
    }
  }

  // Its lines in the shell startup files (the rest of each file is left exactly as it was).
  for (const file of startupFiles(d.homeDir, d.env)) {
    await attempt(`Cleaning ${file}`, () => {
      if (!fs.existsSync(file)) return;
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(MARK_BEGIN)) return;
      const stripped = stripBlock(text);
      if (stripped === text) {
        report.problems.push(`${file}: the agent's lines were edited, so they were left alone (remove the "backstage-agent" block by hand)`);
        return;
      }
      fs.writeFileSync(file, stripped);
      report.done.push(`Removed the agent's lines from ${file}.`);
    });
  }
  const fish = path.join(d.homeDir, '.config', 'fish', 'conf.d', 'backstage-agent.fish');
  await attempt(`Cleaning ${fish}`, () => {
    if (!fs.existsSync(fish) || !fs.readFileSync(fish, 'utf8').includes(MARK_BEGIN)) return;
    fs.rmSync(fish, { force: true });
    report.done.push(`Removed ${fish}.`);
  });

  // The agent itself. Last, because this very process runs from these folders.
  await attempt('Removing the agent files', () => {
    for (const p of [path.join(home, 'npm'), path.join(home, 'bin'), linksFile]) fs.rmSync(p, { recursive: true, force: true });
    report.done.push(`Removed the agent (${path.join(home, 'npm')} and ${path.join(home, 'bin')}).`);
  });
  return report;
}
