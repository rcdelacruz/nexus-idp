import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';

/**
 * scaffolder:get-target-config
 *
 * Given a target name, reads all its config values from app-config
 * (scaffolder.targets) and outputs them for use in fetch:template steps.
 *
 * No infra values are hardcoded in templates — everything comes from here.
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
 *       serviceName: backstage-idp
 */
export function createGetTargetConfigAction(options: { config: Config }) {
  const { config } = options;

  return createTemplateAction({
    id: 'scaffolder:get-target-config',
    description: 'Read full config for a deployment target from platform config',
    schema: {
      input: z =>
        z.object({
          targetType: z.enum(['kubernetes', 'aws']).describe('Target type'),
          targetName: z.string().describe('Target name from app-config'),
          service: z
            .enum(['ecs', 'ec2', 'lambda', 'appRunner', 'rds'])
            .optional()
            .describe('AWS service type (AWS targets only)'),
          serviceName: z
            .string()
            .optional()
            .describe('AWS service instance name (e.g. ECS cluster name)'),
        }),
      output: z =>
        z.object({
          // Kubernetes outputs
          ingressDomain: z.string().optional(),
          ingressClass: z.string().optional(),
          storageClass: z.string().optional(),
          argocdUrl: z.string().optional(),
          // AWS outputs
          accountId: z.string().optional(),
          region: z.string().optional(),
          ecrRegistry: z.string().optional(),
          clusterName: z.string().optional(),
        }),
    },
    async handler(ctx) {
      const { targetType, targetName, service, serviceName } = ctx.input;

      const targets =
        config.getOptionalConfigArray(`scaffolder.targets.${targetType}`) ?? [];

      const target = targets.find(t => t.getString('name') === targetName);
      if (!target) {
        throw new Error(
          `Target "${targetName}" not found in scaffolder.targets.${targetType}. ` +
            `Available: ${targets.map(t => t.getString('name')).join(', ')}`,
        );
      }

      if (targetType === 'kubernetes') {
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

      if (targetType === 'aws') {
        const accountId = target.getOptionalString('accountId') ?? '';
        const region = target.getOptionalString('region') ?? 'us-east-1';

        // ecrRegistry is account-level — shared across all services in this account
        const ecrRegistry =
          target.getOptionalString('ecrRegistry') ??
          `${accountId}.dkr.ecr.${region}.amazonaws.com`;

        ctx.output('accountId', accountId);
        ctx.output('region', region);
        ctx.output('ecrRegistry', ecrRegistry);

        if (!service) return;

        if (service === 'ecs' && serviceName) {
          let clusterName = serviceName;
          try {
            const clusterList = target.getConfigArray('targets.ecs');
            const cluster = clusterList.find(
              c => c.getString('name') === serviceName,
            );
            if (cluster) {
              clusterName =
                cluster.getOptionalString('clusterName') ?? serviceName;
            }
          } catch {
            // no ecs cluster list configured — use serviceName as clusterName
          }

          ctx.logger.info(
            `AWS ECS [${targetName}/${serviceName}]: accountId=${accountId}, region=${region}, clusterName=${clusterName}`,
          );
          ctx.output('clusterName', clusterName);
        }
      }
    },
  });
}
