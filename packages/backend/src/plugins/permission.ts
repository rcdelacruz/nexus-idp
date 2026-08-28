import { PermissionPolicy, PolicyQuery, PolicyQueryUser } from '@backstage/plugin-permission-node';
import { DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  PolicyDecision,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
  catalogEntityRefreshPermission,
  catalogLocationCreatePermission,
  catalogLocationDeletePermission,
  RESOURCE_TYPE_CATALOG_ENTITY,
} from '@backstage/plugin-catalog-common/alpha';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';

/**
 * Department team group refs — engineers assigned to these have "assigned engineer" access.
 * New users are only in general-engineers until assigned.
 * NOTE: Keep in sync with DEPT_TEAM_IDS_JWT in plugins/onboarding/src/components/OnboardingPage.tsx.
 * Leads (e.g. web-lead) satisfy isLead() separately; this list is plain team membership only.
 */
const DEPT_TEAMS = [
  'group:default/web-team',
  'group:default/mobile-team',
  'group:default/data-team',
  'group:default/cloud-team',
  'group:default/ai-team',
  'group:default/qa-team',
  'group:default/pm-team',
  'group:default/sa-team',
  'group:default/devops-team',
];

/**
 * Role-check helpers. Exported as the single source of truth for group-membership
 * decisions — also consumed by scaffolderTaskGuard.ts, which enforces scaffolder.task.create
 * restrictions that this file's PermissionPolicy CANNOT actually enforce (see the comment
 * on the scaffolder.task.create handling below for why).
 */

/** Platform admins — full access to everything including FinOps */
export const isAdmin = (groups: string[]) =>
  groups.some(
    ref => ref === 'group:default/backstage-admins' || ref === 'group:default/admins',
  );

/** Team leads — any group ending in -lead */
export const isLead = (groups: string[]) =>
  groups.some(ref => ref.startsWith('group:default/') && ref.endsWith('-lead'));

/** DevOps / Platform Engineering — can run infra templates */
export const isDevOps = (groups: string[]) =>
  groups.some(ref => ref === 'group:default/devops-team');

/** Project managers */
const isPM = (groups: string[]) =>
  groups.some(ref => ref === 'group:default/pm-team');

/** Engineering teams only — excludes pm-team (PMs are not engineers) */
const ENGINEERING_TEAMS = DEPT_TEAMS.filter(
  t => t !== 'group:default/pm-team' && t !== 'group:default/general-engineers',
);

/**
 * Assigned engineers — members of at least one engineering team.
 * Excludes pm-team and general-engineers.
 */
export const isAssignedEngineer = (groups: string[]) =>
  groups.some(ref => ENGINEERING_TEAMS.includes(ref));

/**
 * New user / unassigned — in general-engineers but not yet in any department team.
 * Leads and admins also satisfy isAssignedEngineer, so this only catches truly unassigned users.
 */
export const isUnassigned = (groups: string[]) =>
  !isAdmin(groups) && !isLead(groups) && !isAssignedEngineer(groups);

/**
 * RBAC permission policy for Stratpoint IDP.
 *
 * Role hierarchy (determined by group membership):
 * ┌─────────────────┬─────────────────────────┬─────────────────────────────────────────┐
 * │ Role            │ Groups                  │ Access                                  │
 * ├─────────────────┼─────────────────────────┼─────────────────────────────────────────┤
 * │ Platform Admin  │ backstage-admins        │ Full access to all features + FinOps    │
 * │ Team Lead       │ *-lead                  │ Create/edit catalog for own team        │
 * │ Engineer        │ web/mobile/data/cloud/  │ Read catalog + use scaffolder           │
 * │                 │ ai/qa-team              │                                         │
 * │ New User        │ general-engineers only  │ Docs, Tech Radar, Local Provisioner,    │
 * │                 │                         │ onboarding only                         │
 * └─────────────────┴─────────────────────────┴─────────────────────────────────────────┘
 */
export class CatalogPermissionPolicy implements PermissionPolicy {
  private db: Awaited<ReturnType<DatabaseService['getClient']>> | null = null;

  constructor(db?: DatabaseService, private readonly logger?: LoggerService) {
    if (db) {
      db.getClient()
        .then(client => { this.db = client; })
        .catch(err => {
          this.logger?.error(
            `CatalogPermissionPolicy: DB init failed — PM project team visibility disabled: ${err.message}`,
          );
        });
    }
  }

  /** Get team refs from projects created by this user */
  private async getProjectTeamRefs(userEntityRef: string): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db('project_registration_projects')
        .select('team_name')
        .where('created_by', userEntityRef)
        .whereNotNull('team_name')
        .where('status', 'active');
      return rows
        .map((r: any) => r.team_name)
        .filter(Boolean)
        .map((t: string) => `group:default/${t}`);
    } catch {
      return [];
    }
  }

  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const groups = user?.info.ownershipEntityRefs ?? [];
    const permissionName = request.permission.name;

    // ── Unauthenticated: deny everything ─────────────────────────────────────
    if (!user) {
      return { result: AuthorizeResult.DENY };
    }

    // ── Platform Admin: full access ──────────────────────────────────────────
    if (isAdmin(groups)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // ── Local Provisioner admin activity view: admin only ────────────────────
    // Must be checked before the generic `local-provisioner.` prefix ALLOWs below
    // (both the unassigned-user block and the assigned-user block match on prefix
    // and would otherwise leak every user's task history to any authenticated user).
    if (permissionName === 'local-provisioner.task.read-all') {
      return { result: AuthorizeResult.DENY }; // isAdmin already handled above
    }

    // ── Catalog entity read: role-based visibility filtering ─────────────────
    if (isResourcePermission(request.permission, RESOURCE_TYPE_CATALOG_ENTITY) &&
        request.permission.name === catalogEntityReadPermission.name) {

      // PM (without engineering team): groups, users, and components owned by their project teams.
      if (isPM(groups) && !isAssignedEngineer(groups)) {
        const projectTeamRefs = await this.getProjectTeamRefs(user.info.userEntityRef);
        const allClaims = [...groups, ...projectTeamRefs];
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({ kinds: ['group', 'user'] }),
            catalogConditions.isEntityOwner({ claims: allClaims }),
          ],
        });
      }

      // DevOps: full catalog visibility including service + infra templates
      if (isDevOps(groups)) {
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({
              kinds: ['component', 'api', 'system', 'domain', 'resource', 'template', 'user', 'group'],
            }),
          ],
        });
      }

      // Team leads: see everything engineers see + governance templates (promote-app)
      if (isLead(groups)) {
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({
              kinds: ['component', 'api', 'system', 'domain', 'resource', 'user', 'group'],
            }),
            {
              allOf: [
                catalogConditions.isEntityKind({ kinds: ['template'] }),
                {
                  anyOf: [
                    {
                      not: catalogConditions.isEntityOwner({
                        claims: ['group:default/devops-team'],
                      }),
                    },
                    // Governance templates (e.g. promote-app) are visible to leads
                    catalogConditions.hasSpec({ key: 'type', value: 'governance' }),
                  ],
                },
              ],
            },
          ],
        });
      }

      // Engineers: same catalog visibility but templates filtered — devops-team-owned templates hidden
      if (isAssignedEngineer(groups)) {
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({
              kinds: ['component', 'api', 'system', 'domain', 'resource', 'user', 'group'],
            }),
            {
              allOf: [
                catalogConditions.isEntityKind({ kinds: ['template'] }),
                {
                  not: catalogConditions.isEntityOwner({
                    claims: ['group:default/devops-team'],
                  }),
                },
              ],
            },
          ],
        });
      }

      // Unassigned / new users: same as intern — training templates only
      return createCatalogConditionalDecision(request.permission, {
        allOf: [
          catalogConditions.isEntityKind({ kinds: ['template'] }),
          catalogConditions.hasSpec({ key: 'type', value: 'training' }),
        ],
      });
    }

    // ── FinOps: admin only (must precede generic .read wildcard below) ────────
    if (permissionName.startsWith('finops.')) {
      return { result: AuthorizeResult.DENY };
    }

    // ── New User (unassigned): very limited access ───────────────────────────
    // Engineering Docs (custom plugin), Tech Radar read, search, and Local Provisioner
    // (self-service dev tooling against the user's own laptop — no shared-infra blast
    // radius, unlike FinOps/K8s/ArgoCD which stay gated below).
    // No catalog, no scaffolder, no FinOps, no K8s, no ArgoCD — EXCEPT running the
    // training templates surfaced via Local Provisioner's "Provision resource" button
    // (deep-links to /create?...&trainingAccess=1).
    //
    // scaffolder.task.create is deliberately left as a plain ALLOW below (falls through
    // to the generic prefix check, which doesn't match it — DENY — so this comment is the
    // reason it's NOT special-cased here): POST /api/scaffolder/v2/tasks checks this
    // permission via @backstage/plugin-scaffolder-backend's checkPermission(), which calls
    // permissionService.authorize() with NO resourceRef — no template, no entity, nothing.
    // taskCreatePermission's own resourceType is RESOURCE_TYPE_SCAFFOLDER_TASK, not
    // RESOURCE_TYPE_CATALOG_ENTITY, so isResourcePermission(request.permission,
    // RESOURCE_TYPE_CATALOG_ENTITY) is ALWAYS false for this exact call — a
    // createCatalogConditionalDecision returned here can never actually evaluate against
    // the requested template, because the framework never gives this policy the template to
    // evaluate against. (Confirmed by reading node_modules/@backstage/plugin-scaffolder-backend/
    // dist/service/router.cjs.js — the POST /v2/tasks handler.) Real per-template enforcement
    // (training-only for unassigned users, devops-owned-template exclusion for engineers) is
    // done in packages/backend/src/plugins/scaffolderTaskGuard.ts, a root-http-router
    // middleware that runs BEFORE the scaffolder plugin's own router and DOES have the
    // template body available to check. See knowledge/patterns/
    // scaffolder-task-create-is-not-resource-aware.md for the full writeup.
    if (isUnassigned(groups)) {
      if (
        permissionName === 'scaffolder.task.create' ||
        // scaffolder.action.execute IS properly resource-aware (checked via
        // authorizeConditional against RESOURCE_TYPE_SCAFFOLDER_ACTION — unlike
        // scaffolder.task.create, see the comment above) but by the time any action runs,
        // scaffolderTaskGuard.ts has already vetted the template itself at task-creation
        // time; no further per-action restriction is needed for a role already confined to
        // running only training templates. Matches assigned engineers, who already get this
        // permission unconditionally via the generic scaffolder ALLOW fallback below.
        permissionName === 'scaffolder.action.execute' ||
        permissionName.startsWith('techdocs.') ||
        permissionName.startsWith('search.') ||
        permissionName.startsWith('engineering-docs.') ||
        permissionName.startsWith('local-provisioner.') ||
        permissionName.endsWith('.read') ||
        permissionName.endsWith('.list') ||
        permissionName.endsWith('.get')
      ) {
        return { result: AuthorizeResult.ALLOW };
      }
      return { result: AuthorizeResult.DENY };
    }

    // ── From here: all assigned users (engineers + leads) ────────────────────

    // Catalog delete: admin only (handled above)
    if (request.permission === catalogEntityDeletePermission) {
      return { result: AuthorizeResult.DENY };
    }

    // Catalog location delete: admin only
    if (request.permission === catalogLocationDeletePermission) {
      return { result: AuthorizeResult.DENY };
    }

    // Catalog create / location create: leads + admins only
    if (
      request.permission === catalogEntityCreatePermission ||
      request.permission === catalogLocationCreatePermission
    ) {
      if (isLead(groups)) {
        return { result: AuthorizeResult.ALLOW };
      }
      return { result: AuthorizeResult.DENY };
    }

    // Catalog entity refresh: leads + engineers (not new users, handled above)
    if (request.permission === catalogEntityRefreshPermission) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Read operations: all assigned users
    if (
      permissionName.endsWith('.read') ||
      permissionName.endsWith('.list') ||
      permissionName.endsWith('.get')
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Scaffolder: use templates → engineers + leads (not new hires)
    // Create/edit templates → leads only
    // Infra templates (owned by devops-team) → admins + devops only
    if (permissionName.startsWith('scaffolder.')) {
      // Template management (creating/editing templates in the catalog) → leads only
      if (
        permissionName === 'scaffolder.template.create' ||
        permissionName === 'scaffolder.template.update' ||
        permissionName === 'scaffolder.template.delete'
      ) {
        if (isLead(groups)) {
          return { result: AuthorizeResult.ALLOW };
        }
        return { result: AuthorizeResult.DENY };
      }

      // Infra template execution (admins + devops only), governance templates
      // (spec.type: governance, admins + devops + leads), and the teardown-app exclusion
      // for engineers (irreversible destructive action — leads/admins only) are all enforced
      // in packages/backend/src/plugins/scaffolderTaskGuard.ts, NOT here. scaffolder.task.create
      // is checked by the framework with no resourceRef (see the isUnassigned() branch above
      // for the full explanation of why a conditional decision on this permission is dead
      // code) — this file cannot see which template is being requested for this permission,
      // so it cannot enforce any of the above. Falls through to plain ALLOW below; the guard
      // is the actual enforcement point.

      // All other scaffolder operations (use templates, view tasks, etc.) → all assigned engineers
      return { result: AuthorizeResult.ALLOW };
    }

    // Search: all assigned users
    if (permissionName.startsWith('search.')) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Engineering Docs / TechDocs: all assigned users
    if (
      permissionName.startsWith('techdocs.') ||
      permissionName.startsWith('engineering-docs.')
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Local Provisioner: engineers and leads can provision own environments
    if (permissionName.startsWith('local-provisioner.')) {
      return { result: AuthorizeResult.ALLOW };
    }


    // Kubernetes + ArgoCD: assigned engineers and leads can view
    if (
      permissionName.startsWith('kubernetes.') ||
      permissionName.startsWith('argocd.')
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Default: allow read/list, deny write for assigned users
    return { result: AuthorizeResult.DENY };
  }
}
