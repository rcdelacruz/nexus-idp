/**
 * Scaffolder Targets API
 *
 * Exposes GET /api/scaffolder-targets/targets?framework=<framework>
 * Returns deployment targets from two sources, merged:
 *   1. app-config.yaml (scaffolder.targets.*) — static targets (k8s, ec2, lambda, app-runner)
 *   2. Backstage catalog — Resource entities with spec.type: ecs-cluster (auto-discovered)
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

            // ECS: discover from Backstage catalog (Resource entities spec.type: ecs-cluster)
            // app-config ecs[] is intentionally empty — clusters self-register via infra template
            try {
              const catalogClient = new CatalogClient({ discoveryApi: discovery });
              const { token } = await auth.getPluginRequestToken({
                onBehalfOf: await auth.getOwnServiceCredentials(),
                targetPluginId: 'catalog',
              });
              const { items: ecsClusters } = await catalogClient.getEntities(
                {
                  filter: {
                    kind: 'Resource',
                    'spec.type': 'ecs-cluster',
                  },
                  fields: ['metadata.name', 'metadata.title', 'metadata.annotations'],
                },
                { token },
              );

              for (const cluster of ecsClusters) {
                const annotations = cluster.metadata.annotations ?? {};
                const supportedRaw = annotations['scaffolder/supported-frameworks'];
                const supported = supportedRaw?.split(',').map(s => s.trim());
                if (framework && supported && !supported.includes(framework)) continue;

                const clusterLabel =
                  cluster.metadata.title ?? cluster.metadata.name;
                targets.push({
                  value: 'ecs',
                  label: `${clusterLabel} — ${accountLabel}`,
                });
              }
            } catch (err: any) {
              logger.warn(`scaffolder-targets: catalog ECS discovery failed: ${err.message}`);
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
