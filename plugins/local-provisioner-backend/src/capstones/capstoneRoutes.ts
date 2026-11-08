import { randomBytes } from 'crypto';
import { Request, Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CapstoneStore } from './CapstoneStore';
import { capstoneById } from './definitions';
import { seedCapstone } from './seeder';
import { createRunnerRegistrationToken, openHandoutPr } from './handout';
import { commitPendingHandover, sha256Hex } from './seedReportRoute';
import { parseGithubRepoUrl } from '../service/traineeActivity/parsers';
import { capstoneRepoPrefixes, checkTraineeRepo, JsonFetch } from '../service/traineeActivity/traineeRepo';

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
  /** The organization trainee repos are created in (organization.githubOwner). Unset: no repo can be linked. */
  allowedOwner?: string;
  /** Overridable for tests: the proof that a repo is the trainee's own lab repo, and the GitHub fetch it uses. */
  checkRepo?: typeof checkTraineeRepo;
  repoFetch?: JsonFetch;
}

/** First agent release with run-check (and auto-clone). */
export const MIN_CHECK_AGENT = '0.1.23';

/** First agent release that clones the trainee's repo before a lab starts and mounts it (Node.js capstone). */
export const MIN_WORKSPACE_MOUNT_AGENT = '0.1.29';

/** True when a reported agent version is at least MIN_CHECK_AGENT (plain x.y.z; anything else → false). */
export function supportsChecks(version: string | undefined, min: string = MIN_CHECK_AGENT): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const have = version ? parse(version) : undefined;
  const need = parse(min)!;
  if (!have) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

export interface LabOps {
  /** The trainee's lab: latest provision task whose forwarded repo URL matches the enrollment's. */
  /** The newest provision task of `traineeEmail` whose forwarded repo URL is `repoUrl`. The owner is part of the question: any signed-in user can create a task carrying any repo URL. */
  findLabTask(repoUrl: string, traineeEmail: string): Promise<{ task_id: string; agent_id: string; user_id: string; resource_name: string } | undefined>;
  resourceState(agentId: string, resourceName: string): Promise<string | undefined>;
  isAgentOnline(agentId: string): Promise<boolean>;
  /** The agent's reported version (agents before 0.1.23 don't know run-check and must never get one). */
  agentVersion(agentId: string): Promise<string | undefined>;
  queueCheck(task: { userId: string; agentId: string; resourceName: string; config: Record<string, unknown> }): Promise<{ task_id: string }>;
  /** Read a file from the private capstone repo (server-side, integration token) → base64. */
  fetchSourceFile?(sourceRepo: string, branch: string, filePath: string): Promise<string>;
}

/**
 * Queue one capstone check against a trainee's lab, with every guard (the instructor's Run button).
 * Returns an HTTP-ish status so the route can pass it through.
 */
export async function queueEnrollmentCheck(
  store: CapstoneStore,
  labs: LabOps,
  enrollmentId: string,
  checkName: string,
): Promise<{ status: number; taskId?: string; error?: string }> {
  const enrollment = await store.get(enrollmentId);
  if (!enrollment) return { status: 404, error: 'Enrollment not found' };
  const def = capstoneById(enrollment.capstone);
  const check = def?.checks && Object.prototype.hasOwnProperty.call(def.checks, checkName) ? def.checks[checkName] : undefined;
  if (!check) return { status: 404, error: `No check "${checkName}" for this capstone` };
  const secrets = await store.getSecrets(enrollment.id);
  if (!secrets) return { status: 409, error: 'The lab has not reported its seed yet' };
  if (!enrollment.repoUrl) return { status: 409, error: 'The enrollment has no repository yet' };
  // Only a lab the enrolled trainee owns: a task of someone else that merely names this repo URL must never receive the instructor's check
  // (it carries the trainee's manifest and, for a grade, the grader and the answer key).
  const lab = await labs.findLabTask(enrollment.repoUrl, enrollment.traineeEmail);
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

async function hasLiveLab(labs: LabOps | undefined, repoUrl: string | undefined, traineeEmail: string): Promise<boolean> {
  if (!labs || !repoUrl) return false;
  const lab = await labs.findLabTask(repoUrl, traineeEmail);
  if (!lab) return false;
  return LIVE_LAB_STATES.has((await labs.resourceState(lab.agent_id, lab.resource_name)) ?? '');
}

/**
 * What a completion report must look like to be kept: the lab report the portal's own page builds (api/labReport.ts, version 1).
 * It is the instructor's own data, shown later as text only, so this checks the shape and that it is about the enrolled trainee,
 * not every field.
 */
export function reportProblem(report: unknown, traineeEmail: string): string | undefined {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 'report must be the lab report object';
  const r = report as Record<string, unknown>;
  if (r.version !== 1) return 'report has an unknown version';
  if (typeof r.trainee !== 'string' || r.trainee.toLowerCase() !== traineeEmail.toLowerCase()) return 'the report is about a different trainee';
  if (typeof r.lab !== 'string' || typeof r.course !== 'string') return 'report is missing the lab or the course';
  if (!Array.isArray(r.summary) || !Array.isArray(r.checks) || !Array.isArray(r.history)) return 'report is missing its summary, checks or history';
  return undefined;
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
  const checkRepo = deps.checkRepo ?? checkTraineeRepo;
  const router = Router({ caseSensitive: true }); // see service/router.ts: the capstones.manage mapping is keyed on the exact path

  /**
   * The repo URL on an enrollment is what the portal's GitHub token later acts on: a runner registration token,
   * a HANDOVER.md commit, the instructor's handout PR. A trainee supplies it, so it is proven before it is used:
   * in the trainee organization, named after this capstone, private, not a fork, created together with this
   * enrollment (every company repo is older), and not already some other enrollment's repo.
   */
  async function proveRepo(
    enrollment: { id: string; capstone: string; createdAt: string; traineeEmail: string },
    repoUrl: string,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string; reason: string }> {
    const token = await getGithubToken(repoUrl);
    if (!token) return { ok: false, status: 502, error: 'The portal could not check the repository (no GitHub integration token)', reason: 'no token' };
    const r = await checkRepo(
      {
        repoUrl,
        prefixes: capstoneRepoPrefixes(enrollment.capstone),
        recordCreatedAt: new Date(enrollment.createdAt),
        allowedOwner: deps.allowedOwner,
        // The scaffolder names the repo after the signed-in user: someone else's fresh repo cannot be linked to this enrollment.
        traineeEmail: enrollment.traineeEmail,
      },
      token,
      deps.repoFetch,
    );
    if (!r.ok) {
      // A GitHub outage is not "not your repository": the scaffolder run fails and can be retried.
      const upstream = /^GitHub returned/.test(r.reason);
      return {
        ok: false,
        status: upstream ? 502 : 400,
        error: upstream ? 'GitHub could not be reached to check the repository' : 'That repository is not the lab repository of this capstone enrollment',
        reason: r.reason,
      };
    }
    if (r.gone) return { ok: false, status: 400, error: 'That repository is not the lab repository of this capstone enrollment', reason: 'repository not found' };
    if (await store.repoLinkedElsewhere(repoUrl, enrollment.id)) {
      return { ok: false, status: 409, error: 'That repository already belongs to another capstone enrollment', reason: 'already linked' };
    }
    return { ok: true };
  }

  /** Enroll the caller: reserve a trainee number and seed their copy server-side. Returns only the trainee files. */
  router.post('/enrollments', async (req, res) => {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ error: 'Could not resolve authenticated user' });
    const def = capstoneById(req.body?.capstone);
    if (!def) return res.status(400).json({ error: `Unknown capstone: ${String(req.body?.capstone)}` });
    // One enrollment per trainee per capstone. An earlier one with a working lab blocks a second;
    // one without (a failed scaffolder run, a removed lab) is replaced, so the trainee keeps their number.
    // A capstone an instructor marked done is a finished record: re-running the template starts a NEW enrollment beside it.
    const previous = (await store.listForTrainee(def.id, email)).filter(p => p.status !== 'completed');
    for (const p of previous) {
      if (await hasLiveLab(deps.labs, p.repoUrl, email)) {
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
    const current = await store.get(req.params.id);
    if (!current || current.traineeEmail !== email || current.status !== 'seeded') {
      return res.status(404).json({ error: 'No seeded enrollment of yours with that id' });
    }
    const proof = await proveRepo(current, repoUrl);
    if (!proof.ok) {
      logger.warn(`Capstone repo link refused for ${email} (enrollment ${current.id}, ${repoUrl}): ${proof.reason}`);
      return res.status(proof.status).json({ error: proof.error });
    }
    const linked = await store.linkRepo(req.params.id, email, repoUrl);
    if (!linked) return res.status(404).json({ error: 'No seeded enrollment of yours with that id' });
    const linkedDef = capstoneById(linked.capstone);
    // Nothing more to do unless the lab needs the trainee repo's CI runner (selfHostedRunner, whatever
    // the seed mode: Terraform Capstone A has nothing to seed but its pipeline still runs on the laptop)
    // or a laptop seed is waiting to commit its handover note.
    if (!linkedDef || (!linkedDef.selfHostedRunner && linkedDef.seedMode !== 'laptop')) return res.status(200).json({ enrollment: linked });
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
      if (linkedDef.seedMode === 'laptop') {
        await commitHandover(store, linked.id, getGithubToken).catch(e =>
          logger.warn(`Could not commit HANDOVER.md for ${linked.id}: ${e.message}`),
        );
      }
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

  /**
   * Instructor-only: mark an active capstone done. The instructor's browser builds the lab report from the Trainees row and sends it;
   * the server stamps who and when and keeps that snapshot, so the report outlives the lab, its task rows and the clean-up.
   */
  router.post('/enrollments/:id/complete', async (req, res) => {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ error: 'Could not resolve authenticated user' });
    const enrollment = await store.get(req.params.id);
    if (!enrollment || enrollment.status === 'withdrawn') return res.status(404).json({ error: 'Enrollment not found' });
    if (enrollment.status === 'completed') return res.status(409).json({ error: 'This capstone is already marked done' });
    if (enrollment.status !== 'active') return res.status(409).json({ error: 'Only a capstone whose repository is linked can be marked done' });
    const problem = reportProblem(req.body?.report, enrollment.traineeEmail);
    if (problem) return res.status(400).json({ error: problem });
    let done;
    try {
      done = await store.complete(enrollment.id, email, req.body.report);
    } catch (e: any) {
      return res.status(413).json({ error: e.message });
    }
    if (!done) return res.status(409).json({ error: 'This capstone changed while you were marking it done: reload and try again' });
    logger.info(`Capstone marked done by ${email}: ${enrollment.traineeEmail} (${enrollment.capstone} #${enrollment.traineeNo})`, {
      enrollmentId: enrollment.id,
      audit: true,
    });
    return res.status(200).json({ enrollment: done });
  });

  /** Instructor-only: the report kept when the capstone was marked done. */
  router.get('/enrollments/:id/report', async (req, res) => {
    const kept = await store.getReport(req.params.id);
    if (!kept) return res.status(404).json({ error: 'No report: this capstone is not marked done' });
    return res.status(200).json(kept);
  });

  /** Instructor-only: undo a completion that was a mistake (the kept report is discarded). */
  router.post('/enrollments/:id/reopen', async (req, res) => {
    const reopened = await store.reopen(req.params.id);
    if (!reopened) return res.status(409).json({ error: 'This capstone is not marked done' });
    logger.info(`Capstone reopened by ${userEmail(req)}: ${reopened.traineeEmail} (${reopened.capstone} #${reopened.traineeNo})`, {
      enrollmentId: reopened.id,
      audit: true,
    });
    return res.status(200).json({ enrollment: reopened });
  });

  /** Instructor-only: open the Day-4 sabotaged PR on the trainee repo. Idempotent. */
  router.post('/enrollments/:id/handout', async (req, res) => {
    const enrollment = await store.get(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    const def = capstoneById(enrollment.capstone);
    const target = parseGithubRepoUrl(enrollment.repoUrl);
    if (!def || !target) return res.status(409).json({ error: 'The enrollment has no GitHub repository yet' });
    // Enrollments linked before the repo was proven are checked here too, before the portal opens a PR on the URL.
    const proof = await proveRepo(enrollment, enrollment.repoUrl!);
    if (!proof.ok) {
      logger.warn(`Capstone handout refused for enrollment ${enrollment.id} (${enrollment.repoUrl}): ${proof.reason}`);
      return res.status(proof.status).json({ error: proof.error });
    }
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
