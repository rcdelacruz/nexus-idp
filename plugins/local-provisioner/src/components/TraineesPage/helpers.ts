import { parseEntityRef } from '@backstage/catalog-model';

/** owner/repo of a github.com URL (display only — the server re-checks everything). */
export const githubRepoName = (url?: string) => /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1];

export const LIVE_LAB_STATES = ['provisioning', 'running', 'stopped'];

/** "3h ago" style relative time. */
export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const sec = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (sec < 60) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m ago`;
  const h = min / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  return d < 30 ? `${Math.floor(d)}d ago` : new Date(iso).toLocaleDateString();
}

export const catalogHref = (ref?: string) => {
  if (!ref) return undefined;
  try {
    const { kind, namespace, name } = parseEntityRef(ref);
    return `/catalog/${namespace ?? 'default'}/${kind.toLowerCase()}/${name}`;
  } catch {
    return undefined;
  }
};
