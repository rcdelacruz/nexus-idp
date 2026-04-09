import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { CatalogClient } from '@backstage/catalog-client';
import { DiscoveryService, AuthService } from '@backstage/backend-plugin-api';

/**
 * scaffolder:get-target-config
 *
 * Given a target name, reads all its config values from app-config
 * (scaffolder.targets) and outputs them for use in fetch:template steps.
 *
 * For ECS: if the cluster is not found in app-config, falls back to the
 * Backstage catalog — Resource entities with spec.type: ecs-cluster are
 * auto-discovered when provisioned via the infra template.
 *
 * Usage in template:
 *   - id: get-k8s-config
 *     action: scaffolder:get-target-config
 *     input:
 *       targetType: kubernetes
 *       targetName: talos-homelab
 *
 *   - id: get-ecs-config
 *     action: scaffolder:get-target-config
 *     input:
 *       targetType: aws
 *       targetName: stratpoint-nonprod
 *       service: ecs
 *       # serviceName optional — auto-selects if only one cluster in catalog
 */
export function createGetTargetConfigAction(options: {
  config: Config;
  discovery: DiscoveryService;
  auth: AuthService;
}) {
  const { config, discovery, auth } = options;

  return createTemplateAction({
    id: 'scaffolder:get-target-config',
    description: 'Read full config for a deployment target from platform config or catalog',
    schema: {
      input: z =>
        z.object({
          targetType: z.enum(['kubernetes', 'aws']).describe('Target type'),
          targetName: z.string().optional().describe('Target name from app-config (optional for ECS — auto-discovered from catalog)'),
          service: z
            .enum(['ecs', 'ec2', 'lambda', 'appRunner', 'rds'])
            .optional()
            .describe('AWS service type (AWS targets only)'),
          serviceName: z
            .string()
            .optional()
            .describe('AWS service instance name — used to select a specific ECS cluster when multiple exist'),
        }),
      output: z =>
        z.object({
          ingressDomain: z.string().optional(),
          ingressClass: z.string().optional(),
          storageClass: z.string().optional(),
          argocdUrl: z.string().optional(),
          accountId: z.string().optional(),
          region: z.string().optional(),
          ecrRegistry: z.string().optional(),
          clusterName: z.string().optional(),
        }),
    },
    async handler(ctx) {
      const { targetType, targetName, service, serviceName } = ctx.input;

      // ── Kubernetes ─────────────────────────────────────────────────────────
      if (targetType === 'kubernetes') {
        const k8sTargets =
          config.getOptionalConfigArray('scaffolder.targets.kubernetes') ?? [];
        const target = k8sTargets.find(t => t.getString('name') === targetName);
        if (!target) {
          throw new Error(
            `K8s target "${targetName}" not found in scaffolder.targets.kubernetes. ` +
              `Available: ${k8sTargets.map(t => t.getString('name')).join(', ')}`,
          );
        }

        const ingressDomain =
          target.getOptionalString('ingressDomain') ??
          process.env.SCAFFOLDER_INGRESS_DOMAIN ??
          'localhost';
        const ingressClass = target.getOptionalString('ingressClass') ?? 'nginx';
        const storageClass = target.getOptionalString('storageClass') ?? 'longhorn';
        const argocdUrl = target.getOptionalString('argocdUrl') ?? '';

        ctx.logger.info(
          `K8s target [${targetName}]: ingressDomain=${ingressDomain}, ingressClass=${ingressClass}, storageClass=${storageClass}`,
        );

        ctx.output('ingressDomain', ingressDomain);
        ctx.output('ingressClass', ingressClass);
        ctx.output('storageClass', storageClass);
        ctx.output('argocdUrl', argocdUrl);
        return;
      }

      // ── AWS ────────────────────────────────────────────────────────────────
      if (targetType === 'aws') {
        const awsTargets =
          config.getOptionalConfigArray('scaffolder.targets.aws') ?? [];

        // Try to find the account in app-config
        const account = targetName
          ? awsTargets.find(t => t.getString('name') === targetName)
          : awsTargets[0]; // default to first account if not specified

        let accountId = account?.getOptionalString('accountId') ?? '';
        let region = account?.getOptionalString('region') ?? 'us-east-1';
        let ecrRegistry =
          account?.getOptionalString('ecrRegistry') ??
          (accountId ? `${accountId}.dkr.ecr.${region}.amazonaws.com` : '');

        ctx.output('accountId', accountId);
        ctx.output('region', region);
        ctx.output('ecrRegistry', ecrRegistry);

        if (!service) return;

        // ── ECS: try app-config first, fall back to catalog ────────────────
        if (service === 'ecs') {
          // Try app-config lookup
          try {
            if (account && serviceName) {
              const clusterList = account.getConfigArray('targets.ecs');
              const cluster = clusterList.find(
                c => c.getString('name') === serviceName,
              );
              if (cluster) {
                const clusterName =
                  cluster.getOptionalString('clusterName') ?? serviceName;
                ctx.logger.info(
                  `ECS [app-config ${targetName}/${serviceName}]: clusterName=${clusterName}`,
                );
                ctx.output('clusterName', clusterName);
                return;
              }
            }
          } catch {
            // no ecs array in app-config — fall through to catalog
          }

          // Catalog discovery fallback
          ctx.logger.info('ECS cluster not in app-config — discovering from catalog...');
          const catalogClient = new CatalogClient({ discoveryApi: discovery });
          const { token } = await auth.getPluginRequestToken({
            onBehalfOf: await auth.getOwnServiceCredentials(),
            targetPluginId: 'catalog',
          });

          const { items } = await catalogClient.getEntities(
            {
              filter: {
                kind: 'Resource',
                'spec.type': 'ecs-cluster',
                ...(serviceName ? { 'metadata.name': serviceName } : {}),
              },
            },
            { token },
          );

          if (items.length === 0) {
            throw new Error(
              'No ECS cluster found in app-config or catalog. ' +
                'Run the "Infrastructure — AWS ECS Fargate Cluster" template to provision one.',
            );
          }
          if (items.length > 1 && !serviceName) {
            const names = items.map(e => e.metadata.name).join(', ');
            throw new Error(
              `Multiple ECS clusters found in catalog: ${names}. ` +
                `Specify serviceName to select one.`,
            );
          }

          const clusterEntity = items[0];
          const annotations = clusterEntity.metadata.annotations ?? {};

          // Read config from entity annotations
          const catalogAccountId = annotations['aws/account-id'] ?? accountId;
          const catalogRegion = annotations['aws/region'] ?? region;
          const catalogEcrRegistry =
            annotations['aws/ecr-registry'] ??
            `${catalogAccountId}.dkr.ecr.${catalogRegion}.amazonaws.com`;
          const clusterName =
            annotations['aws/ecs-cluster-name'] ?? clusterEntity.metadata.name;

          ctx.logger.info(
            `ECS [catalog ${clusterEntity.metadata.name}]: accountId=${catalogAccountId}, region=${catalogRegion}, clusterName=${clusterName}`,
          );

          ctx.output('accountId', catalogAccountId);
          ctx.output('region', catalogRegion);
          ctx.output('ecrRegistry', catalogEcrRegistry);
          ctx.output('clusterName', clusterName);
        }
      }
    },
  });
}
