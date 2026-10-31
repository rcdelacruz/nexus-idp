import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskStore } from '../../database/TaskStore';
import { ResourceState } from '../../types';
import { fetchRepoActivity, Fetch, GithubApiError, RepoActivity } from './githubSummary';
import { parseGithubRepoUrl } from './parsers';
import { checkTraineeRepo, deleteTraineeRepo, JsonFetch } from './traineeRepo';
import type { CapstoneStore, EnrollmentSummary } from '../../capstones/CapstoneStore';
import { capstoneById } from '../../capstones/definitions';

/** One row of the instructor Trainees view: a trainee's lab/capstone environment plus their repo work. */
export interface TraineeRow {
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
  events: { type: string; status: string; at: string }[];
  /** Instructor check results from this lab (run-check), newest first. */
  checks?: { name?: string; status: string; at: string; exitCode?: number; output?: string }[];
  catalogEntityRef?: string;
  repoUrl?: string;
  /** GitHub activity, when the resource has a github.com repo URL. */
  repo?: RepoActivity;
  /** Why repo activity is missing: no repo, a non-GitHub repo (GitLab track), or a GitHub error. */
  repoNote?: string;
  /** Set when the row is (or matches) a brownfield capstone enrollment. */
  capstone?: Pick<
    EnrollmentSummary,
    'id' | 'capstone' | 'traineeNo' | 'status' | 'handoutPrUrl' | 'handoutAt' | 'awaitingSeedReport' | 'seedReportedAt'
  > & { availableChecks: { name: string; title: string }[] };
}

const CACHE_TTL_MS = 5 * 60_000;
const ERROR_TTL_MS = 60_000;
const CONCURRENCY = 4;
const AGENT_ONLINE_SEC = 90; // same liveness rule as AgentService.getAgentStatus

function repoErrorNote(status: number | undefined): string {
  if (status === 404) return 'Repository not found (deleted, or the portal has no access)';
  if (status === 403 || status === 429) return 'GitHub rate limit or access denied: try again later';
  return 'Could not read the repository from GitHub';
}

interface CacheEntry {
  at: number;
  ttl: number;
  value: Promise<RepoActivity>;
}

/**
 * Builds the instructor Trainees view: every training resource (TaskStore) joined with the
 * trainee's GitHub repo activity. Repo data is cached per repo for 5 minutes (errors for 1),
 * concurrent requests for the same repo share one fetch, and at most 4 repos are fetched at once.
 * Single-replica backend, so an in-memory cache is enough.
 */
export class TraineeActivityService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly taskStore: TaskStore,
    private readonly getGithubToken: (url: string) => Promise<string | undefined>,
    private readonly logger: LoggerService,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly capstones?: Pick<CapstoneStore, 'list' | 'get' | 'withdraw'>,
    /** The org trainee repos are created in (organization.githubOwner); repo deletion needs it. */
    private readonly githubOwner?: string,
  ) {}

  async listTrainees(options: { refresh?: boolean } = {}): Promise<TraineeRow[]> {
    const removed = await this.taskStore.removedTraineeLabs();
    const histories = (await this.taskStore.getTrainingResourceHistories()).filter(
      h => !removed.has(`${h.resource.agent_id}::${h.resource.resource_name}`),
    );
    const agentIds = [...new Set(histories.map(h => h.resource.agent_id))];
    const agents = new Map(
      await Promise.all(agentIds.map(async id => [id, await this.taskStore.getAgentById(id)] as const)),
    );

    const rows: TraineeRow[] = histories.map(({ resource, provision, events, current }) => {
      const agent = agents.get(resource.agent_id);
      const lastSeen = agent?.last_seen ? new Date(agent.last_seen) : undefined;
      const repoUrl = (provision.config?.githubRepoUrl || provision.config?.gitlabRepoUrl) as string | undefined;
      return {
        traineeEmail: resource.user_id,
        agentId: resource.agent_id,
        resourceName: resource.resource_name,
        lab: resource.resource_type,
        taskType: provision.task_type,
        environment: {
          state: resource.state,
          provisionedAt: resource.provisioned_at ? new Date(resource.provisioned_at).toISOString() : undefined,
          updatedAt: new Date(resource.updated_at).toISOString(),
          agentOnline: !!lastSeen && (this.now().getTime() - lastSeen.getTime()) / 1000 <= AGENT_ONLINE_SEC,
          agentLastSeen: lastSeen?.toISOString(),
          ...(current ? { current: { ...current, since: new Date(current.since).toISOString() } } : {}),
        },
        events: events.filter(e => e.type !== 'run-check').map(e => ({ type: e.type, status: e.status, at: new Date(e.at).toISOString() })),
        checks: events
          .filter(e => e.type === 'run-check')
          .map(e => ({ name: e.check?.name, status: e.status, at: new Date(e.at).toISOString(), exitCode: e.check?.exitCode, output: e.check?.output }))
          .reverse(),
        catalogEntityRef: resource.catalog_entity_ref,
        repoUrl: typeof repoUrl === 'string' && repoUrl ? repoUrl : undefined,
      };
    });

    // Capstone enrollments: attach to the environment row with the same repo, or add their own row.
    for (const e of (await this.capstones?.list()) ?? []) {
      const capstone = {
        id: e.id,
        capstone: e.capstone,
        traineeNo: e.traineeNo,
        status: e.status,
        handoutPrUrl: e.handoutPrUrl,
        handoutAt: e.handoutAt,
        awaitingSeedReport: e.awaitingSeedReport,
        seedReportedAt: e.seedReportedAt,
        availableChecks: Object.entries(capstoneById(e.capstone)?.checks ?? {}).map(([name, c]) => ({ name, title: c.title })),
      };
      const match = e.repoUrl ? rows.find(r => r.repoUrl?.replace(/\.git$/, '') === e.repoUrl!.replace(/\.git$/, '')) : undefined;
      if (match) {
        match.capstone = capstone;
        continue;
      }
      rows.push({
        traineeEmail: e.traineeEmail,
        resourceName: e.repoUrl ? e.repoUrl.split('/').pop()! : `${e.capstone} capstone #${e.traineeNo}`,
        lab: `${e.capstone}-capstone`,
        taskType: 'capstone',
        environment: { state: 'none', updatedAt: e.createdAt, agentOnline: false },
        events: [{ type: 'capstone-enrolled', status: e.status, at: e.createdAt }],
        repoUrl: e.repoUrl,
        capstone,
      });
    }

    // Fetch repo activity with bounded concurrency.
    const queue = rows.filter(r => {
      if (!r.repoUrl) {
        r.repoNote = 'No repository recorded for this environment';
        return false;
      }
      if (!parseGithubRepoUrl(r.repoUrl)) {
        r.repoNote = 'Not a GitHub repository (GitLab track): no activity data';
        return false;
      }
      return true;
    });
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const row = queue[next++];
        const { owner, repo } = parseGithubRepoUrl(row.repoUrl)!;
        try {
          row.repo = await this.repoActivity(owner, repo, options.refresh ?? false);
        } catch (e) {
          const status = e instanceof GithubApiError ? e.status : undefined;
          row.repoNote = repoErrorNote(status);
          this.logger.warn(`Trainee activity: ${owner}/${repo} failed`, { status, error: String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    // Most recently active first: last commit, else last environment change.
    const activityAt = (r: TraineeRow) => Date.parse(r.repo?.lastCommit?.date ?? r.environment.updatedAt);
    return rows.sort((a, b) => activityAt(b) - activityAt(a));
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

    const lab = agentId
      ? (await this.taskStore.getTrainingResourceHistories()).find(
          h => h.resource.agent_id === agentId && h.resource.resource_name === resourceName,
        )
      : undefined;
    if (agentId && (!lab || (await this.taskStore.removedTraineeLabs()).has(`${agentId}::${resourceName}`))) {
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
          prefix: enrollment ? `${enrollment.capstone}-capstone` : undefined,
          recordCreatedAt: new Date(Math.min(...recordTimes)),
          allowedOwner: this.githubOwner,
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
    this.logger.info(
      `Trainee removed by ${removedBy}: ${traineeEmail} (${resourceName ?? `${enrollment!.capstone} #${enrollment!.traineeNo}`})` +
        `${enrollment ? `, enrollment ${enrollment.id} withdrawn` : ''}${repoDeleted ? `, repo ${repoDeleted} deleted` : ''}`,
      { audit: true },
    );
    return { status: 200, repoDeleted };
  }

  private repoActivity(owner: string, repo: string, refresh: boolean): Promise<RepoActivity> {
    const key = `${owner}/${repo}`.toLowerCase();
    const hit = this.cache.get(key);
    const nowMs = this.now().getTime();
    if (hit && !refresh && nowMs - hit.at < hit.ttl) return hit.value;

    const entry: CacheEntry = { at: nowMs, ttl: CACHE_TTL_MS, value: Promise.resolve(undefined as any) };
    entry.value = (async () => {
      const token = await this.getGithubToken(`https://github.com/${owner}/${repo}`);
      return fetchRepoActivity(owner, repo, token, this.fetchImpl, this.now());
    })();
    entry.value.catch(() => {
      entry.ttl = ERROR_TTL_MS; // retry failures sooner
    });
    this.cache.set(key, entry);
    return entry.value;
  }
}
