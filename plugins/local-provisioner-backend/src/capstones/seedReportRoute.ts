import { createHash } from 'crypto';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CapstoneStore } from './CapstoneStore';
import { commitRepoFile } from './handout';
import { parseGithubRepoUrl } from '../service/traineeActivity/parsers';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

const MAX = { credentials: 64 * 1024, answerKey: 256 * 1024, handover: 256 * 1024, manifest: 1024 * 1024 };

/** Validates the laptop's report body; returns an error string or the clean report. */
export function validateSeedReport(body: any):
  | { error: string }
  | { report: { seedManifest: unknown; credentials: string; answerKey: string; handover: string } } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const allowed = new Set(['manifest', 'credentials', 'answerKey', 'handover']);
  if (Object.keys(body).some(k => !allowed.has(k))) return { error: 'unexpected fields' };
  const { manifest, credentials, answerKey, handover } = body;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { error: 'manifest must be an object' };
  if (JSON.stringify(manifest).length > MAX.manifest) return { error: 'manifest too large' };
  for (const [k, v] of Object.entries({ credentials, answerKey, handover })) {
    if (typeof v !== 'string' || v.length === 0) return { error: `${k} must be a non-empty string` };
    if (v.length > MAX[k as keyof typeof MAX]) return { error: `${k} too large` };
  }
  return { report: { seedManifest: manifest, credentials, answerKey, handover } };
}

/**
 * POST /capstones/seed-report/:id: the ONE unauthenticated capstone route (public via
 * util/publicPaths). A laptop-seeded capstone's one-shot seed container sends the seed outputs
 * here with its single-use token as `Authorization: Bearer`.
 *
 * - Mounted BEFORE the router's 10 MB JSON parser, with its own 1.5 MB limit, and the token is
 *   checked before the body is parsed.
 * - Rate-limited per enrollment id (behind the Cloudflare tunnel the client IP is the tunnel's).
 * - Unknown id, wrong, used or expired token → the same 401; the store update is atomic and clears
 *   the token, so a replay or a concurrent second report changes nothing.
 * - The data is trainee-controlled (their laptop) and shown to instructors as "unverified".
 *   HANDOVER.md is committed at a fixed path; report content never chooses a path.
 */
export function createSeedReportRoute(deps: {
  store: CapstoneStore;
  logger: LoggerService;
  getGithubToken: (url: string) => Promise<string | undefined>;
  commitFile?: typeof commitRepoFile;
}): Router {
  const { store, logger, getGithubToken } = deps;
  const commitFile = deps.commitFile ?? commitRepoFile;
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => `seed-report:${req.params.id}`,
    message: { error: 'too_many_requests' },
  });

  router.post('/:id', limiter, (req, res, next) => {
    const auth = req.headers.authorization ?? '';
    const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(auth)?.[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    (req as any).seedTokenHash = sha256Hex(token);
    return next();
  }, express.json({ limit: '1536kb' }), async (req, res) => {
    const v = validateSeedReport(req.body);
    if ('error' in v) return res.status(400).json({ error: v.error });
    const accepted = await store.acceptSeedReport(req.params.id, (req as any).seedTokenHash, v.report);
    if (!accepted) return res.status(401).json({ error: 'Unauthorized' });
    logger.info(`Capstone seed report accepted for enrollment ${req.params.id} (laptop-reported, unverified)`);

    // HANDOVER.md → the trainee repo, if it's linked already (otherwise linking does it).
    try {
      await commitPendingHandover(store, req.params.id, getGithubToken, commitFile);
    } catch (e: any) {
      logger.warn(`Could not commit HANDOVER.md for ${req.params.id}: ${e.message}`);
    }
    return res.status(204).end();
  });

  return router;
}

/** Commit a reported handover to the linked trainee repo, once. Shared with repo linking. */
export async function commitPendingHandover(
  store: CapstoneStore,
  id: string,
  getGithubToken: (url: string) => Promise<string | undefined>,
  commitFile: typeof commitRepoFile = commitRepoFile,
): Promise<boolean> {
  const pending = await store.pendingHandover(id);
  const target = pending && parseGithubRepoUrl(pending.repoUrl);
  if (!pending || !target) return false;
  const token = await getGithubToken(`https://github.com/${target.owner}/${target.repo}`);
  if (!token) throw new Error('No GitHub integration token configured');
  await commitFile(target, 'HANDOVER.md', pending.handover, 'chore: handover note from the previous engineer', token);
  await store.markHandoverCommitted(id);
  return true;
}
