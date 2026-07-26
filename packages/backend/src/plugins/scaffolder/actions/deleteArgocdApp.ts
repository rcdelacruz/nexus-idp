import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { getClusterConfig, buildApiPath, k8sRequest } from '../lib/k8sClient';

const ARGOCD_API_VERSION = 'argoproj.io/v1alpha1';

/**
 * Scaffolder action: argocd:delete-app
 *
 * Suspends auto-sync (so ArgoCD doesn't recreate resources mid-teardown), then
 * deletes each Application CR and waits for its resources-finalizer to
 * cascade. Idempotent — a missing Application is a warning, not a failure,
 * matching scripts/teardown.sh's "already deleted" handling. Takes a list
 * (like kubernetes:apply loops over manifest docs) since template.yaml has
 * no per-step loop construct to iterate teardown:discover-resources' output.
 */
export function createDeleteArgocdAppAction() {
  return createTemplateAction({
    id: 'argocd:delete-app',
    description: 'Suspend auto-sync and delete ArgoCD Applications, cascading their synced Kubernetes resources',
    schema: {
      input: z =>
        z.object({
          apps: z.array(z.object({ namespace: z.string(), name: z.string() })),
          timeoutSeconds: z.number().default(120).describe('How long to wait for each Application CR to disappear'),
        }),
      output: z =>
        z.object({
          deleted: z.array(z.object({ namespace: z.string(), name: z.string() })),
          stillPresent: z.array(z.object({ namespace: z.string(), name: z.string() }))
            .describe('Applications whose resources-finalizer had not cleared by the timeout — usually blocked by finalizers inside the namespace itself (CNPG/PVC), which kubernetes:delete-namespace clears. Not fatal here; a second argocd:delete-app pass after delete-namespaces resolves these.'),
        }),
    },
    async handler(ctx) {
      const { apps } = ctx.input;
      // zod's schema-level .default() is a type/UI contract only — Backstage
      // does not apply it to ctx.input for unpassed fields at runtime.
      // Confirmed live: an omitted timeoutSeconds arrived as undefined,
      // making the deadline math NaN and skipping the poll loop entirely,
      // reporting failure even though the delete had actually succeeded.
      const timeoutSeconds = ctx.input.timeoutSeconds ?? 120;
      const config = await getClusterConfig();
      const deleted: Array<{ namespace: string; name: string }> = [];
      const stillPresent: Array<{ namespace: string; name: string }> = [];

      for (const { namespace: appNamespace, name: appName } of apps) {
        const apiPath = buildApiPath(ARGOCD_API_VERSION, 'Application', appNamespace, appName);
        const url = `${config.server}${apiPath}`;

        ctx.logger.info(`Suspending auto-sync for ${appNamespace}/${appName}...`);
        try {
          await k8sRequest(url, 'PATCH', { spec: { syncPolicy: { automated: null } } }, config);
        } catch (err: any) {
          if (err.statusCode === 404) {
            ctx.logger.warn(`ArgoCD Application ${appNamespace}/${appName} not found — already deleted`);
            deleted.push({ namespace: appNamespace, name: appName });
            continue;
          }
          ctx.logger.warn(`Could not suspend auto-sync for ${appNamespace}/${appName}: ${err.message}`);
        }

        ctx.logger.info(`Deleting ArgoCD Application ${appNamespace}/${appName}...`);
        try {
          await k8sRequest(url, 'DELETE', undefined, config);
        } catch (err: any) {
          if (err.statusCode === 404) {
            ctx.logger.warn(`ArgoCD Application ${appNamespace}/${appName} not found — already deleted`);
            deleted.push({ namespace: appNamespace, name: appName });
            continue;
          }
          throw new Error(`Failed to delete ArgoCD Application ${appNamespace}/${appName}: ${err.message}`);
        }

        const isGone = async (): Promise<boolean> => {
          try {
            await k8sRequest(url, 'GET', undefined, config);
            return false;
          } catch (err: any) {
            if (err.statusCode === 404) return true;
            throw err;
          }
        };

        const deadline = Date.now() + timeoutSeconds * 1000;
        let gone = false;
        while (Date.now() < deadline) {
          if (await isGone()) { gone = true; break; }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // A stuck resources-finalizer here is normal, not exceptional: the
        // Application's finalizer only clears once ArgoCD confirms every
        // synced resource is gone, including a namespace it created via
        // CreateNamespace=true. That namespace can itself be blocked by its
        // own CNPG/PVC finalizers — a dependency chain kubernetes:delete-namespace
        // resolves (it force-patches those). Force-patching the Application's
        // own finalizer here does not fix that chain (confirmed live: it still
        // times out, because the real blocker is inside the namespace). So we
        // don't throw — we record it and let delete-namespaces run, then a
        // second argocd:delete-app pass verifies it actually cleared.
        if (!gone) {
          ctx.logger.warn(
            `ArgoCD Application ${appNamespace}/${appName} still present after ${timeoutSeconds}s — ` +
            `likely blocked by finalizers inside its namespace. Continuing; ` +
            `kubernetes:delete-namespace and a second argocd:delete-app pass should resolve it.`,
          );
          stillPresent.push({ namespace: appNamespace, name: appName });
          continue;
        }
        ctx.logger.info(`ArgoCD Application ${appNamespace}/${appName} deleted`);
        deleted.push({ namespace: appNamespace, name: appName });
      }

      ctx.output('deleted', deleted);
      ctx.output('stillPresent', stillPresent);
    },
  });
}
