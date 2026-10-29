/**
 * Build metadata injected by the Backstage CLI bundler at build time
 * (@backstage/cli-module-build: DefinePlugin `process.env.BUILD_INFO`).
 * The value is substituted as an object literal, so it must be referenced as the exact
 * expression `process.env.BUILD_INFO` and never JSON.parse'd. Undefined under jest.
 */
export type BuildInfo = {
  /** `git describe --always`, e.g. `v1.5.3-4-ge82421a`, a bare sha, or `unknown` */
  gitVersion: string;
  /** `git rev-parse HEAD`, or `unknown` */
  commit: string;
  /** Build time, ms since epoch */
  timestamp: number;
};

export function readBuildInfo(): BuildInfo | null {
  const raw = process.env.BUILD_INFO as unknown as Partial<BuildInfo> | undefined;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return {
    gitVersion: raw.gitVersion ?? 'unknown',
    commit: raw.commit ?? 'unknown',
    timestamp: Number(raw.timestamp),
  };
}

/**
 * Formats the build timestamp in the viewer's locale and time zone, e.g.
 * `Oct 29, 2026, 5:08 PM GMT+8`. Uses explicit fields: `dateStyle`/`timeStyle` cannot be
 * combined with `timeZoneName` — Intl throws `TypeError: Invalid option` at runtime.
 */
export function formatBuildDate(timestamp: number, locale?: string, timeZone?: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}

/**
 * Splits `git describe` output into the nearest tag and how many commits the build is past it.
 * `v1.5.3` -> { tag: 'v1.5.3', commitsAhead: 0 }; `v1.5.3-4-ge82421a` -> { tag: 'v1.5.3',
 * commitsAhead: 4 }; a bare sha or `unknown` (no reachable tag) -> { tag: null, commitsAhead: 0 }.
 */
export function parseGitVersion(gitVersion: string | undefined): {
  tag: string | null;
  commitsAhead: number;
} {
  const match = /^(v?\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+?)?)(?:-(\d+)-g[0-9a-f]+)?$/.exec(
    (gitVersion ?? '').trim(),
  );
  if (!match) {
    return { tag: null, commitsAhead: 0 };
  }
  return { tag: match[1], commitsAhead: match[2] ? Number(match[2]) : 0 };
}
