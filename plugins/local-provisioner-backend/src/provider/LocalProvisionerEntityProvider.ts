import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';
import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskStore } from '../database/TaskStore';
import { Resource } from '../types';

const LOCATION_KEY = 'local-provisioner-provider:default';

/**
 * Backstage entity names must be [a-z0-9-._]; sanitize resource names for safety.
 *
 * The leading/trailing-separator strip must run both BEFORE and AFTER the 63-char slice —
 * running it only before (as this used to) doesn't help when the input is long enough that
 * truncation itself lands mid-separator, producing a name like "...agent-" that's still
 * invalid. Confirmed live: a devops-capstone-training resource whose full name sliced to
 * exactly "...-agent-" (a new trailing hyphen introduced BY the slice) still failed catalog
 * policy validation despite being exactly 63 chars.
 */
function sanitize(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-._]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 63)
      // Must run again after the slice, AND strip a run of separators (+, not a single
      // char) — truncation can land after any number of stacked separators
      // (e.g. "-_", ".-"), and a single-char strip leaves one behind. Fuzz-tested against
      // the real KubernetesValidatorFunctions.isValidObjectName with 200k random inputs
      // before trusting this.
      .replace(/^[-._]+|[-._]+$/g, '') || 'resource'
  );
}

function ownerRef(userId: string): string {
  // user_id is an email; catalog owner is a user entity ref.
  const username = userId.includes('@') ? userId.split('@')[0] : userId;
  return `user:default/${username}`;
}

function toEntity(resource: Resource, resourceDocsLinks: Record<string, string>): Entity {
  // sanitize() truncates to 63 chars, but that must apply to the FINAL assembled name, not
  // just the resource_name substring — the local- prefix and -agentIdPrefix suffix are added
  // after, so truncating only resource_name first can still produce a name over the 63-char
  // catalog limit (confirmed live: a devops-capstone-training resource with a long
  // username+timestamp produced a 65-char name and failed catalog policy validation).
  const name = sanitize(`local-${resource.resource_name}-${resource.agent_id.slice(0, 8)}`);
  const conn = resource.connection_details || {};
  const annotations: Record<string, string> = {
    'backstage.io/managed-by-location': LOCATION_KEY,
    'backstage.io/managed-by-origin-location': LOCATION_KEY,
    'local-provisioner/agent-id': resource.agent_id,
    'local-provisioner/state': resource.state,
    'local-provisioner/resource-name': resource.resource_name,
  };
  if (conn.connectionString) annotations['local-provisioner/connection-string'] = conn.connectionString;
  if (conn.ui) annotations['local-provisioner/ui'] = conn.ui;

  // Deployment-specific, config-driven (see `resourceDocsLinks` in app-config.yaml) — links a
  // provisioned resource back to related documentation (e.g. training materials) in the catalog.
  // No hardcoded ref here: this plugin is synced to the white-label downstream, and the ref only
  // makes sense for this deployment's own catalog content.
  const docsRef = resource.resource_type ? resourceDocsLinks[resource.resource_type] : undefined;

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name,
      namespace: 'default',
      title: resource.resource_name,
      description: `Locally-provisioned ${resource.resource_type ?? 'resource'} (${resource.state})`,
      annotations,
      tags: [
        'local',
        'development',
        ...(resource.resource_type ? [resource.resource_type] : []),
        ...(resource.resource_type?.endsWith('-training') ? ['training', 'local-provisioning'] : []),
      ],
    },
    spec: {
      type: resource.resource_type ?? 'local-resource',
      owner: ownerRef(resource.user_id),
      lifecycle: 'development',
      system: 'local-development',
      ...(docsRef ? { dependsOn: [docsRef] } : {}),
    },
  };
}

/**
 * Emits a catalog `Resource` entity for every active locally-provisioned resource, mirroring
 * DbaasEntityProvider. The catalog reflects the DB state: teardown removes the entity on the
 * next refresh. Replaces the never-wired CatalogService.addLocation stub.
 */
export class LocalProvisionerEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly storePromise: Promise<TaskStore>,
    private readonly logger: LoggerService,
    private readonly resourceDocsLinks: Record<string, string> = {},
  ) {}

  getProviderName(): string {
    return 'local-provisioner-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    // Fire-and-forget initial sync (store promise may resolve slightly later).
    this.refresh().catch(err =>
      this.logger.warn(`LocalProvisionerEntityProvider initial sync failed: ${err.message}`),
    );
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      this.logger.warn('LocalProvisionerEntityProvider: not connected to catalog yet, skipping');
      return;
    }
    const store = await this.storePromise;
    const resources = await store.getActiveProvisionedResources();

    const entities = resources.map(r => ({
      entity: toEntity(r, this.resourceDocsLinks),
      locationKey: LOCATION_KEY,
    }));

    await this.connection.applyMutation({ type: 'full', entities });
    this.logger.info(
      `LocalProvisionerEntityProvider: applied ${entities.length} resource entit${entities.length === 1 ? 'y' : 'ies'}`,
    );
  }
}
