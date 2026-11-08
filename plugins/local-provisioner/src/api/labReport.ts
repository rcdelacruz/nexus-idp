import { TraineeRow } from './types';
import { checkSummary } from './checkSummary';
import { formatDuration } from './activity';

/**
 * The per-lab report an instructor saves or sends: built from a Trainees-view row (data the instructor can already read), so it needs
 * no server call. At "Mark complete" the report is built once and the server keeps that snapshot; before that, any row can be turned
 * into a report on demand.
 */

export interface GradeItem {
  id: string;
  area?: string;
  title: string;
  points: number;
  got: number;
  detail?: string;
}

export interface GradeResult {
  phase?: string;
  autoTotal: number;
  maxPoints: number;
  items: GradeItem[];
  hardFails: string[];
  /** Items an instructor still grades by hand. */
  manual: string[];
  notes: string[];
}

export interface ReportCheck {
  name: string;
  status: string;
  at: string;
  summary: string;
  grade?: GradeResult;
}

export interface LabReport {
  /** Bumped when the shape changes, so an old stored snapshot can still be read. */
  version: 1;
  generatedAt: string;
  trainee: string;
  course: string;
  lab: string;
  capstone?: { id: string; traineeNo: string; status: string; handoutPrUrl?: string };
  environment: { state: string; startedAt?: string; lastChangeAt: string; timeInLab?: string };
  /** A few plain sentences an instructor can read first. */
  summary: string[];
  repo?: {
    url: string;
    commits: number;
    commitsLast14Days: number;
    lastCommit?: { sha: string; message: string; author: string; date: string };
    stageFiles: string[];
    aiLogFiles: number;
    corrections: number;
    decisions: number;
    progress?: { done: number; total: number };
    pullRequests: { open: number; merged: number };
    ci?: { status: string; conclusion: string | null; url: string };
  };
  repoNote?: string;
  checks: ReportCheck[];
  history: { at: string; type: string; status: string }[];
}

const text = (v: unknown, max = 500): string => {
  if (typeof v === 'string') return v.slice(0, max);
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
};
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** One entry of the grader's `manual` / `notes`: a string, or an object with a title/id and maybe points. */
function listEntry(e: unknown): string {
  if (typeof e === 'string') return text(e);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const label = text(o.title ?? o.id ?? o.name ?? o.text ?? '');
    const pts = typeof o.points === 'number' ? ` (${o.points} points)` : '';
    return `${label}${pts}`.trim();
  }
  return text(e);
}

/** The capstone grader's result (the last JSON line of a check's output), or undefined when the output is not one. */
export function parseGrade(output?: string): GradeResult | undefined {
  const line = (output ?? '').split('\n').map(l => l.trim()).reverse().find(l => l.startsWith('{'));
  if (!line) return undefined;
  let r: any;
  try {
    r = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!r || !Array.isArray(r.items) || typeof r.auto_total !== 'number') return undefined;
  const items: GradeItem[] = r.items
    .filter((i: unknown) => i && typeof i === 'object')
    .slice(0, 300)
    .map((i: any) => ({
      id: text(i.id, 80),
      area: i.area ? text(i.area, 80) : undefined,
      title: text(i.title ?? i.id, 300),
      points: num(i.points),
      got: num(i.got),
      detail: i.detail ? text(i.detail, 500) : undefined,
    }));
  return {
    phase: r.phase ? text(r.phase, 40) : undefined,
    autoTotal: r.auto_total,
    maxPoints: items.reduce((sum, i) => sum + i.points, 0),
    items,
    hardFails: (Array.isArray(r.hard_fails) ? r.hard_fails : []).slice(0, 50).map((h: unknown) => text(h)),
    manual: (Array.isArray(r.manual) ? r.manual : []).slice(0, 100).map(listEntry).filter(Boolean),
    notes: (Array.isArray(r.notes) ? r.notes : []).slice(0, 100).map(listEntry).filter(Boolean),
  };
}

const STATE_WORDS: Record<string, string> = {
  running: 'running',
  stopped: 'stopped',
  removed: 'removed',
  error: 'failed',
  provisioning: 'being set up',
  none: 'no environment (repository only)',
};

export function buildLabReport(row: TraineeRow, now: Date = new Date()): LabReport {
  const startedAt = row.environment.provisionedAt;
  const removal = [...row.events].reverse().find(e => e.type === 'deprovision' && e.status === 'completed');
  const endMs = removal ? Date.parse(removal.at) : now.getTime();
  const timeInLab = startedAt && Number.isFinite(Date.parse(startedAt)) && endMs >= Date.parse(startedAt) ? formatDuration(endMs - Date.parse(startedAt)) : undefined;

  const checks: ReportCheck[] = (row.checks ?? []).map(c => ({
    name: text(c.name || 'check', 80),
    status: c.status,
    at: c.at,
    summary: checkSummary(c),
    grade: parseGrade(c.output),
  }));
  const latestGrade = checks.find(c => c.grade && c.status === 'completed')?.grade;

  const repo = row.repo;
  const summary: string[] = [];
  summary.push(`${row.traineeEmail} — ${row.lab ?? row.taskType}${row.capstone ? ` (trainee #${row.capstone.traineeNo})` : ''}.`);
  summary.push(`Environment: ${STATE_WORDS[row.environment.state] ?? row.environment.state}${timeInLab ? `, ${timeInLab} from set-up${removal ? ' to removal' : ' so far'}` : ''}.`);
  if (repo) {
    summary.push(
      `Work: ${repo.commitCount} commit${repo.commitCount === 1 ? '' : 's'}` +
        `${repo.progress ? `, ${repo.progress.done} of ${repo.progress.total} tasks done` : ''}` +
        `, ${repo.pullRequests.merged} pull request${repo.pullRequests.merged === 1 ? '' : 's'} merged.`,
    );
  } else if (row.repoNote) {
    summary.push(`Work: ${row.repoNote}.`);
  }
  if (latestGrade) {
    summary.push(
      `Latest grade: ${latestGrade.autoTotal} of ${latestGrade.maxPoints} automated points` +
        `${latestGrade.phase ? ` (${latestGrade.phase})` : ''}, ` +
        `${latestGrade.hardFails.length ? `${latestGrade.hardFails.length} hard fail${latestGrade.hardFails.length === 1 ? '' : 's'}` : 'no hard fails'}` +
        `${latestGrade.manual.length ? `; ${latestGrade.manual.length} item${latestGrade.manual.length === 1 ? '' : 's'} left to grade by hand` : ''}.`,
    );
  } else if (checks.length) {
    summary.push(`Checks: ${checks.length} result${checks.length === 1 ? '' : 's'}, latest: ${checks[0].summary}.`);
  } else {
    summary.push('No checks or grades have been run yet.');
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    trainee: row.traineeEmail,
    course: text(row.capstone?.capstone ?? row.lab ?? row.taskType, 80),
    lab: row.resourceName,
    capstone: row.capstone
      ? { id: row.capstone.id, traineeNo: row.capstone.traineeNo, status: row.capstone.status, handoutPrUrl: row.capstone.handoutPrUrl }
      : undefined,
    environment: { state: row.environment.state, startedAt, lastChangeAt: row.environment.updatedAt, timeInLab },
    summary,
    repo: repo
      ? {
          url: repo.htmlUrl,
          commits: repo.commitCount,
          commitsLast14Days: repo.commitsPerDay.reduce((sum, d) => sum + d.count, 0),
          lastCommit: repo.lastCommit && {
            sha: repo.lastCommit.sha.slice(0, 7),
            message: text(repo.lastCommit.message, 200),
            author: text(repo.lastCommit.author, 80),
            date: repo.lastCommit.date,
          },
          stageFiles: repo.stageFilesWorked,
          aiLogFiles: repo.aiLogFiles,
          corrections: repo.corrections,
          decisions: repo.decisions,
          progress: repo.progress,
          pullRequests: repo.pullRequests,
          ci: repo.ci && { status: repo.ci.status, conclusion: repo.ci.conclusion, url: repo.ci.htmlUrl },
        }
      : undefined,
    repoNote: repo ? undefined : row.repoNote,
    checks,
    history: row.events.map(e => ({ at: e.at, type: e.type, status: e.status })),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lab';

/** `lab-report-<lab>-<yyyy-mm-dd>` (no extension). Only a-z, 0-9 and hyphens, so it is safe as a file name anywhere. */
export function reportFileName(report: Pick<LabReport, 'lab' | 'generatedAt'>): string {
  return `lab-report-${slug(report.lab)}-${report.generatedAt.slice(0, 10)}`;
}

export function reportJson(report: LabReport): string {
  return JSON.stringify(report, null, 2);
}
