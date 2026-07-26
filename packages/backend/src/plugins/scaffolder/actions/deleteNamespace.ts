import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { getClusterConfig, buildApiPath, k8sRequest, ClusterConfig } from '../lib/k8sClient';

const CNPG_API_VERSION = 'postgresql.cnpg.io/v1';
const ARGOCD_API_VERSION = 'argoproj.io/v1alpha1';

/**
 * Scaffolder action: kubernetes:delete-namespace
 *
 * Deletes namespaces and waits for each to fully terminate. Cascades pods,
 * services, deployments, CNPG clusters, and PVCs automatically. If termination
 * hangs past 60s (Longhorn PVC finalizer deadlock is the common cause — see
 * scripts/teardown.sh EC-4), force-patches finalizers on PVCs, CNPG clusters,
 * and any remaining ArgoCD Application CRs in the namespace, then waits again.
 * Idempotent — a missing namespace is a warning, not a failure. Takes a list
 * since template.yaml has no per-step loop construct.
 */
export function createDeleteNamespaceAction() {
  return createTemplateAction({
    id: 'kubernetes:delete-namespace',
    description: 'Delete Kubernetes namespaces and wait for them to terminate, recovering from stuck finalizers',
    schema: {
      input: z =>
        z.object({
          namespaces: z.array(z.string()),
          timeoutSeconds: z.number().default(120).describe('Total time to wait per namespace before giving up'),
        }),
      output: z =>
        z.object({
          deleted: z.array(z.string()),
        }),
    },
    async handler(ctx) {
      const { namespaces } = ctx.input;
      // zod's schema-level .default() is a type/UI contract only — Backstage
      // does not apply it to ctx.input for unpassed fields at runtime (same
      // bug confirmed live in deleteArgocdApp.ts).
      const timeoutSeconds = ctx.input.timeoutSeconds ?? 120;
      const config = await getClusterConfig();
      const deleted: string[] = [];

      for (const namespace of namespaces) {
        // eslint-disable-next-line no-await-in-loop
        await teardownNamespace(config, namespace, timeoutSeconds, ctx.logger);
        deleted.push(namespace);
      }

      ctx.output('deleted', deleted);
    },
  });
}

async function teardownNamespace(
  config: ClusterConfig,
  namespace: string,
  timeoutSeconds: number,
  logger: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const nsUrl = `${config.server}${buildApiPath('v1', 'Namespace', undefined, namespace)}`;

  logger.info(`Deleting namespace ${namespace}...`);
  try {
    await k8sRequest(nsUrl, 'DELETE', undefined, config);
  } catch (err: any) {
    if (err.statusCode === 404) {
      logger.warn(`Namespace ${namespace} not found — already deleted`);
      return;
    }
    throw new Error(`Failed to delete namespace ${namespace}: ${err.message}`);
  }

  const namespaceGone = async (): Promise<boolean> => {
    try {
      await k8sRequest(nsUrl, 'GET', undefined, config);
      return false;
    } catch (err: any) {
      if (err.statusCode === 404) return true;
      throw err;
    }
  };

  const firstPhaseDeadline = Date.now() + 60_000;
  while (Date.now() < firstPhaseDeadline) {
    if (await namespaceGone()) {
      logger.info(`Namespace ${namespace} deleted`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  logger.warn(`Namespace ${namespace} still terminating after 60s — patching stuck finalizers...`);
  await clearFinalizers(config, 'v1', 'PersistentVolumeClaim', namespace, logger);
  await clearFinalizers(config, CNPG_API_VERSION, 'Cluster', namespace, logger);
  await clearFinalizers(config, ARGOCD_API_VERSION, 'Application', namespace, logger);

  const remainingSeconds = Math.max(timeoutSeconds - 60, 30);
  const secondPhaseDeadline = Date.now() + remainingSeconds * 1000;
  while (Date.now() < secondPhaseDeadline) {
    if (await namespaceGone()) {
      logger.info(`Namespace ${namespace} deleted`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error(
    `Namespace ${namespace} still present after finalizer patch — manual cleanup needed: ` +
    `kubectl delete namespace ${namespace} --force --grace-period=0`,
  );
}

/** List resources of a kind in a namespace and patch their finalizers to []. */
async function clearFinalizers(
  config: ClusterConfig,
  apiVersion: string,
  kind: string,
  namespace: string,
  logger: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const listUrl = `${config.server}${buildApiPath(apiVersion, kind, namespace)}`;
  let items: Array<{ metadata: { name: string } }> = [];
  try {
    const list = await k8sRequest(listUrl, 'GET', undefined, config);
    items = list.items ?? [];
  } catch {
    return;
  }

  for (const item of items) {
    const name = item.metadata.name;
    const itemUrl = `${config.server}${buildApiPath(apiVersion, kind, namespace, name)}`;
    logger.info(`  Patching ${kind} finalizer: ${namespace}/${name}`);
    try {
      await k8sRequest(itemUrl, 'PATCH', { metadata: { finalizers: [] } }, config);
    } catch (err: any) {
      logger.warn(`  Could not patch finalizer on ${kind} ${namespace}/${name}: ${err.message}`);
    }
  }
}
