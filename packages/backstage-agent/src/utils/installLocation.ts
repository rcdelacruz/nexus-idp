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
