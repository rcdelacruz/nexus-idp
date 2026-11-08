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
import { RELATION_OWNED_BY, parseEntityRef, stringifyEntityRef, type Entity } from '@backstage/catalog-model';
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
  // Lowercased to match the catalog's HAS_SPEC rule, which compares case-insensitively — otherwise
  // a `type: Training` template would be visible in the catalog but blocked here.
  const specType = (template.spec as { type?: unknown } | undefined)?.type;
  const isTraining = typeof specType === 'string' && specType.toLowerCase() === 'training';
  const isTeardownApp = template.metadata?.name === 'teardown-app';
  const ownedByDevops = isOwnedByDevops(template);

  if (isLead(groups)) {
    // Leads: any non-devops-owned template, plus devops-owned governance templates
    // (e.g. promote-app) and training labs.
    return !ownedByDevops || isGovernance || isTraining;
  }

  if (isAssignedEngineer(groups)) {
    // Engineers: any non-devops-owned template plus training labs (Local Provisioner, for every
    // engineer), except teardown-app outright (irreversible destructive action — leads/admins
    // only, see .claude/plans/teardown-application-plan.md).
    return (!ownedByDevops || isTraining) && !isTeardownApp;
  }

  if (isUnassigned(groups)) {
    // New/unassigned users: training templates only (surfaced via Local Provisioner's
    // "Provision resource" button).
    return isTemplateKind && isTraining;
  }

  return false;
}

/**
 * The token of an `Authorization: Bearer <token>` header, parsed the way the Backstage framework parses it (scheme case-insensitive,
 * one or more spaces). The guard used to require the exact string "Bearer ", so `bearer <token>` skipped it (audit 2026-11-07).
 */
export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer[ ]+(\S+)$/i.exec(header ?? '')?.[1];
}

/**
 * The canonical `kind:namespace/name` of a template reference, parsed the way the scaffolder parses it (kind defaults to `template`,
 * namespace to `default`). Undefined when it is not a string or does not parse. The guard used to look up the raw string and let
 * anything it could not parse through, while the scaffolder accepted both.
 */
export function canonicalTemplateRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return stringifyEntityRef(parseEntityRef(raw, { defaultKind: 'template', defaultNamespace: 'default' }));
  } catch {
    return undefined;
  }
}

export type GuardDecision = { allow: true } | { allow: false; status: number; error: string; message: string };

/**
 * The guard's whole decision for one POST /v2/tasks request, with its two lookups injected so it can be tested. Fails CLOSED for a
 * user it can identify: a malformed template reference is a 400, and a catalog failure is a 503 (it used to let the request through).
 * A token it cannot resolve to groups (the static external-access token, an invalid token) still defers to the framework's own auth
 * downstream, as before.
 */
export async function decideTaskCreation(
  input: { authorization?: string; body?: unknown },
  deps: {
    resolveGroups: (token: string) => Promise<string[] | undefined>;
    getTemplate: (canonicalRef: string, token: string) => Promise<Entity | undefined>;
  },
): Promise<GuardDecision> {
  const token = bearerToken(input.authorization);
  if (!token) return { allow: true }; // no/malformed bearer token: the scaffolder's own httpAuth produces the 401
  const groups = await deps.resolveGroups(token);
  if (!groups) return { allow: true }; // not a user session: downstream auth decides
  if (isAdmin(groups) || isDevOps(groups)) return { allow: true };

  const rawRef = (input.body as { templateRef?: unknown } | undefined)?.templateRef;
  const templateRef = canonicalTemplateRef(rawRef);
  if (!templateRef) {
    return { allow: false, status: 400, error: 'Bad Request', message: 'templateRef must be a template reference string such as template:default/name' };
  }
  let template: Entity | undefined;
  try {
    template = await deps.getTemplate(templateRef, token);
  } catch {
    return { allow: false, status: 503, error: 'Service Unavailable', message: 'The template could not be checked right now. Try again in a moment.' };
  }
  if (!template) {
    return { allow: false, status: 403, error: 'Forbidden', message: `Template not found or not visible: ${templateRef}` };
  }
  if (!isTaskCreationAllowed(groups, template)) {
    return { allow: false, status: 403, error: 'Forbidden', message: `You do not have permission to run template: ${templateRef}` };
  }
  return { allow: true };
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
      const authBaseUrl = await discovery.getBaseUrl('auth');
      const decision = await decideTaskCreation(
        { authorization: req.headers.authorization, body: req.body },
        {
          resolveGroups: token => resolveGroups(token, authBaseUrl),
          getTemplate: async (ref, token) => (await catalogClient.getEntityByRef(ref, { token })) ?? undefined,
        },
      );
      if (decision.allow) {
        next();
        return;
      }
      log.warn(`scaffolder.task.create refused (${decision.status}): ${decision.message}`);
      res.status(decision.status).json({ error: decision.error, message: decision.message });
    })().catch(err => {
      // Fail CLOSED: this guard is the real enforcement for who may run which template (permission.ts cannot see the template), so an
      // unexpected error must not wave a request through.
      log.error(`scaffolderTaskGuard failed unexpectedly, refusing the request: ${err.message}`);
      res.status(503).json({ error: 'Service Unavailable', message: 'The template could not be checked right now. Try again in a moment.' });
    });
  };
}
