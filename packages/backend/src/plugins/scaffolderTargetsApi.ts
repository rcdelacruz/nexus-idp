/**
 * Scaffolder Targets API
 *
 * Exposes GET /api/scaffolder-targets/targets?framework=<framework>
 * Returns deployment targets from two sources, merged:
 *   1. app-config (scaffolder.targets.*) — static targets (on-prem k8s, ec2, lambda, app-runner)
 *      On-prem k8s targets (Talos homelab) live in app-config.on-prem.yaml — loaded by homelab only.
 *   2. Backstage catalog — Resource entities auto-discovered when provisioned via scaffolder templates:
 *      spec.type: ecs-cluster → value: 'ecs'
 *      spec.type: eks-cluster → value: 'eks'
 *
 * Used by the DeploymentTargetPicker custom field extension in the frontend.
 */
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { Router } from 'express';

export const scaffolderTargetsPlugin = createBackendPlugin({
  pluginId: 'scaffolder-targets',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ config, httpRouter, logger, discovery, auth }) {
        const router = Router();

        router.get('/targets', async (req, res) => {
          const framework = req.query.framework as string | undefined;
          const targets: Array<{ value: string; label: string }> = [];

          // ── Kubernetes targets (app-config) ────────────────────────────────
          const k8sTargets =
            config.getOptionalConfigArray('scaffolder.targets.kubernetes') ?? [];
          for (const t of k8sTargets) {
            const supportedFrameworks =
              t.getOptionalStringArray('supportedFrameworks');
            if (framework && supportedFrameworks && !supportedFrameworks.includes(framework)) continue;
            targets.push({
              value: t.getOptionalString('type') ?? 'k8s-selfhosted',
              label: t.getString('displayName'),
            });
          }

          // ── AWS targets ────────────────────────────────────────────────────
          const awsAccounts =
            config.getOptionalConfigArray('scaffolder.targets.aws') ?? [];

          for (const account of awsAccounts) {
            const accountLabel = account.getString('displayName');
            const awsTargets = account.getOptionalConfig('targets');
            if (!awsTargets) continue;

            // ECS + EKS: discover from Backstage catalog, scoped to this AWS account
            // Clusters self-register as Resource entities via infra scaffolder templates
            const accountId = account.getOptionalString('accountId');
            try {
              const catalogClient = new CatalogClient({ discoveryApi: discovery });
              const { token } = await auth.getPluginRequestToken({
                onBehalfOf: await auth.getOwnServiceCredentials(),
                targetPluginId: 'catalog',
              });

              const { items: awsClusters } = await catalogClient.getEntities(
                {
                  filter: [
                    { kind: 'Resource', 'spec.type': 'ecs-cluster', ...(accountId ? { 'metadata.annotations.aws/account-id': accountId } : {}) },
                    { kind: 'Resource', 'spec.type': 'eks-cluster', ...(accountId ? { 'metadata.annotations.aws/account-id': accountId } : {}) },
                  ],
                  fields: ['metadata.name', 'metadata.title', 'metadata.annotations', 'spec'],
                },
                { token },
              );

              for (const cluster of awsClusters) {
                const annotations = cluster.metadata.annotations ?? {};
                const supportedRaw = annotations['scaffolder/supported-frameworks'];
                const supported = supportedRaw?.split(',').map(s => s.trim());
                if (framework && supported && !supported.includes(framework)) continue;

                const clusterLabel = cluster.metadata.title ?? cluster.metadata.name;
                const clusterType = (cluster.spec as any)?.type === 'eks-cluster' ? 'eks' : 'ecs';
                targets.push({
                  value: clusterType,
                  label: `${clusterLabel} — ${accountLabel}`,
                });
              }
            } catch (err: any) {
              logger.warn(`scaffolder-targets: catalog cluster discovery failed: ${err.message}`);
            }

            // EC2
            const ec2 = awsTargets.getOptionalConfig('ec2');
            if (ec2?.getOptionalBoolean('enabled')) {
              const supported = ec2.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({ value: 'ec2', label: `AWS EC2 — ${accountLabel}` });
              }
            }

            // Lambda
            const lambda = awsTargets.getOptionalConfig('lambda');
            if (lambda?.getOptionalBoolean('enabled')) {
              const supported = lambda.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({ value: 'lambda', label: `AWS Lambda — ${accountLabel}` });
              }
            }

            // App Runner
            const appRunner = awsTargets.getOptionalConfig('appRunner');
            if (appRunner?.getOptionalBoolean('enabled')) {
              const supported = appRunner.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({ value: 'app-runner', label: `AWS App Runner — ${accountLabel}` });
              }
            }
          }

          logger.debug(
            `scaffolder-targets: ${targets.length} targets (framework: ${framework ?? 'any'})`,
          );
          res.json({ targets });
        });

        httpRouter.use(router as any);
        logger.info('Scaffolder targets API initialized');
      },
    });
  },
});

export default scaffolderTargetsPlugin;
