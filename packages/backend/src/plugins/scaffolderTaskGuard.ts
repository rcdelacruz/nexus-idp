/**
 * Real, per-template enforcement for POST /api/scaffolder/v2/tasks (scaffolder.task.create).
 *
 * WHY THIS FILE EXISTS (read this before touching permission.ts's scaffolder.task.create
 * handling): @backstage/plugin-scaffolder-backend checks scaffolder.task.create via
 * checkPermission(), which calls permissionService.authorize() with NO resourceRef — no
 * template, no entity. taskCreatePermission's resourceType is RESOURCE_TYPE_SCAFFOLDER_TASK,
 * not RESOURCE_TYPE_CATALOG_ENTITY, so a PermissionPolicy can NEVER see which template is
 * being requested for this specific permission check — a createCatalogConditionalDecision
 * returned from permission.ts for this permission is dead code, guaranteed to never evaluate
 * against the real template (confirmed by reading
 * node_modules/@backstage/plugin-scaffolder-backend/dist/service/router.cjs.js, the
 * POST /v2/tasks handler). See knowledge/patterns/scaffolder-task-create-is-not-resource-aware.md
 * for the full writeup and how this was discovered (2026-07-26).
 *
 * This module is the actual enforcement point instead: a root-http-router middleware
 * (wired in packages/backend/src/index.ts via rootHttpRouterServiceFactory) that runs
 * BEFORE the scaffolder plugin's own router, has the request body available, and can fetch
 * the target template entity from the catalog to make a real per-template decision.
 *
 * Identity resolution here mirrors @backstage/backend-defaults's DefaultUserInfoService
 * (coreServices.userInfo) exactly: decode the token's `ent` claim directly, falling back to
 * a loopback call to the auth plugin's /v1/userinfo endpoint if the token doesn't carry it
 * inline. That IS Backstage's own official mechanism for this — not a shortcut. The token
 * itself must already be a validly-signed session for the request to reach anything
 * protected later in the pipeline (scaffolder's own httpAuth.credentials() check still runs
 * downstream), so this guard denying based on decoded-but-unverified claims is safe (fails
 * toward stricter, never toward bypassing real auth), and allowing based on forged claims
 * gains an attacker nothing — a forged/unsigned token still fails the real auth check that
 * follows.
 */
import type { RootConfigService, LoggerService } from '@backstage/backend-plugin-api';
import type { RequestHandler } from 'express';
import { CatalogClient } from '@backstage/catalog-client';
import { HostDiscovery } from '@backstage/backend-defaults/discovery';
import { RELATION_OWNED_BY, type Entity } from '@backstage/catalog-model';
import {
  isAdmin,
  isDevOps,
  isLead,
  isAssignedEngineer,
  isUnassigned,
} from './permission';

export const SCAFFOLDER_TASKS_PATH = '/api/scaffolder/v2/tasks';
const DEVOPS_TEAM_REF = 'group:default/devops-team';

/**
 * Minimal, dependency-free JWT payload decode (base64url, no signature verification —
 * see the file-level comment for why that's safe here). Returns undefined on anything
 * that doesn't look like a well-formed JWT.
 */
function decodeJwtPayload(token: string): { sub?: string; ent?: string[] } | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Resolves ownershipEntityRefs (groups) for the given raw bearer token. Mirrors
 * DefaultUserInfoService: prefer the token's own `ent` claim, fall back to the auth
 * plugin's /v1/userinfo endpoint (needed for tokens that don't embed it, e.g. some
 * service-to-service or third-party-issued tokens).
 */
async function resolveGroups(
  token: string,
  authBaseUrl: string,
): Promise<string[] | undefined> {
  const payload = decodeJwtPayload(token);
  if (payload?.ent) {
    return payload.ent;
  }

  const res = await fetch(`${authBaseUrl}/v1/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { claims?: { ent?: string[] } };
  return body.claims?.ent;
}

function isOwnedByDevops(entity: Entity): boolean {
  return (entity.relations ?? []).some(
    r => r.type === RELATION_OWNED_BY && r.targetRef === DEVOPS_TEAM_REF,
  );
}

/**
 * The actual authorization decision, factored out as a pure function so it's unit-testable
 * without any HTTP/Express/catalog-client plumbing. Mirrors what permission.ts's
 * scaffolder.task.create handling always intended to enforce (see the dead-code comments
 * there) plus the training-only rule for unassigned users.
 */
export function isTaskCreationAllowed(groups: string[], template: Entity): boolean {
  if (isAdmin(groups) || isDevOps(groups)) {
    return true;
  }

  const isTemplateKind = template.kind?.toLowerCase() === 'template';
  const isGovernance = (template.spec as { type?: unknown } | undefined)?.type === 'governance';
  const isTraining = (template.spec as { type?: unknown } | undefined)?.type === 'training';
  const isTeardownApp = template.metadata?.name === 'teardown-app';
  const ownedByDevops = isOwnedByDevops(template);

  if (isLead(groups)) {
    // Leads: any non-devops-owned template, plus devops-owned governance templates
    // (e.g. promote-app).
    return !ownedByDevops || isGovernance;
  }

  if (isAssignedEngineer(groups)) {
    // Engineers: any non-devops-owned template, except teardown-app outright (irreversible
    // destructive action — leads/admins only, see .claude/plans/teardown-application-plan.md).
    return !ownedByDevops && !isTeardownApp;
  }

  if (isUnassigned(groups)) {
    // New/unassigned users: training templates only (surfaced via Local Provisioner's
    // "Provision resource" button).
    return isTemplateKind && isTraining;
  }

  return false;
}

export function createScaffolderTaskGuard({
  config,
  logger,
}: {
  config: RootConfigService;
  logger: LoggerService;
}): RequestHandler {
  const discovery = HostDiscovery.fromConfig(config, { logger });
  const catalogClient = new CatalogClient({ discoveryApi: discovery });
  const log = logger.child({ middleware: 'scaffolderTaskGuard' });

  return (req, res, next) => {
    // Mounted at SCAFFOLDER_TASKS_PATH (see index.ts), so req.path is already scoped to
    // this route by Express — only the method still needs filtering (GET /v2/tasks, listing
    // tasks, shares this exact path and must not be intercepted).
    if (req.method !== 'POST') {
      next();
      return;
    }

    (async () => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        // No/malformed bearer token — not our job to reject; let the scaffolder plugin's
        // own httpAuth.credentials() produce the normal 401.
        next();
        return;
      }
      const token = authHeader.slice('Bearer '.length);

      const authBaseUrl = await discovery.getBaseUrl('auth');
      const groups = await resolveGroups(token, authBaseUrl);
      if (!groups) {
        log.warn('Could not resolve identity for scaffolder.task.create guard check; deferring to downstream auth');
        next();
        return;
      }

      // Admins/devops never need a catalog round-trip.
      if (isAdmin(groups) || isDevOps(groups)) {
        next();
        return;
      }

      const templateRef = req.body?.templateRef;
      if (typeof templateRef !== 'string') {
        // Malformed request body — let the scaffolder plugin's own validation reject it.
        next();
        return;
      }

      const template = await catalogClient.getEntityByRef(templateRef, { token });
      if (!template) {
        log.warn(`scaffolder.task.create denied: template not found: ${templateRef}`);
        res.status(403).json({
          error: 'Forbidden',
          message: `Template not found or not visible: ${templateRef}`,
        });
        return;
      }

      if (!isTaskCreationAllowed(groups, template)) {
        log.warn(`scaffolder.task.create denied for template ${templateRef}`, { groups });
        res.status(403).json({
          error: 'Forbidden',
          message: `You do not have permission to run template: ${templateRef}`,
        });
        return;
      }

      next();
    })().catch(err => {
      // Fail OPEN on unexpected internal errors (catalog unavailable, etc.) — this guard is
      // an ADDITIONAL restriction layered on top of what already ships; a transient failure
      // here should not take down provisioning entirely. Loud logging makes it actionable.
      log.error(`scaffolderTaskGuard failed unexpectedly, allowing request through: ${err.message}`);
      next();
    });
  };
}
