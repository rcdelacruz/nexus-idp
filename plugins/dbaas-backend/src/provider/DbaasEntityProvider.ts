import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';
import { LoggerService } from '@backstage/backend-plugin-api';
import { DbaasStore, ConnectionRecord } from '../database/DbaasStore';
import { decrypt } from '../crypto';
import { getProvider } from '../providers/registry';
import { DbaasDatabase } from '../providers/types';

type EntityWithLocation = { entity: Entity; locationKey: string };

function toEntity(db: DbaasDatabase, conn: ConnectionRecord): Entity {
  // C2: lowercase BEFORE replacing — otherwise uppercase chars become '-' before lowercasing.
  // C3: include conn.id prefix so two users sharing the same cloud project don't collide.
  const sanitizedDbId = db.id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  const entityName = `${conn.provider}-${conn.id.slice(0, 8)}-${sanitizedDbId}`;

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: entityName,
      namespace: 'default',
      title: db.name,
      annotations: {
        // Format: <type>:<target> — bare string fails catalog processing
        'backstage.io/managed-by-location': `dbaas-provider:${conn.id}`,
        'backstage.io/managed-by-origin-location': `dbaas-provider:${conn.id}`,
        'dbaas/provider': conn.provider,
        'dbaas/connection-id': conn.id,
        [`${conn.provider}/project-id`]: db.id,
        [`${conn.provider}/region`]: db.region,
        ...(db.pgVersion ? { [`${conn.provider}/pg-version`]: db.pgVersion } : {}),
        ...(db.consoleUrl ? { [`${conn.provider}/console-url`]: db.consoleUrl } : {}),
      },
    },
    spec: {
      type: `${conn.provider}-database`,
      owner: conn.owner_ref,
      lifecycle: 'production',
    },
  };
}

export class DbaasEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  /**
   * C1: Per-connection entity cache.
   * On a partial failure (one connection's provider API down), we re-emit the
   * last known good entities for that connection so they are not deleted from
   * the catalog. Only connections that succeed update their slot in the cache.
   */
  private entityCache = new Map<string, EntityWithLocation[]>();

  constructor(
    private readonly storePromise: Promise<DbaasStore>,
    private readonly backendSecret: string,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return 'dbaas-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    // Initial sync on startup to restore catalog entities from persisted connections.
    // Fire-and-forget: store promise may not be resolved yet; errors are logged inside refresh().
    this.refresh().catch(err =>
      this.logger.warn(`DbaasEntityProvider initial sync failed: ${err.message}`),
    );
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      this.logger.warn('DbaasEntityProvider: not connected to catalog yet, skipping refresh');
      return;
    }

    const store = await this.storePromise;
    const allConnections = await store.getAllConnections();

    let successCount = 0;
    let failCount = 0;

    for (const conn of allConnections) {
      try {
        const provider = getProvider(conn.provider);
        if (!provider) {
          this.logger.warn(`DbaasEntityProvider: unknown provider '${conn.provider}', skipping`);
          continue;
        }

        const credentials = JSON.parse(decrypt(conn.credentials, this.backendSecret));
        const databases = await provider.fetchDatabases(credentials);

        const entities: EntityWithLocation[] = databases.map(db => ({
          entity: toEntity(db, conn),
          locationKey: `dbaas-provider:${conn.id}`,
        }));

        // Update cache only on success — failed connections keep last known good entities
        this.entityCache.set(conn.id, entities);

        await store.updateSyncStatus(conn.id, { lastSynced: new Date(), lastError: null });
        successCount++;

        this.logger.debug(
          `DbaasEntityProvider: synced ${databases.length} databases for connection ${conn.id} (${conn.provider}/${conn.label})`,
        );
      } catch (err: any) {
        this.logger.warn(
          `DbaasEntityProvider: sync failed for connection ${conn.id} (${conn.provider}/${conn.label}): ${err.message}`,
        );
        await store.updateSyncStatus(conn.id, { lastError: err.message });
        failCount++;
        // Cache not updated — entities from the last successful sync are preserved in allEntities below
      }
    }

    // Remove cache entries for connections that no longer exist (deleted connections)
    const activeIds = new Set(allConnections.map(c => c.id));
    for (const id of this.entityCache.keys()) {
      if (!activeIds.has(id)) {
        this.entityCache.delete(id);
      }
    }

    // Emit all entities: successful syncs + last-known-good for failed ones
    const allEntities = Array.from(this.entityCache.values()).flat();

    await this.connection.applyMutation({
      type: 'full',
      entities: allEntities,
    });

    this.logger.info(
      `DbaasEntityProvider: applied ${allEntities.length} entities from ${allConnections.length} connections (${successCount} ok, ${failCount} failed)`,
    );
  }
}
