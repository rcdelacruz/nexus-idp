import type { TraineeActivityItem, TraineeAttention, TraineeListRow } from '../../api/types';
import { isArchived } from '../../api/archive';

/** The Active / Archive switch and the open trainee panel live in the address, so a trainee can be linked to. Search, order and page are the table's own. */
export type Tab = 'active' | 'archive';

/** No commit for this long and a lab that exists is "idle". */
export const IDLE_AFTER_MS = 3 * 24 * 3_600_000;

export interface ViewState {
  tab: Tab;
  /** The row key of the open trainee panel. */
  open?: string;
}

export const DEFAULT_VIEW: ViewState = { tab: 'active' };

/** Reads the view from the address. Anything unknown or malformed falls back to the default instead of breaking the page. */
export function parseView(params: URLSearchParams): ViewState {
  const open = (params.get('open') ?? '').slice(0, 400);
  return { tab: params.get('tab') === 'archive' ? 'archive' : 'active', open: open || undefined };
}

/** Writes the view to the address; the default is left out, so the plain page has a plain address. */
export function viewToParams(view: ViewState): URLSearchParams {
  const p = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) p.set('tab', view.tab);
  if (view.open) p.set('open', view.open);
  return p;
}

// ---- courses -------------------------------------------------------------------------------------------------------------------

export const courseOf = (row: TraineeListRow): string => row.capstone?.capstone ?? row.lab ?? '';

/** `terraform-capstone-a` -> "Terraform capstone A"; `nodejs-b` -> "Nodejs B". Display only. */
export function prettyCourse(id: string): string {
  if (!id) return '—';
  const words = id.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---- GitHub data ----------------------------------------------------------------------------------------------------------------

/** Whether asking GitHub about this row can return anything (an archived capstone's summary is in its kept report). */
export const canHaveActivity = (row: TraineeListRow): boolean => row.hasGithubRepo && !isArchived(row);

export type Lookup = (row: TraineeListRow) => TraineeActivityItem | undefined;

export const okRepo = (item?: TraineeActivityItem) => (item?.code === 'ok' ? item.repo : undefined);

const FAILING_CI = ['failure', 'timed_out', 'startup_failure', 'cancelled', 'action_required'];

export function isCiFailing(item?: TraineeActivityItem): boolean {
  const ci = okRepo(item)?.ci;
  return !!ci && ci.status === 'completed' && FAILING_CI.includes(ci.conclusion ?? '');
}

/** Days without a commit, for a lab that exists; undefined when the data is not loaded or the lab is not running work. */
export function idleDays(row: TraineeListRow, item: TraineeActivityItem | undefined, now: number): number | undefined {
  const repo = okRepo(item);
  if (!repo || row.environment.state === 'none') return undefined;
  const since = repo.lastCommit?.date ?? row.environment.provisionedAt;
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t) || now - t < IDLE_AFTER_MS) return undefined;
  return Math.floor((now - t) / 86_400_000);
}

/** The reasons that need GitHub data (the server cannot know them). */
export function activityAttention(row: TraineeListRow, item: TraineeActivityItem | undefined, now: number): TraineeAttention | undefined {
  if (isCiFailing(item)) return { severity: 2, code: 'ci_failing', text: 'CI failing' };
  const idle = idleDays(row, item, now);
  if (idle !== undefined) return { severity: 1, code: 'idle', text: `No commits for ${idle} d` };
  return undefined;
}

/** The more serious of the two; the database's reason wins a tie. */
export function combineAttention(fromDatabase?: TraineeAttention, fromGithub?: TraineeAttention): TraineeAttention | undefined {
  if (!fromGithub) return fromDatabase;
  if (!fromDatabase) return fromGithub;
  return fromGithub.severity > fromDatabase.severity ? fromGithub : fromDatabase;
}

export const attentionOf = (row: TraineeListRow, item: TraineeActivityItem | undefined, now: number) => combineAttention(row.attention, activityAttention(row, item, now));

// ---- search and ordering --------------------------------------------------------------------------------------------------------

export function matchesSearch(row: TraineeListRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${row.traineeEmail} ${row.resourceName} ${row.lab ?? ''} ${courseOf(row)} ${prettyCourse(courseOf(row))}`.toLowerCase().includes(needle);
}

/** Plain character order, the same as the server's, so the two never disagree about a tie. */
const byKey = (a: TraineeListRow, b: TraineeListRow): number => {
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
};

/** The server's order: most serious database reason first, then the most recent change, then the key. */
export const compareAttention = (a: TraineeListRow, b: TraineeListRow) =>
  (b.attention?.severity ?? 0) - (a.attention?.severity ?? 0) || Date.parse(b.environment.updatedAt) - Date.parse(a.environment.updatedAt) || byKey(a, b);

export const compareName = (a: TraineeListRow, b: TraineeListRow) => a.traineeEmail.localeCompare(b.traineeEmail) || byKey(a, b);

const LAB_ORDER: Record<string, number> = { error: 0, provisioning: 1, running: 2, stopped: 3, none: 4, removed: 5 };
/** Failed labs first, then setting up, running, stopped, and no environment last. */
export const compareLab = (a: TraineeListRow, b: TraineeListRow) =>
  (LAB_ORDER[a.environment.state] ?? 9) - (LAB_ORDER[b.environment.state] ?? 9) || compareAttention(a, b);

/**
 * A comparator for the table's own header sort (the table calls it with the two rows, swapped, and "desc" as the fourth argument for
 * the descending order). Rows with no value go last in either direction, and a tie falls back to the attention order in both.
 */
export function compareBy(get: (row: TraineeListRow) => number | undefined) {
  return (a: TraineeListRow, b: TraineeListRow, _type?: string, direction?: string): number => {
    const x = get(a);
    const y = get(b);
    const desc = direction === 'desc';
    // The table hands the rows over swapped for "desc": put them back, so a tie is in the attention order in both directions.
    const tie = () => (desc ? compareAttention(b, a) : compareAttention(a, b));
    if (x === undefined && y === undefined) return tie();
    if (x === undefined) return desc ? -1 : 1;
    if (y === undefined) return desc ? 1 : -1;
    return x - y || tie();
  };
}

/** The numbers the GitHub columns are ordered by. All of them are undefined until that row's data has loaded. */
export const progressRatio = (item?: TraineeActivityItem): number | undefined => {
  const p = okRepo(item)?.progress;
  return p && p.total > 0 ? p.done / p.total : undefined;
};
export const lastCommitAt = (item?: TraineeActivityItem): number | undefined => {
  const d = okRepo(item)?.lastCommit?.date;
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
export const commitsLast14Days = (item?: TraineeActivityItem): number | undefined => {
  const days = okRepo(item)?.commitsPerDay;
  return days ? days.reduce((sum, d) => sum + d.count, 0) : undefined;
};
/** CI: failing first, then running, then passing; a repository with no run yet has no value. */
export const ciRank = (item?: TraineeActivityItem): number | undefined => {
  const ci = okRepo(item)?.ci;
  if (!ci) return undefined;
  if (ci.status !== 'completed') return 1;
  return isCiFailing(item) ? 0 : 2;
};

/**
 * What a row carries for the GitHub columns' order. They are fields of the row, so the table re-orders when loaded data changes them
 * (it ignores new rows that are the same as the old ones): the order is applied once, from what has been loaded.
 */
export interface SortValues {
  progressValue?: number;
  lastCommitValue?: number;
  commits14Value?: number;
  ciValue?: number;
}

export function sortValuesOf(item?: TraineeActivityItem): SortValues {
  return { progressValue: progressRatio(item), lastCommitValue: lastCommitAt(item), commits14Value: commitsLast14Days(item), ciValue: ciRank(item) };
}
