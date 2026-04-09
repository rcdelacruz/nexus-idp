import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { CatalogClient } from '@backstage/catalog-client';
import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';

/**
 * catalog:fetch-entity-info
 *
 * Given an entity ref (from EntityPicker), reads the entity's catalog
 * annotations and returns the values needed for service templates.
 *
 * Eliminates manual re-entry of repo URL, port, owner in service templates.
 *
 * Usage in template:
 *   - id: fetch-entity
 *     action: catalog:fetch-entity-info
 *     input:
 *       entityRef: ${{ parameters.entityRef }}
 */
export function createFetchEntityInfoAction(options: { discovery: DiscoveryService; auth: AuthService }) {
  const { discovery, auth } = options;

  return createTemplateAction({
    id: 'catalog:fetch-entity-info',
    description: 'Read entity annotations from the Backstage catalog to auto-populate service template values',
    schema: {
      input: z =>
        z.object({
          entityRef: z.string().describe('Entity ref, e.g. component:default/my-service'),
        }),
      output: z =>
        z.object({
          appName: z.string(),
          repoOwner: z.string(),
          repoName: z.string(),
          containerPort: z.number(),
          owner: z.string(),
          description: z.string(),
          deploymentTarget: z.string(),
          database: z.string(),
        }),
    },
    async handler(ctx) {
      const { entityRef } = ctx.input;

      const catalogClient = new CatalogClient({ discoveryApi: discovery });
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });
      const entity = await catalogClient.getEntityByRef(entityRef, { token });

      if (!entity) {
        throw new Error(`Entity "${entityRef}" not found in catalog`);
      }

      const annotations = entity.metadata.annotations ?? {};

      // Resolve repo owner + name from annotations
      // Supports: github.com/project-slug (org/repo) or backstage.io/source-location (url:https://...)
      let repoOwner = '';
      let repoName = '';

      const projectSlug = annotations['github.com/project-slug'];
      if (projectSlug) {
        const parts = projectSlug.split('/');
        repoOwner = parts[0] ?? '';
        repoName = parts[1] ?? '';
      } else {
        const sourceLocation = annotations['backstage.io/source-location'] ?? '';
        const match = sourceLocation.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (match) {
          repoOwner = match[1];
          repoName = match[2].replace(/\.git$/, '');
        }
      }

      if (!repoOwner || !repoName) {
        throw new Error(
          `Cannot determine GitHub repo for "${entityRef}". ` +
            `Ensure "github.com/project-slug" annotation is set in catalog-info.yaml`,
        );
      }

      const containerPort = Number(
        annotations['backstage.io/container-port'] ??
        annotations['app/container-port'] ??
        3000,
      );
      const owner = typeof entity.spec?.owner === 'string' ? entity.spec.owner : '';
      const description = entity.metadata.description ?? '';
      // Prefer explicit annotation; fall back to inferring from target-specific annotations
      // so that entities scaffolded before app/deployment-target was added still work.
      let deploymentTarget = annotations['app/deployment-target'] ?? '';
      if (!deploymentTarget) {
        if (annotations['backstage.io/kubernetes-id']) {
          deploymentTarget = 'k8s-selfhosted';
        } else if (annotations['aws/ecs-service']) {
          deploymentTarget = 'ecs';
        } else if (annotations['aws/app-runner-service']) {
          deploymentTarget = 'app-runner';
        } else if (annotations['aws/lambda-function']) {
          deploymentTarget = 'lambda';
        }
      }
      const database = annotations['app/database'] ?? 'none';
      const appName = entity.metadata.name;

      ctx.logger.info(
        `Entity [${entityRef}]: app=${appName}, repo=${repoOwner}/${repoName}, ` +
        `port=${containerPort}, target=${deploymentTarget}, db=${database}`,
      );

      ctx.output('appName', appName);
      ctx.output('repoOwner', repoOwner);
      ctx.output('repoName', repoName);
      ctx.output('containerPort', containerPort);
      ctx.output('owner', owner);
      ctx.output('description', description);
      ctx.output('deploymentTarget', deploymentTarget);
      ctx.output('database', database);
    },
  });
}
