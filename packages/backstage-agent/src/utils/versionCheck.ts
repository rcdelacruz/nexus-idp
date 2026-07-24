/**
 * Self-update support: check the npm registry for a newer agent version.
 *
 * A professional CLI shouldn't make users hand-run `npm install -g` every release. This backs
 * `backstage-agent update` and the automatic "update available" notice on start.
 */

import fetch from 'node-fetch';

const PACKAGE_NAME = '@stratpoint/backstage-agent';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;

export interface VersionInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/** Compare semver-ish strings (major.minor.patch). Returns true if `a` < `b`. */
export function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true;
    if ((pa[i] || 0) > (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Fetch the latest published version. Returns null on any network/parse failure so a slow or
 * offline connection never blocks the agent (Pillar 6 — offline tolerance).
 */
export async function checkForUpdate(currentVersion: string): Promise<VersionInfo | null> {
  try {
    const res = await fetch(REGISTRY_URL, { timeout: 5000 } as any);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;
    return {
      current: currentVersion,
      latest,
      updateAvailable: isOlder(currentVersion, latest),
    };
  } catch {
    return null; // offline or registry unreachable — silently skip
  }
}

export { PACKAGE_NAME };
