import { PermissionPolicy, PolicyQuery } from '@backstage/plugin-permission-node';
import { DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  PolicyDecision,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import { BackstageIdentityResponse } from '@backstage/plugin-auth-node';
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
];

/** Platform admins — full access to everything including FinOps */
const isAdmin = (groups: string[]) =>
  groups.some(
    ref => ref === 'group:default/backstage-admins' || ref === 'group:default/admins',
  );

/** Team leads — any group ending in -lead */
const isLead = (groups: string[]) =>
  groups.some(ref => ref.startsWith('group:default/') && ref.endsWith('-lead'));

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
const isAssignedEngineer = (groups: string[]) =>
  groups.some(ref => ENGINEERING_TEAMS.includes(ref));

/**
 * New user / unassigned — in general-engineers but not yet in any department team.
 * Leads and admins also satisfy isAssignedEngineer, so this only catches truly unassigned users.
 */
const isUnassigned = (groups: string[]) =>
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
 * │ New User        │ general-engineers only  │ Docs, Tech Radar, onboarding only       │
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
    user?: BackstageIdentityResponse,
  ): Promise<PolicyDecision> {
    const groups = user?.identity.ownershipEntityRefs ?? [];
    const permissionName = request.permission.name;

    // ── Unauthenticated: deny everything ─────────────────────────────────────
    if (!user) {
      return { result: AuthorizeResult.DENY };
    }

    // ── Platform Admin: full access ──────────────────────────────────────────
    if (isAdmin(groups)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // ── Catalog entity read: role-based visibility filtering ─────────────────
    if (isResourcePermission(request.permission, RESOURCE_TYPE_CATALOG_ENTITY) &&
        request.permission.name === catalogEntityReadPermission.name) {

      // PM (without engineering team): groups, users, and components owned by their project teams.
      if (isPM(groups) && !isAssignedEngineer(groups)) {
        const projectTeamRefs = await this.getProjectTeamRefs(user.identity.userEntityRef);
        const allClaims = [...groups, ...projectTeamRefs];
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({ kinds: ['group', 'user'] }),
            catalogConditions.isEntityOwner({ claims: allClaims }),
          ],
        });
      }

      // Dev + SA (assigned engineers): components, APIs, systems, resources, templates, users, groups
      // Excludes Location kind and other internal catalog entities
      if (isAssignedEngineer(groups)) {
        return createCatalogConditionalDecision(request.permission, {
          anyOf: [
            catalogConditions.isEntityKind({
              kinds: ['component', 'api', 'system', 'domain', 'resource', 'template', 'user', 'group'],
            }),
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
    // Only Engineering Docs (custom plugin), Tech Radar read, and search.
    // No catalog, no scaffolder, no FinOps, no K8s, no ArgoCD.
    if (isUnassigned(groups)) {
      if (
        permissionName.startsWith('techdocs.') ||
        permissionName.startsWith('search.') ||
        permissionName.startsWith('engineering-docs.') ||
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
