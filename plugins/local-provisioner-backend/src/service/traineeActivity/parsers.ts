/**
 * Pure parsers for the trainee repo files the instructor view summarises. Formats come from the
 * capstone trainee templates (strat-training/*-training-capstone/trainee-template) and the
 * training labs' PROGRESS.md (engineering-standards templates/training/*).
 */

/** `CORRECTIONS.md`: numbered entries ("1. proposed X → wrong because Y → did Z"); an empty "1." is the template placeholder. */
export function countCorrections(markdown: string): number {
  return markdown.split('\n').filter(line => /^\s*\d+\.\s+\S/.test(line)).length;
}

/** `DECISIONS.md`: one `## D-NN: <title>` heading per ADR; the template's literal `<title>` placeholder doesn't count. */
export function countDecisions(markdown: string): number {
  return markdown
    .split('\n')
    .filter(line => /^##\s+D-\d+\s*:\s*\S/.test(line) && !/:\s*<title>\s*$/.test(line)).length;
}

/** `PROGRESS.md`: markdown task-list checkboxes. */
export function countProgress(markdown: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of markdown.split('\n')) {
    const m = /^\s*[-*]\s+\[([ xX])\]/.exec(line);
    if (m) {
      total++;
      if (m[1].toLowerCase() === 'x') done++;
    }
  }
  return { done, total };
}

/** Stage files the capstones and labs ask trainees to fill in, matched by basename without extension. */
export const STAGE_FILES = [
  'TRIAGE',
  'INVENTORY',
  'DECISIONS',
  'CORRECTIONS',
  'REPAIR',
  'RUNBOOK',
  'AUDIT',
  'DRILL',
  'write-up',
  'PROGRESS',
] as const;

export interface TreeEntry {
  path: string;
  type: string; // 'blob' | 'tree' | 'commit'
  sha: string;
}

/**
 * Which stage files changed since the repo was created, and how many AI transcripts exist.
 * `initial` is the tree of the repo's first commit (what the template generated); a stage file
 * counts as worked on when it is new or its blob sha differs.
 */
export function diffWorkTree(initial: TreeEntry[], head: TreeEntry[]): { stageFilesWorked: string[]; aiLogFiles: number } {
  const before = new Map(initial.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
  const stageFilesWorked: string[] = [];
  let aiLogFiles = 0;
  for (const e of head) {
    if (e.type !== 'blob') continue;
    if (/^ai-log\//.test(e.path) && !/(^|\/)\.gitkeep$/.test(e.path)) aiLogFiles++;
    if (e.path.includes('/')) continue; // stage files live at the repo root
    const base = e.path.replace(/\.md$/i, '');
    if ((STAGE_FILES as readonly string[]).includes(base) && before.get(e.path) !== e.sha) {
      stageFilesWorked.push(base);
    }
  }
  return { stageFilesWorked: stageFilesWorked.sort(), aiLogFiles };
}

/** `https://github.com/<owner>/<repo>[.git]` → owner/repo; anything else (GitLab, malformed) → undefined. */
export function parseGithubRepoUrl(url: unknown): { owner: string; repo: string } | undefined {
  if (typeof url !== 'string') return undefined;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : undefined;
}

/** Commits per day for the last `days` days (UTC dates, oldest first), from commit ISO timestamps. */
export function commitsPerDay(dates: string[], now: Date, days = 14): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = new Date(d).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}
