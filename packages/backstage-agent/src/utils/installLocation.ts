import * as fs from 'fs';
import * as path from 'path';

/** This copy's package folder (…/node_modules/@stratpoint/backstage-agent); compiled code lives in dist/<dir>/. */
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The npm global prefix this copy was installed into, or undefined when it isn't a global npm
 * install (a clone, npx). `npm install -g` writes to the *shell's* prefix, which is a different
 * folder on a machine with two Node installs (Homebrew + nvm, say) — so the updater must target
 * this one, or it "updates" a copy nobody runs.
 *   macOS/Linux: <prefix>/lib/node_modules/@scope/name    Windows: <prefix>\node_modules\@scope\name
 */
export function globalPrefixOf(root: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const nodeModules = p.dirname(p.dirname(p.resolve(root)));
  if (p.basename(nodeModules) !== 'node_modules') return undefined;
  if (platform === 'win32') return p.dirname(nodeModules);
  const lib = p.dirname(nodeModules);
  return p.basename(lib) === 'lib' ? p.dirname(lib) : undefined;
}

/** The version actually on disk now (read fresh — require() would return the cached, pre-update one). */
export function installedVersion(root: string = PACKAGE_ROOT): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

/**
 * The npm that belongs to the Node running this agent, and an environment with that Node's folder first on the PATH.
 * `update` runs npm by name; in a terminal that has no node or npm of its own (nvm not loaded, an agent started through
 * the installer's launcher) that fails with "command not found" even though the agent itself is running fine.
 * Windows keeps node on the system PATH, so it is left alone there.
 */
export function npmForThisNode(
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  exists: (p: string) => boolean = fs.existsSync,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; env: NodeJS.ProcessEnv } {
  if (platform === 'win32') return { command: 'npm', env };
  const dir = path.dirname(execPath);
  const npm = path.join(dir, 'npm');
  return {
    command: exists(npm) ? npm : 'npm',
    env: { ...env, PATH: [dir, env.PATH].filter(Boolean).join(':') },
  };
}

/**
 * The npm command for installing a version into this copy's own prefix: `shown` is what to tell a person to type,
 * `run` is what the agent executes (the npm that belongs to the running Node, quoted).
 */
export function npmInstallCommand(prefix: string | undefined, spec: string, npmCommand: string): { shown: string; run: string } {
  const args = `install -g ${prefix ? `--prefix "${prefix}" ` : ''}${spec}`;
  return { shown: `npm ${args}`, run: `"${npmCommand}" ${args}` };
}
