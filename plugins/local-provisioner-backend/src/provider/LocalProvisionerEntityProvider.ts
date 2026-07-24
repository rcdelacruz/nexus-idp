import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';
import { LoggerService } from '@backstage/backend-plugin-api';
import { TaskStore } from '../database/TaskStore';
import { Resource } from '../types';

const LOCATION_KEY = 'local-provisioner-provider:default';

/** Backstage entity names must be [a-z0-9-._]; sanitize resource names for safety. */
function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-._]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63) || 'resource';
}

function ownerRef(userId: string): string {
  // user_id is an email; catalog owner is a user entity ref.
  const username = userId.includes('@') ? userId.split('@')[0] : userId;
  return `user:default/${username}`;
}

function toEntity(resource: Resource): Entity {
  const name = `local-${sanitize(resource.resource_name)}-${resource.agent_id.slice(0, 8)}`;
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

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name,
      namespace: 'default',
      title: resource.resource_name,
      description: `Locally-provisioned ${resource.resource_type ?? 'resource'} (${resource.state})`,
      annotations,
      tags: ['local', 'development', ...(resource.resource_type ? [resource.resource_type] : [])],
    },
    spec: {
      type: resource.resource_type ?? 'local-resource',
      owner: ownerRef(resource.user_id),
      lifecycle: 'development',
      system: 'local-development',
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
      entity: toEntity(r),
      locationKey: LOCATION_KEY,
    }));

    await this.connection.applyMutation({ type: 'full', entities });
    this.logger.info(
      `LocalProvisionerEntityProvider: applied ${entities.length} resource entit${entities.length === 1 ? 'y' : 'ies'}`,
    );
  }
}
