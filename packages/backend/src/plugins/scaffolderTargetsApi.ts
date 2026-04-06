/**
 * Scaffolder Targets API
 *
 * Exposes GET /api/scaffolder-targets/targets?framework=<framework>
 * Returns deployment targets from app-config, filtered by supported framework.
 *
 * Used by the DeploymentTargetPicker custom field extension in the frontend.
 */
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';

export const scaffolderTargetsPlugin = createBackendPlugin({
  pluginId: 'scaffolder-targets',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ config, httpRouter, logger }) {
        // /targets is intentionally authenticated-only — the DeploymentTargetPicker
        // frontend component calls this via fetchApi which attaches the user's Backstage
        // token automatically. No unauthenticated access is needed.
        // (Default new-backend-system behaviour: routes without addAuthPolicy require auth.)
        const router = Router();

        router.get('/targets', (req, res) => {
          const framework = req.query.framework as string | undefined;
          const targets: Array<{ value: string; label: string }> = [];

          // ── Kubernetes targets ─────────────────────────────────────────────
          const k8sTargets =
            config.getOptionalConfigArray('scaffolder.targets.kubernetes') ?? [];
          for (const t of k8sTargets) {
            const supportedFrameworks =
              t.getOptionalStringArray('supportedFrameworks');
            if (
              framework &&
              supportedFrameworks &&
              !supportedFrameworks.includes(framework)
            ) {
              continue;
            }
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

            // ECS clusters
            const ecsClusters =
              awsTargets.getOptionalConfigArray('ecs') ?? [];
            for (const cluster of ecsClusters) {
              const supported =
                cluster.getOptionalStringArray('supportedFrameworks');
              if (framework && supported && !supported.includes(framework))
                continue;
              const clusterDisplay = cluster.getOptionalString('displayName') ?? 'unknown';
              targets.push({
                value: cluster.getOptionalString('name') ?? `ecs-${clusterDisplay.toLowerCase().replace(/\s+/g, '-')}`,
                label: `${clusterDisplay} — ${accountLabel}`,
              });
            }

            // EC2
            const ec2 = awsTargets.getOptionalConfig('ec2');
            if (ec2?.getOptionalBoolean('enabled')) {
              const supported = ec2.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({
                  value: 'ec2',
                  label: `AWS EC2 — ${accountLabel}`,
                });
              }
            }

            // Lambda
            const lambda = awsTargets.getOptionalConfig('lambda');
            if (lambda?.getOptionalBoolean('enabled')) {
              const supported =
                lambda.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({
                  value: 'lambda',
                  label: `AWS Lambda — ${accountLabel}`,
                });
              }
            }

            // App Runner
            const appRunner = awsTargets.getOptionalConfig('appRunner');
            if (appRunner?.getOptionalBoolean('enabled')) {
              const supported =
                appRunner.getOptionalStringArray('supportedFrameworks');
              if (!framework || !supported || supported.includes(framework)) {
                targets.push({
                  value: 'app-runner',
                  label: `AWS App Runner — ${accountLabel}`,
                });
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
