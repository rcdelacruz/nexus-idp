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
 * Custom permission policy for Backstage catalog operations.
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

    // Handle catalog entity deletion - only admins
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
      permissionName.includes('.read') ||
      permissionName.includes('.list') ||
      permissionName.includes('.get')
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

    // Deny everything else by default
    return {
      result: AuthorizeResult.DENY,
    };
  }
}
