import { LoggerService } from '@backstage/backend-plugin-api';
import { sameUser } from '../../util/identity';
import { TaskStore, TrainingHistory } from '../../database/TaskStore';
import { AgentRegistration, ResourceState } from '../../types';
import { fetchRepoActivity, fetchRepoBrief, Fetch, GithubApiError, RepoActivity, RepoBrief } from './githubSummary';
import { parseGithubRepoUrl } from './parsers';
import { capstoneRepoPrefixes, checkTraineeRepo, deleteTraineeRepo, JsonFetch } from './traineeRepo';
import type { CapstoneStore, EnrollmentSummary } from '../../capstones/CapstoneStore';
import { capstoneById } from '../../capstones/definitions';
import { DEFAULT_POLL_TIMEOUT_MS, heardRecently } from '../agentLiveness';
import { Limiter } from './limiter';
import { Attention, databaseAttention } from './traineeAttention';

/** The capstone enrollment a row is (or matches), with what the page needs to act on it. */
export type CapstoneInfo = Pick<
  EnrollmentSummary,
  'id' | 'capstone' | 'traineeNo' | 'status' | 'handoutPrUrl' | 'handoutAt' | 'awaitingSeedReport' | 'seedReportedAt' | 'completedAt' | 'completedBy' | 'hasReport'
> & {
  availableChecks: { name: string; title: string }[];
  handout: { label: string; instructions: string };
  /** A capstone that is marked done sits in the Archive; it is deleted this many days after it was marked done. */
  archiveRetentionDays: number;
  /** When an archived capstone will be deleted (marked-done date + archiveRetentionDays). */
  archiveExpiresAt?: string;
};

/** What every row of the Trainees view has, in the list and in the detail. */
interface RowBase {
  /**
   * Opaque to the client: `lab:<agentId>::<resourceName>` for a lab (split at the FIRST `::`, resource names are free text) or
   * `cap:<enrollmentId>` for a capstone enrollment that has no lab. The client only ever sends keys back; repo, lab and enrollment are
   * looked up from the portal's own records.
   */
  key: string;
  traineeEmail: string;
  /** The lab's agent (with resourceName, identifies the lab); absent on a capstone-only row. */
  agentId?: string;
  resourceName: string;
  lab?: string;
  taskType: string;
  environment: {
    /** `none`: a capstone enrollment with no Local Provisioner environment (e.g. the Node.js capstone). */
    state: ResourceState | 'none';
    provisionedAt?: string;
    updatedAt: string;
    agentOnline: boolean;
    agentLastSeen?: string;
    /** What the agent is doing right now (a provision or lifecycle task still running). */
    current?: { type: string; status: string; step?: string; since: string };
  };
  repoUrl?: string;
  /** Set when the row is (or matches) a capstone enrollment. */
  capstone?: CapstoneInfo;
}

/** One row of the instructor list: from the database only, about 2 KB, no GitHub data and no check results. */
export interface TraineeListRow extends RowBase {
  /** The row has a github.com repository, so GitHub activity can be asked for. */
  hasGithubRepo: boolean;
  /** The most serious reason to look at this trainee, from database data. */
  attention?: Attention;
}

/** One trainee in full (the panel and the report): timeline, every check result, and, once the page merges it in, the GitHub summary. */
export interface TraineeRow extends RowBase {
  events: { type: string; status: string; at: string }[];
  /** Instructor check results from this lab (run-check), newest first. */
  checks?: { name?: string; status: string; at: string; exitCode?: number; output?: string; error?: string; logs?: string }[];
  catalogEntityRef?: string;
  /** GitHub activity, when the resource has a github.com repo URL (not filled by the detail; the page merges it from `activity`). */
  repo?: RepoActivity;
  /** Why repo activity is missing: no repo, a non-GitHub repo (GitLab track), or a GitHub error. */
  repoNote?: string;
}

export type ActivityLevel = 'brief' | 'full';
export type ActivityCode = 'ok' | 'no_repo' | 'archived' | 'not_found' | 'rate_limited' | 'unavailable';

/** GitHub activity of one row. `brief` is what the list cells show, `full` what the panel and the report need. */
export interface ActivityItem {
  key: string;
  repoUrl?: string;
  fetchedAt: string;
  code: ActivityCode;
  repo?: RepoBrief | RepoActivity;
  /** Why there is no `repo`: for the person reading the page. */
  note?: string;
}

/** What the service remembers about a key between calls: enough to answer `activity` and `detail` without a client-supplied URL. */
interface IndexEntry {
  key: string;
  kind: 'lab' | 'cap';
  traineeEmail: string;
  repoUrl?: string;
  /** The capstone was marked done: no GitHub calls, the kept report has the summary. */
  archived: boolean;
  agentId?: string;
  resourceName?: string;
  capstoneId?: string;
}

const ARCHIVED_NOTE = 'Archived: the kept report has the repository summary';

/** What a failed GitHub read means to the page: slow down, not there, or just not available. */
function activityCodeFor(e: unknown): ActivityCode {
  if (!(e instanceof GithubApiError)) return 'unavailable';
  if (e.rateLimited) return 'rate_limited';
  if (e.status === 404) return 'not_found';
  return 'unavailable';
}

function repoErrorNote(status: number | undefined): string {
  if (status === 404) return 'Repository not found (deleted, or the portal has no access)';
  if (status === 403 || status === 429) return 'GitHub rate limit or access denied: try again later';
  return 'Could not read the repository from GitHub';
}

/** How long a list build is trusted as the index for `activity` and `detail`. */
const INDEX_TTL_MS = 30_000;
/** Repositories read from GitHub at the same time, for the whole process. */
const GITHUB_PARALLEL_REPOS = 6;
/** A refresh never re-reads a repository that was read less than this long ago (mashing Refresh must not hammer GitHub). */
const REFRESH_FLOOR_MS = 30_000;
const MAX_ACTIVITY_KEYS = 50;

/**
 * A lab's identity in the portal: (agent, resource name). A row key adds the `lab:` prefix.
 */
const labKeyOf = (agentId: string, resourceName: string) => `${agentId}::${resourceName}`;
const rowKeyOf = (agentId: string, resourceName: string) => `lab:${labKeyOf(agentId, resourceName)}`;

/** Splits a `lab:` key at the first `::` (agent ids never contain it; resource names are free text). */
export function parseLabKey(key: string): { agentId: string; resourceName: string } | undefined {
  if (!key.startsWith('lab:')) return undefined;
  const rest = key.slice(4);
  const i = rest.indexOf('::');
  if (i <= 0 || i + 2 >= rest.length) return undefined;
  return { agentId: rest.slice(0, i), resourceName: rest.slice(i + 2) };
}

/** How long an archived (marked done) capstone is kept. */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 365;
/** A shorter configured value is raised to this, so a typo cannot wipe the Archive in a night. */
export const MIN_ARCHIVE_RETENTION_DAYS = 30;

/** The configured archive retention: the default when unset or not a positive number, never below the minimum. */
export function archiveRetentionDays(configured?: number): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) return DEFAULT_ARCHIVE_RETENTION_DAYS;
  return Math.max(MIN_ARCHIVE_RETENTION_DAYS, Math.floor(configured));
}

/**
 * Job logs only for the newest result of each check (the one the page shows): an instructor who presses Run again and again on a
 * lab that keeps failing would otherwise put one log per run into every response. Input is newest first.
 */
export function withNewestLogsOnly<T extends { name?: string; logs?: string }>(checks: T[]): T[] {
  const seen = new Set<string>();
  return checks.map(c => {
    const key = c.name ?? '';
    if (seen.has(key)) return { ...c, logs: undefined };
    seen.add(key);
    return c;
  });
}

const CACHE_TTL_MS = 5 * 60_000;
const ERROR_TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  ttl: number;
  failed: boolean;
  value: Promise<RepoBrief | RepoActivity>;
}

/**
 * The instructor Trainees view in three calls. `listTrainees`: every training lab and capstone from the database only, small rows, no
 * GitHub (the page shows it at once). `activity`: GitHub data for the rows the page asks for, a `brief` level for the list cells and a
 * `full` level for the panel and the report. `detail`: one trainee's whole timeline and check results from the database.
 *
 * GitHub reads are cached per repo and level for 5 minutes (failures for 1), concurrent requests for one repo share one fetch, and at
 * most six repositories are read at the same time by the whole process. Single-replica backend, so in-memory state is enough.
 */
export class TraineeActivityService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly limiter = new Limiter(GITHUB_PARALLEL_REPOS);
  private index?: { at: number; entries: Map<string, IndexEntry> };
  private indexBuild?: Promise<Map<string, IndexEntry>>;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly getGithubToken: (url: string) => Promise<string | undefined>,
    private readonly logger: LoggerService,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly capstones?: Pick<CapstoneStore, 'list' | 'get' | 'withdraw'>,
    /** The org trainee repos are created in (organization.githubOwner); repo deletion needs it. */
    private readonly githubOwner?: string,
    /**
     * The portal's liveness rule (AgentService.isConnectedAt). Defaults to the same age rule, but
     * without the "known to have stopped" flag only the live AgentService has.
     */
    private readonly isAgentConnected: (agentId: string, lastSeen: Date) => boolean = (_id, lastSeen) =>
      heardRecently(lastSeen, DEFAULT_POLL_TIMEOUT_MS, now().getTime()),
    /** Days an archived capstone is kept (see archiveRetentionDays()). */
    private readonly archiveDays: number = DEFAULT_ARCHIVE_RETENTION_DAYS,
  ) {}

  /** Every training lab and capstone for the list: database only, most serious first. Also refreshes the key index. */
  async listTrainees(): Promise<TraineeListRow[]> {
    const { rows, entries } = await this.buildList();
    this.index = { at: this.now().getTime(), entries };
    return rows;
  }

  private ensureIndex(): Promise<Map<string, IndexEntry>> {
    if (this.index && this.now().getTime() - this.index.at < INDEX_TTL_MS) return Promise.resolve(this.index.entries);
    // Calls that arrive while it is being built share the one build.
    this.indexBuild ??= this.buildList()
      .then(({ entries }) => {
        this.index = { at: this.now().getTime(), entries };
        return entries;
      })
      .finally(() => {
        this.indexBuild = undefined;
      });
    return this.indexBuild;
  }

  private capstoneInfo(e: EnrollmentSummary): CapstoneInfo {
    const def = capstoneById(e.capstone);
    return {
      id: e.id,
      capstone: e.capstone,
      traineeNo: e.traineeNo,
      status: e.status,
      handoutPrUrl: e.handoutPrUrl,
      handoutAt: e.handoutAt,
      awaitingSeedReport: e.awaitingSeedReport,
      seedReportedAt: e.seedReportedAt,
      completedAt: e.completedAt,
      completedBy: e.completedBy,
      hasReport: e.hasReport,
      archiveRetentionDays: this.archiveDays,
      archiveExpiresAt:
        e.status === 'completed' && e.completedAt ? new Date(Date.parse(e.completedAt) + this.archiveDays * 86_400_000).toISOString() : undefined,
      availableChecks: Object.entries(def?.checks ?? {}).map(([name, c]) => ({ name, title: c.title })),
      handout: {
        label: def?.handout.label ?? 'Day-4 handout',
        instructions:
          def?.handout.instructions ??
          "Opens the sabotaged pull request on the trainee's repository, as the instructor guide describes. Don't tell the trainee it's a test. Running it again reuses the same branch and PR.",
      },
    };
  }

  /** The fields every row shares, from one lab's history. */
  private labBase(h: TrainingHistory, agent: AgentRegistration | undefined): RowBase {
    const { resource, provision, current } = h;
    const lastSeen = agent?.last_seen ? new Date(agent.last_seen) : undefined;
    const repoUrl = (provision.config?.githubRepoUrl || provision.config?.gitlabRepoUrl) as string | undefined;
    return {
      key: rowKeyOf(resource.agent_id, resource.resource_name),
      traineeEmail: resource.user_id,
      agentId: resource.agent_id,
      resourceName: resource.resource_name,
      lab: resource.resource_type,
      taskType: provision.task_type,
      environment: {
        state: resource.state,
        provisionedAt: resource.provisioned_at ? new Date(resource.provisioned_at).toISOString() : undefined,
        updatedAt: new Date(resource.updated_at).toISOString(),
        agentOnline: !!lastSeen && this.isAgentConnected(resource.agent_id, lastSeen),
        agentLastSeen: lastSeen?.toISOString(),
        ...(current ? { current: { ...current, since: new Date(current.since).toISOString() } } : {}),
      },
      repoUrl: typeof repoUrl === 'string' && repoUrl ? repoUrl : undefined,
    };
  }

  /** A capstone enrollment that has no lab on the list. */
  private capstoneOnlyBase(e: EnrollmentSummary): RowBase {
    return {
      key: `cap:${e.id}`,
      traineeEmail: e.traineeEmail,
      resourceName: e.repoUrl ? e.repoUrl.split('/').pop()! : `${(capstoneById(e.capstone)?.title ?? e.capstone).split(':')[0]} #${e.traineeNo}`,
      lab: `${e.capstone}-capstone`,
      taskType: 'capstone',
      environment: { state: 'none', updatedAt: e.createdAt, agentOnline: false },
      repoUrl: e.repoUrl,
      capstone: this.capstoneInfo(e),
    };
  }

  private async buildList(): Promise<{ rows: TraineeListRow[]; entries: Map<string, IndexEntry> }> {
    const removed = await this.taskStore.removedTraineeLabs();
    const histories = (await this.taskStore.getTrainingListData()).filter(h => !removed.has(labKeyOf(h.resource.agent_id, h.resource.resource_name)));
    const agents = await this.taskStore.getAgentsByIds(histories.map(h => h.resource.agent_id));
    const now = this.now();

    // "Lab failed" only counts for a trainee's newest lab of a course: every wizard run makes a new resource name.
    const courseKey = (h: TrainingHistory) => `${h.resource.user_id.toLowerCase()}|${h.resource.resource_type ?? ''}`;
    const newestStart = new Map<string, number>();
    for (const h of histories) {
      const t = new Date(h.provision.created_at).getTime();
      if (t > (newestStart.get(courseKey(h)) ?? -Infinity)) newestStart.set(courseKey(h), t);
    }

    const entries = new Map<string, IndexEntry>();
    const rows: TraineeListRow[] = histories.map(h => {
      const base = this.labBase(h, agents.get(h.resource.agent_id));
      const grades = h.events.filter(e => e.type === 'run-check' && String(e.check?.name ?? '').startsWith('grade'));
      const grade = grades[grades.length - 1];
      const row: TraineeListRow = {
        ...base,
        hasGithubRepo: !!(base.repoUrl && parseGithubRepoUrl(base.repoUrl)),
        attention: databaseAttention({
          state: h.resource.state,
          isNewestLab: new Date(h.provision.created_at).getTime() === newestStart.get(courseKey(h)),
          current: base.environment.current,
          agentOnline: base.environment.agentOnline,
          agentLastSeen: base.environment.agentLastSeen,
          newestGrade: grade ? { status: grade.status, output: grade.check?.output } : undefined,
          now,
        }),
      };
      entries.set(row.key, { key: row.key, kind: 'lab', traineeEmail: row.traineeEmail, repoUrl: row.repoUrl, archived: false, agentId: row.agentId, resourceName: row.resourceName });
      return row;
    });

    // Capstone enrollments: attach to the first lab with the same repo and trainee, or add their own row.
    const strip = (u?: string) => u?.replace(/\.git$/, '');
    for (const e of (await this.capstones?.list()) ?? []) {
      const match = e.repoUrl ? rows.find(r => strip(r.repoUrl) === strip(e.repoUrl) && sameUser(r.traineeEmail, e.traineeEmail)) : undefined;
      if (match) {
        match.capstone = this.capstoneInfo(e);
        const entry = entries.get(match.key)!;
        entry.capstoneId = e.id;
        entry.archived = e.status === 'completed';
        continue;
      }
      const base = this.capstoneOnlyBase(e);
      rows.push({ ...base, hasGithubRepo: !!(base.repoUrl && parseGithubRepoUrl(base.repoUrl)) });
      entries.set(base.key, { key: base.key, kind: 'cap', traineeEmail: e.traineeEmail, repoUrl: e.repoUrl, archived: e.status === 'completed', capstoneId: e.id });
    }

    // Most serious first, then the most recent change, then the key (so the order is the same on every call).
    const byKey = (a: TraineeListRow, b: TraineeListRow): number => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    };
    rows.sort((a, b) => (b.attention?.severity ?? 0) - (a.attention?.severity ?? 0) || Date.parse(b.environment.updatedAt) - Date.parse(a.environment.updatedAt) || byKey(a, b));
    return { rows, entries };
  }

  /**
   * One trainee in full, from the database only (the page asks `activity` for GitHub separately, so a GitHub problem can never slow the
   * panel down or end up in a report). Undefined for an unknown key, a lab that is not a training lab, or one removed from the view.
   */
  async detail(key: string): Promise<TraineeRow | undefined> {
    if (key.startsWith('cap:')) {
      const e = await this.capstones?.get(key.slice(4));
      if (!e || e.status === 'withdrawn') return undefined;
      // The enrollment may have got a lab since the page was loaded: show the lab's row, as the list does.
      const entries = await this.ensureIndex();
      const lab = [...entries.values()].find(x => x.kind === 'lab' && x.capstoneId === e.id);
      if (lab) return this.detail(lab.key);
      return { ...this.capstoneOnlyBase(e), events: [{ type: 'capstone-enrolled', status: e.status, at: e.createdAt }] };
    }
    const parsed = parseLabKey(key);
    if (!parsed) return undefined;
    if ((await this.taskStore.removedTraineeLabs()).has(labKeyOf(parsed.agentId, parsed.resourceName))) return undefined;
    const history = await this.taskStore.getTrainingResourceHistory(parsed.agentId, parsed.resourceName);
    if (!history) return undefined;
    const agent = (await this.taskStore.getAgentById(parsed.agentId)) ?? undefined;
    const base = this.labBase(history, agent);
    const entry = (await this.ensureIndex()).get(base.key);
    const enrollment = entry?.capstoneId ? await this.capstones?.get(entry.capstoneId) : undefined;
    return {
      ...base,
      ...(enrollment && enrollment.status !== 'withdrawn' ? { capstone: this.capstoneInfo(enrollment) } : {}),
      events: history.events.filter(e => e.type !== 'run-check').map(e => ({ type: e.type, status: e.status, at: new Date(e.at).toISOString() })),
      checks: withNewestLogsOnly(
        history.events
          .filter(e => e.type === 'run-check')
          .map(e => ({
            name: e.check?.name,
            status: e.status,
            at: new Date(e.at).toISOString(),
            exitCode: e.check?.exitCode,
            output: e.check?.output,
            error: e.check?.error,
            logs: e.check?.logs,
          }))
          .reverse(),
      ),
      catalogEntityRef: history.resource.catalog_entity_ref,
    };
  }

  /**
   * GitHub activity for rows of the list, by key (never by URL: the repository comes from the portal's own records). At most 50 keys;
   * keys the portal does not know are left out. Every item says in `code` what happened, so the page can tell "no repository" from
   * "GitHub is limiting us" and slow down.
   */
  async activity(keys: string[], level: ActivityLevel, refresh: boolean): Promise<ActivityItem[]> {
    const entries = await this.ensureIndex();
    const items = await Promise.all(
      [...new Set(keys.slice(0, MAX_ACTIVITY_KEYS))].map(async (key): Promise<ActivityItem | undefined> => {
        const entry = entries.get(key); // a Map: a key such as "__proto__" or "constructor" is just an unknown key
        if (!entry) return undefined;
        const fetchedAt = this.now().toISOString();
        if (entry.archived) return { key, repoUrl: entry.repoUrl, fetchedAt, code: 'archived', note: ARCHIVED_NOTE };
        if (!entry.repoUrl) return { key, fetchedAt, code: 'no_repo', note: 'No repository recorded for this environment' };
        const gh = parseGithubRepoUrl(entry.repoUrl);
        if (!gh) return { key, repoUrl: entry.repoUrl, fetchedAt, code: 'no_repo', note: 'Not a GitHub repository (GitLab track): no activity data' };
        try {
          const read = this.repoActivity(gh.owner, gh.repo, level, refresh);
          const repo = await read.value;
          return { key, repoUrl: entry.repoUrl, fetchedAt: new Date(read.at).toISOString(), code: 'ok', repo };
        } catch (e) {
          const status = e instanceof GithubApiError ? e.status : undefined;
          this.logger.warn(`Trainee activity: ${gh.owner}/${gh.repo} failed`, { status, error: String(e) });
          return { key, repoUrl: entry.repoUrl, fetchedAt, code: activityCodeFor(e), note: repoErrorNote(status) };
        }
      }),
    );
    return items.filter((x): x is ActivityItem => !!x);
  }

  /**
   * Instructor "Remove trainee": take a lab and/or capstone enrollment off the Trainees view and,
   * when asked, delete the trainee's GitHub repo. Everything is looked up from stored records —
   * the request only names the row. The repo goes first and only after checkTraineeRepo proves it
   * is this trainee's own lab repo; if that or the delete fails, nothing is removed. The lab on the
   * trainee's laptop is not touched (their Local Provisioner page still lists it).
   */
  async removeTrainee(
    input: { agentId?: string; resourceName?: string; enrollmentId?: string; deleteRepo: boolean },
    removedBy: string,
  ): Promise<{ status: number; error?: string; repoDeleted?: string }> {
    const { agentId, resourceName, enrollmentId } = input;
    if (!agentId !== !resourceName) return { status: 400, error: 'agentId and resourceName go together' };
    if (!agentId && !enrollmentId) return { status: 400, error: 'Nothing to remove' };

    const lab = agentId ? await this.taskStore.getTrainingResourceHistory(agentId, resourceName!) : undefined;
    if (agentId && (!lab || (await this.taskStore.removedTraineeLabs()).has(labKeyOf(agentId, resourceName!)))) {
      return { status: 404, error: 'Lab not found' };
    }
    const enrollment = enrollmentId ? await this.capstones?.get(enrollmentId) : undefined;
    if (enrollmentId && (!enrollment || enrollment.status === 'withdrawn')) return { status: 404, error: 'Enrollment not found' };

    const norm = (u?: string) => u?.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
    const labRepo = (lab?.provision.config?.githubRepoUrl || lab?.provision.config?.gitlabRepoUrl) as string | undefined;
    if (lab && enrollment) {
      if (lab.resource.user_id !== enrollment.traineeEmail || (labRepo && enrollment.repoUrl && norm(labRepo) !== norm(enrollment.repoUrl))) {
        return { status: 400, error: 'That lab and enrollment belong to different trainees' };
      }
    }
    const traineeEmail = lab?.resource.user_id ?? enrollment!.traineeEmail;
    const repoUrl = (typeof labRepo === 'string' && labRepo) || enrollment?.repoUrl || undefined;

    let repoDeleted: string | undefined;
    if (input.deleteRepo && repoUrl) {
      const recordTimes = [lab?.provision.created_at, enrollment?.createdAt].filter(Boolean).map(t => new Date(t!).getTime());
      const token = await this.getGithubToken(repoUrl).catch(() => undefined);
      if (!token) return { status: 502, error: 'No GitHub integration token for that repository. Nothing was removed.' };
      const check = await checkTraineeRepo(
        {
          repoUrl,
          names: resourceName ? [resourceName, `training-${resourceName}`] : [],
          prefixes: enrollment ? capstoneRepoPrefixes(enrollment.capstone) : undefined,
          recordCreatedAt: new Date(Math.min(...recordTimes)),
          allowedOwner: this.githubOwner,
          traineeEmail,
        },
        token,
        this.fetchImpl as unknown as JsonFetch,
      );
      if (!check.ok) {
        this.logger.warn(`Remove trainee: refused to delete ${repoUrl} (${check.reason})`, { removedBy, audit: true });
        return { status: 409, error: `The repository was not deleted: ${check.reason}. Nothing was removed.` };
      }
      if (!check.gone) {
        try {
          await deleteTraineeRepo(check, token, this.fetchImpl as unknown as JsonFetch);
        } catch (e: any) {
          return { status: 502, error: `Could not delete ${check.owner}/${check.repo}: ${e.message}. Nothing was removed.` };
        }
      }
      repoDeleted = `${check.owner}/${check.repo}`;
      this.cache.delete(repoDeleted.toLowerCase());
    }

    if (enrollment) await this.capstones!.withdraw(enrollment.id);
    await this.taskStore.recordTraineeRemoval({
      agentId,
      resourceName,
      enrollmentId: enrollment?.id,
      traineeEmail,
      repoUrl,
      repoDeleted: Boolean(repoDeleted),
      removedBy,
    });
    this.index = undefined; // the removed row must not be answered from the index
    this.logger.info(
      `Trainee removed by ${removedBy}: ${traineeEmail} (${resourceName ?? `${enrollment!.capstone} #${enrollment!.traineeNo}`})` +
        `${enrollment ? `, enrollment ${enrollment.id} withdrawn` : ''}${repoDeleted ? `, repo ${repoDeleted} deleted` : ''}`,
      { audit: true },
    );
    return { status: 200, repoDeleted };
  }

  /**
   * The nightly retention of the Archive: every capstone marked done more than `retentionDays` ago is removed the way an instructor
   * removes it by hand (the enrollment is withdrawn and its kept report discarded, the lab leaves the Trainees view). The trainee's
   * GitHub repository and the lab on their laptop are never touched. A failure on one capstone is logged and the rest go on.
   */
  async purgeArchive(retentionDays: number): Promise<number> {
    if (!this.capstones) return 0;
    const cutoff = this.now().getTime() - retentionDays * 86_400_000;
    const expired = (await this.capstones.list()).filter(e => e.status === 'completed' && e.completedAt && Date.parse(e.completedAt) < cutoff);
    if (!expired.length) return 0;
    const removed = await this.taskStore.removedTraineeLabs();
    const histories = await this.taskStore.getTrainingListData();
    const strip = (u?: string) => u?.replace(/\.git$/, '');
    let purged = 0;
    for (const e of expired) {
      const lab = e.repoUrl
        ? histories.find(
            h =>
              !removed.has(`${h.resource.agent_id}::${h.resource.resource_name}`) &&
              sameUser(h.resource.user_id, e.traineeEmail) &&
              strip((h.provision.config?.githubRepoUrl || h.provision.config?.gitlabRepoUrl) as string | undefined) === strip(e.repoUrl),
          )
        : undefined;
      try {
        const r = await this.removeTrainee(
          { agentId: lab?.resource.agent_id, resourceName: lab?.resource.resource_name, enrollmentId: e.id, deleteRepo: false },
          'the archive retention',
        );
        if (r.status === 200) purged++;
        else this.logger.warn(`Archive retention: ${e.traineeEmail} (${e.capstone} #${e.traineeNo}) was not removed: ${r.error}`);
      } catch (err: any) {
        this.logger.warn(`Archive retention: ${e.traineeEmail} (${e.capstone} #${e.traineeNo}) failed: ${err?.message ?? err}`);
      }
    }
    if (purged) this.logger.info(`Archive retention: removed ${purged} capstone(s) marked done more than ${retentionDays} days ago`, { audit: true });
    return purged;
  }

  private repoActivity(owner: string, repo: string, level: ActivityLevel, refresh: boolean): CacheEntry {
    const key = `${level}:${owner}/${repo}`.toLowerCase();
    const hit = this.cache.get(key);
    const nowMs = this.now().getTime();
    if (hit) {
      const age = nowMs - hit.at;
      if (!refresh && age < hit.ttl) return hit;
      // A refresh serves a read from the last 30 s (and one that is still running); a failed read is always retried.
      if (refresh && !hit.failed && age < REFRESH_FLOOR_MS) return hit;
    }
    const entry: CacheEntry = { at: nowMs, ttl: CACHE_TTL_MS, failed: false, value: Promise.resolve(undefined as any) };
    entry.value = this.limiter.run(async () => {
      const token = await this.getGithubToken(`https://github.com/${owner}/${repo}`);
      return level === 'full'
        ? fetchRepoActivity(owner, repo, token, this.fetchImpl, this.now())
        : fetchRepoBrief(owner, repo, token, this.fetchImpl, this.now());
    });
    entry.value.catch(() => {
      entry.ttl = ERROR_TTL_MS; // retry failures sooner
      entry.failed = true;
    });
    this.cache.set(key, entry);
    return entry;
  }
}
