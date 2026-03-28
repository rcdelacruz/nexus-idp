import { PermissionPolicy, PolicyQuery } from '@backstage/plugin-permission-node';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import { BackstageIdentityResponse } from '@backstage/plugin-auth-node';
import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityRefreshPermission,
  catalogLocationCreatePermission,
  catalogLocationDeletePermission,
} from '@backstage/plugin-catalog-common/alpha';

/**
<<<<<<< HEAD
 * Custom permission policy for Backstage catalog operations.
=======
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
];

/** Platform admins — full access to everything including FinOps */
const isAdmin = (groups: string[]) =>
  groups.some(
    ref => ref === 'group:default/backstage-admins' || ref === 'group:default/admins',
  );

/** Team leads — any group ending in -lead */
const isLead = (groups: string[]) =>
  groups.some(ref => ref.startsWith('group:default/') && ref.endsWith('-lead'));

/**
 * Assigned engineers — members of at least one department team.
 * This is separate from general-engineers (base group everyone is in).
 */
const isAssignedEngineer = (groups: string[]) =>
  groups.some(ref => DEPT_TEAMS.includes(ref));

/**
 * New user / unassigned — in general-engineers but not yet in any department team.
 * Leads and admins also satisfy isAssignedEngineer, so this only catches truly unassigned users.
 */
const isUnassigned = (groups: string[]) =>
  !isAdmin(groups) && !isLead(groups) && !isAssignedEngineer(groups);

/**
 * RBAC permission policy for Nexus IDP.
>>>>>>> 32739b3 (fix(security): audit fixes — finops permission, purge scheduler, DEPT_TEAMS sync, deploy pipeline)
 *
 * This policy implements role-based access control (RBAC) for catalog entities.
 *
 * Role hierarchy:
 * - backstage-admins: Full access to all operations
 * - Regular users: Read-only access, can create entities but not delete
 */
export class CatalogPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: BackstageIdentityResponse,
  ): Promise<PolicyDecision> {
    // Get user's group memberships
    const userGroups = user?.identity.ownershipEntityRefs || [];

    // ── Unauthenticated: deny everything ─────────────────────────────────────
    if (!user) {
      return { result: AuthorizeResult.DENY };
    }

    // Check if user is an admin
    const isAdmin = userGroups.some(
      ref =>
        ref === 'group:default/backstage-admins' ||
        ref === 'group:default/admins'
    );

    // Admin users have full access
    if (isAdmin) {
      return { result: AuthorizeResult.ALLOW };
    }

<<<<<<< HEAD
    // Handle catalog entity deletion - only admins
=======
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
        // Read-only catalog access — browse teams, services, APIs
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
>>>>>>> 32739b3 (fix(security): audit fixes — finops permission, purge scheduler, DEPT_TEAMS sync, deploy pipeline)
    if (request.permission === catalogEntityDeletePermission) {
      return {
        result: AuthorizeResult.DENY,
      };
    }

    // Handle catalog location deletion - only admins
    if (request.permission === catalogLocationDeletePermission) {
      return {
        result: AuthorizeResult.DENY,
      };
    }

    // Allow entity creation for authenticated users
    if (
      request.permission === catalogEntityCreatePermission ||
      request.permission === catalogLocationCreatePermission
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow entity refresh for authenticated users
    if (request.permission === catalogEntityRefreshPermission) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Default: allow read operations, deny write operations
    const permissionName = request.permission.name;

    // Allow all read permissions
    if (
      permissionName.endsWith('.read') ||
      permissionName.endsWith('.list') ||
      permissionName.endsWith('.get')
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow scaffolder operations for authenticated users
    if (permissionName.startsWith('scaffolder.')) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow search operations
    if (permissionName.startsWith('search.')) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow TechDocs operations
    if (permissionName.startsWith('techdocs.')) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Allow local provisioner operations for authenticated users
    if (permissionName.startsWith('local-provisioner.')) {
      return { result: AuthorizeResult.ALLOW };
    }

<<<<<<< HEAD
    // Deny everything else by default
    return {
      result: AuthorizeResult.DENY,
    };
=======

    // Kubernetes + ArgoCD: assigned engineers and leads can view
    if (
      permissionName.startsWith('kubernetes.') ||
      permissionName.startsWith('argocd.')
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Default: allow read/list, deny write for assigned users
    return { result: AuthorizeResult.DENY };
>>>>>>> 32739b3 (fix(security): audit fixes — finops permission, purge scheduler, DEPT_TEAMS sync, deploy pipeline)
  }
}
