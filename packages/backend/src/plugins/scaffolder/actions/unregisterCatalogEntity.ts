import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { CatalogClient } from '@backstage/catalog-client';
import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';

/**
 * Scaffolder action: catalog:unregister-entity
 *
 * Unregisters one or more catalog entities and their origin location. Deleting
 * only the entity leaves the location record behind, which causes a 409
 * Conflict if the same repo is ever re-scaffolded (scripts/teardown.sh
 * Step 6/6 solves the same problem). Idempotent — a 404 on either call is a
 * warning, not a failure.
 */
export function createUnregisterCatalogEntityAction(options: {
  discovery: DiscoveryService;
  auth: AuthService;
}) {
  const { discovery, auth } = options;

  return createTemplateAction({
    id: 'catalog:unregister-entity',
    description: 'Unregister catalog entities and their origin location',
    schema: {
      input: z =>
        z.object({
          entityRefs: z.array(z.string()).describe('Entity refs to unregister, e.g. component:default/my-app'),
        }),
      output: z =>
        z.object({
          unregistered: z.array(z.string()),
        }),
    },
    async handler(ctx) {
      const { entityRefs } = ctx.input;

      const catalogClient = new CatalogClient({ discoveryApi: discovery });
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });

      const unregistered: string[] = [];
      const locationIds = new Set<string>();

      for (const entityRef of entityRefs) {
        const entity = await catalogClient.getEntityByRef(entityRef, { token });
        if (!entity) {
          ctx.logger.warn(`Catalog entity ${entityRef} not found — already unregistered`);
          continue;
        }

        const location = await catalogClient.getLocationByEntity(entityRef, { token }).catch(() => undefined);
        if (location?.id) locationIds.add(location.id);

        const uid = entity.metadata.uid;
        if (!uid) {
          ctx.logger.warn(`Catalog entity ${entityRef} has no uid — skipping`);
          continue;
        }

        ctx.logger.info(`Unregistering entity ${entityRef} (uid: ${uid})...`);
        try {
          await catalogClient.removeEntityByUid(uid, { token });
          unregistered.push(entityRef);
        } catch (err: any) {
          if (err.statusCode === 404) {
            ctx.logger.warn(`Catalog entity ${entityRef} not found — already unregistered`);
          } else {
            ctx.logger.warn(`Could not unregister ${entityRef}: ${err.message}`);
          }
        }
      }

      for (const locationId of locationIds) {
        ctx.logger.info(`Deleting catalog location ${locationId}...`);
        try {
          await catalogClient.removeLocationById(locationId, { token });
        } catch (err: any) {
          if (err.statusCode === 404) {
            ctx.logger.warn(`Catalog location ${locationId} not found — already removed`);
          } else {
            ctx.logger.warn(`Could not delete catalog location ${locationId}: ${err.message}`);
          }
        }
      }

      ctx.output('unregistered', unregistered);
    },
  });
}
