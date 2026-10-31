import { randomBytes } from 'crypto';
import { Request, Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CapstoneStore } from './CapstoneStore';
import { capstoneById } from './definitions';
import { seedCapstone } from './seeder';
import { createRunnerRegistrationToken, openHandoutPr } from './handout';
import { commitPendingHandover, sha256Hex } from './seedReportRoute';
import { parseGithubRepoUrl } from '../service/traineeActivity/parsers';

export interface CapstoneRouteDeps {
  store: CapstoneStore;
  logger: LoggerService;
  getGithubToken: (url: string) => Promise<string | undefined>;
  /** External base URL of this plugin (what a trainee laptop calls), for the seed-report URL. */
  externalBaseUrl: () => Promise<string>;
  /** Overridable for tests. */
  seed?: typeof seedCapstone;
  handout?: typeof openHandoutPr;
  runnerToken?: typeof createRunnerRegistrationToken;
  commitHandover?: typeof commitPendingHandover;
  /** Lab access for instructor checks (wired to TaskStore/TaskQueueService/AgentService in router.ts). */
  labs?: LabOps;
}

/** First agent release with run-check (and auto-clone). */
export const MIN_CHECK_AGENT = '0.1.23';

/** True when a reported agent version is at least MIN_CHECK_AGENT (plain x.y.z; anything else → false). */
export function supportsChecks(version: string | undefined): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const have = version ? parse(version) : undefined;
  const need = parse(MIN_CHECK_AGENT)!;
  if (!have) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

export interface LabOps {
  /** The trainee's lab: latest provision task whose forwarded repo URL matches the enrollment's. */
  findLabTask(repoUrl: string): Promise<{ task_id: string; agent_id: string; user_id: string; resource_name: string } | undefined>;
  resourceState(agentId: string, resourceName: string): Promise<string | undefined>;
  isAgentOnline(agentId: string): Promise<boolean>;
  /** The agent's reported version (agents before 0.1.23 don't know run-check and must never get one). */
  agentVersion(agentId: string): Promise<string | undefined>;
  queueCheck(task: { userId: string; agentId: string; resourceName: string; config: Record<string, unknown> }): Promise<{ task_id: string }>;
  /** A check already waiting for (or running on) this lab — the scheduler doesn't pile up behind it. */
  hasPendingCheck(agentId: string, resourceName: string): Promise<boolean>;
  /** Read a file from the private capstone repo (server-side, integration token) → base64. */
  fetchSourceFile?(sourceRepo: string, branch: string, filePath: string): Promise<string>;
}

/**
 * Queue one capstone check against a trainee's lab, with every guard; shared by the instructor
 * button and the scheduler. Returns an HTTP-ish status so the route can pass it through.
 */
export async function queueEnrollmentCheck(
  store: CapstoneStore,
  labs: LabOps,
  enrollmentId: string,
  checkName: string,
  opts: { skipIfPending?: boolean } = {},
): Promise<{ status: number; taskId?: string; error?: string }> {
  const enrollment = await store.get(enrollmentId);
  if (!enrollment) return { status: 404, error: 'Enrollment not found' };
  const def = capstoneById(enrollment.capstone);
  const check = def?.checks && Object.prototype.hasOwnProperty.call(def.checks, checkName) ? def.checks[checkName] : undefined;
  if (!check) return { status: 404, error: `No check "${checkName}" for this capstone` };
  const secrets = await store.getSecrets(enrollment.id);
  if (!secrets) return { status: 409, error: 'The lab has not reported its seed yet' };
  if (!enrollment.repoUrl) return { status: 409, error: 'The enrollment has no repository yet' };
  const lab = await labs.findLabTask(enrollment.repoUrl);
  if (!lab) return { status: 409, error: 'No lab found for this trainee' };
  const state = await labs.resourceState(lab.agent_id, lab.resource_name);
  if (state !== 'running') return { status: 409, error: `The lab is ${state ?? 'unknown'}, not running` };
  if (!(await labs.isAgentOnline(lab.agent_id))) return { status: 409, error: "The trainee's agent is offline" };
  // An older agent would treat an unknown task type as a provision (and could start its bundled
  // default template), so checks only ever go to agents that support them.
  const version = await labs.agentVersion(lab.agent_id);
  if (!supportsChecks(version)) {
    return { status: 409, error: `The trainee's agent (${version ?? 'unknown version'}) is too old for lab checks — they need backstage-agent ${MIN_CHECK_AGENT}+ (\`backstage-agent update\`)` };
  }
  if (opts.skipIfPending && (await labs.hasPendingCheck(lab.agent_id, lab.resource_name))) {
    return { status: 409, error: 'A check is already pending on this lab' };
  }
  let config: Record<string, unknown>;
  if ('job' in check) {
    if (!labs.fetchSourceFile) return { status: 501, error: 'Capstone source access is not configured' };
    const sourceFiles: Record<string, string> = {};
    for (const f of check.needsSourceFiles) sourceFiles[f] = await labs.fetchSourceFile(def!.sourceRepo, def!.branch, f);
    config = {
      targetTaskId: lab.task_id,
      checkName,
      job: check.job({ manifest: secrets.seedManifest, credentials: secrets.credentials, traineeNo: enrollment.traineeNo, repoUrl: enrollment.repoUrl, sourceFiles }),
    };
  } else {
    config = { targetTaskId: lab.task_id, checkName, service: check.service, argv: check.argv(secrets.seedManifest, enrollment.traineeNo) };
  }
  const task = await labs.queueCheck({ userId: lab.user_id, agentId: lab.agent_id, resourceName: lab.resource_name, config });
  return { status: 202, taskId: task.task_id };
}

/** How long a laptop seed may take to report after enrollment (the lab may be provisioned later). */
const SEED_TOKEN_TTL_MS = 48 * 60 * 60_000;

const userEmail = (req: Request): string | undefined => (req as any).user?.email;

/** Lab states that mean the trainee still has a working lab (error/removed/never provisioned don't). */
const LIVE_LAB_STATES = new Set(['provisioning', 'running', 'stopped']);

async function hasLiveLab(labs: LabOps | undefined, repoUrl: string | undefined): Promise<boolean> {
  if (!labs || !repoUrl) return false;
  const lab = await labs.findLabTask(repoUrl);
  if (!lab) return false;
  return LIVE_LAB_STATES.has((await labs.resourceState(lab.agent_id, lab.resource_name)) ?? '');
}

/**
 * Mounted at /capstones. RBAC is enforced before these handlers by the router middleware
 * (service/router.ts permissionForRequest):
 *   POST /enrollments, PUT /enrollments/:id/repo → local-provisioner.capstones.enroll (any signed-in
 *     user enrolls themselves; the handlers scope everything to the caller's email)
 *   everything else                              → local-provisioner.capstones.manage (admins + instructors)
 */
export function createCapstoneRoutes(deps: CapstoneRouteDeps): Router {
  const { store, logger, getGithubToken } = deps;
  const seed = deps.seed ?? seedCapstone;
  const handout = deps.handout ?? openHandoutPr;
  const runnerToken = deps.runnerToken ?? createRunnerRegistrationToken;
  const commitHandover = deps.commitHandover ?? commitPendingHandover;
  const router = Router();

  /** Enroll the caller: reserve a trainee number and seed their copy server-side. Returns only the trainee files. */
  router.post('/enrollments', async (req, res) => {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ error: 'Could not resolve authenticated user' });
    const def = capstoneById(req.body?.capstone);
    if (!def) return res.status(400).json({ error: `Unknown capstone: ${String(req.body?.capstone)}` });
    // One enrollment per trainee per capstone. An earlier one with a working lab blocks a second;
    // one without (a failed scaffolder run, a removed lab) is replaced, so the trainee keeps their number.
    const previous = await store.listForTrainee(def.id, email);
    for (const p of previous) {
      if (await hasLiveLab(deps.labs, p.repoUrl)) {
        return res.status(409).json({
          error: `You are already enrolled in this capstone (trainee #${p.traineeNo}) and your lab is still there. Keep using it, or remove the lab from your Local Provisioner page first to start over.`,
        });
      }
    }
    for (const p of previous) {
      await store.withdraw(p.id);
      logger.info(`Capstone enrollment ${p.id} (${def.id} #${p.traineeNo}) for ${email} replaced by a new enrollment (no working lab)`);
    }
    try {
      const token = await getGithubToken(`https://github.com/${def.sourceRepo}`);
      // Laptop seeds report back later with a single-use token; only its hash is stored.
      const seedToken = def.seedMode === 'laptop' ? randomBytes(32).toString('base64url') : undefined;
      const { enrollment, seeded } = await store.enroll(def.id, email, async traineeNo => {
        const r = await seed(def, traineeNo, token);
        return {
          ...r,
          seedManifest: r.manifest,
          seedTokenHash: seedToken ? sha256Hex(seedToken) : undefined,
          seedTokenExpiresAt: seedToken ? new Date(Date.now() + SEED_TOKEN_TTL_MS) : undefined,
        };
      }, { preferTraineeNo: previous[0]?.traineeNo });
      logger.info(`Capstone enrollment: ${email} → ${def.id} #${enrollment.traineeNo}`, { enrollmentId: enrollment.id });
      const laptopSeed = seedToken
        ? {
            token: seedToken,
            reportUrl: `${await deps.externalBaseUrl()}/capstones/seed-report/${enrollment.id}`,
            files: seeded.laptopSeedFiles ?? {},
          }
        : undefined;
      return res.status(201).json({ enrollment, files: seeded.files, ...(laptopSeed ? { laptopSeed } : {}) });
    } catch (e: any) {
      logger.error(`Capstone enrollment failed for ${email} (${def.id})`, e);
      return res.status(500).json({ error: 'Could not seed the capstone', message: e.message });
    }
  });

  /** Record the caller's trainee repo (once, while seeded). github.com only. */
  router.put('/enrollments/:id/repo', async (req, res) => {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ error: 'Could not resolve authenticated user' });
    const repoUrl = req.body?.repoUrl;
    if (!parseGithubRepoUrl(repoUrl)) return res.status(400).json({ error: 'repoUrl must be https://github.com/<owner>/<repo>' });
    const linked = await store.linkRepo(req.params.id, email, repoUrl);
    if (!linked) return res.status(404).json({ error: 'No seeded enrollment of yours with that id' });
    const linkedDef = capstoneById(linked.capstone);
    if (linkedDef?.seedMode !== 'laptop') return res.status(200).json({ enrollment: linked });
    if (!linkedDef.selfHostedRunner) {
      // Laptop-seeded without CI on the laptop (Linux): only the handover, if already reported.
      await commitHandover(store, linked.id, getGithubToken).catch(e => logger.warn(`Could not commit HANDOVER.md for ${linked.id}: ${e.message}`));
      return res.status(200).json({ enrollment: linked });
    }

    // Laptop capstones (Terraform): a self-hosted runner token so the trainee's CI can reach their
    // local MiniStack, and the handover note if the laptop already reported.
    const target = parseGithubRepoUrl(repoUrl)!;
    try {
      const gh = await getGithubToken(repoUrl);
      if (!gh) throw new Error('No GitHub integration token configured');
      const runner = await runnerToken(target, gh);
      await commitHandover(store, linked.id, getGithubToken).catch(e =>
        logger.warn(`Could not commit HANDOVER.md for ${linked.id}: ${e.message}`),
      );
      return res.status(200).json({ enrollment: linked, runner });
    } catch (e: any) {
      logger.error(`Runner registration token failed for ${linked.id}`, e);
      return res.status(502).json({ error: 'Repository recorded, but the CI runner token could not be created', message: e.message });
    }
  });

  router.get('/enrollments', async (_req, res) => {
    return res.status(200).json({ enrollments: await store.list() });
  });

  /** Instructor-only: seeded credentials, the handover answer key, the manifest (for grading) and the grade command. Audit-logged. */
  router.get('/enrollments/:id/secrets', async (req, res) => {
    const enrollment = await store.get(req.params.id);
    const secrets = enrollment && (await store.getSecrets(req.params.id));
    if (!enrollment || !secrets) return res.status(404).json({ error: 'Enrollment not found' });
    logger.info(`Capstone secrets revealed by ${userEmail(req)} for ${enrollment.traineeEmail} (${enrollment.capstone} #${enrollment.traineeNo})`, {
      enrollmentId: enrollment.id,
      audit: true,
    });
    return res.status(200).json({ ...secrets, gradeCommand: capstoneById(enrollment.capstone)?.gradeCommand });
  });

  /** Instructor-only: remove an enrollment from the list (frees the trainee number). Audit-logged. */
  router.delete('/enrollments/:id', async (req, res) => {
    const removed = await store.withdraw(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Enrollment not found' });
    logger.info(`Capstone enrollment removed by ${userEmail(req)}: ${removed.traineeEmail} (${removed.capstone} #${removed.traineeNo})`, {
      enrollmentId: removed.id,
      audit: true,
    });
    return res.status(200).json({ enrollment: removed });
  });

  /** Instructor-only: open the Day-4 sabotaged PR on the trainee repo. Idempotent. */
  router.post('/enrollments/:id/handout', async (req, res) => {
    const enrollment = await store.get(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    const def = capstoneById(enrollment.capstone);
    const target = parseGithubRepoUrl(enrollment.repoUrl);
    if (!def || !target) return res.status(409).json({ error: 'The enrollment has no GitHub repository yet' });
    try {
      const token = await getGithubToken(`https://github.com/${target.owner}/${target.repo}`);
      if (!token) return res.status(500).json({ error: 'No GitHub integration token configured' });
      const { prUrl, created } = await handout(def, target, token);
      await store.recordHandout(enrollment.id, prUrl);
      logger.info(`Capstone handout ${created ? 'opened' : 'already open'} by ${userEmail(req)}: ${prUrl}`, { enrollmentId: enrollment.id });
      return res.status(200).json({ prUrl, created });
    } catch (e: any) {
      logger.error(`Capstone handout failed for ${enrollment.id}`, e);
      return res.status(502).json({ error: 'Could not open the handout PR', message: e.message });
    }
  });

  /**
   * Instructor-only: run one of the capstone's predefined checks inside the trainee's lab via their
   * agent (run-check task). The command comes from the capstone definition + the instructor-only
   * manifest, never from the request. The result appears on the trainee's row when the agent reports.
   */
  router.post('/enrollments/:id/checks/:check', async (req, res) => {
    if (!deps.labs) return res.status(501).json({ error: 'Lab checks are not configured' });
    const r = await queueEnrollmentCheck(store, deps.labs, req.params.id, req.params.check);
    if (r.status !== 202) return res.status(r.status).json({ error: r.error });
    logger.info(`Capstone check "${req.params.check}" queued by ${userEmail(req)} for enrollment ${req.params.id}`, { taskId: r.taskId });
    return res.status(202).json({ taskId: r.taskId });
  });

  return router;
}
