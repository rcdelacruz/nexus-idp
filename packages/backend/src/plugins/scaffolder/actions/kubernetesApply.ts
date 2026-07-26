import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getClusterConfig, buildApiPath, k8sRequest, k8sApplyPatch } from '../lib/k8sClient';

/**
 * Scaffolder action: kubernetes:apply
 *
 * Applies a Kubernetes manifest from the scaffolded workspace to the cluster
 * using the Kubernetes API directly. Works in all environments:
 * - Local: reads kubeconfig from KUBECONFIG env or ~/.kube/config
 * - In-cluster (ECS/K8s): uses service account token
 */
export function createKubernetesApplyAction() {
  return createTemplateAction({
    id: 'kubernetes:apply',
    description: 'Apply a Kubernetes manifest to the cluster via K8s API',
    schema: {
      input: z => z.object({
        manifestPath: z.string().describe('Path to the YAML manifest relative to the workspace root'),
      }),
    },
    async handler(ctx) {
      const manifestPath = path.resolve(ctx.workspacePath, ctx.input.manifestPath);

      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not found: ${ctx.input.manifestPath}`);
      }

      const content = fs.readFileSync(manifestPath, 'utf-8');
      const docs = yaml.loadAll(content).filter(Boolean) as Record<string, any>[];

      const config = await getClusterConfig();

      const errors: Array<{ resource: string; message: string }> = [];

      for (const doc of docs) {
        const apiVersion = doc.apiVersion;
        const kind = doc.kind;
        const metadata = doc.metadata;
        const namespace = metadata?.namespace;
        const name = metadata?.name;
        const resource = `${kind}/${name}`;

        ctx.logger.info(`Applying ${kind} ${namespace ? `${namespace}/` : ''}${name}`);

        const apiPath = buildApiPath(apiVersion, kind, namespace, name);
        const url = `${config.server}${apiPath}?fieldManager=backstage-scaffolder&force=true`;

        // Try server-side apply (PATCH), fall back to POST (create)
        try {
          await k8sApplyPatch(url, doc, config);
          ctx.logger.info(`  ${resource} configured`);
        } catch (patchErr: any) {
          if (patchErr.statusCode === 404) {
            try {
              const createPath = buildApiPath(apiVersion, kind, namespace);
              const createUrl = `${config.server}${createPath}`;
              await k8sRequest(createUrl, 'POST', doc, config);
              ctx.logger.info(`  ${resource} created`);
            } catch (postErr: any) {
              ctx.logger.error(`  ${resource} failed: ${postErr.message}`);
              errors.push({ resource, message: postErr.message });
            }
          } else {
            ctx.logger.error(`  ${resource} failed: ${patchErr.message}`);
            errors.push({ resource, message: patchErr.message });
          }
        }
      }

      if (errors.length > 0) {
        const summary = errors.map(e => `${e.resource}: ${e.message}`).join('; ');
        throw new Error(`${errors.length} manifest(s) failed to apply: ${summary}`);
      }

      ctx.logger.info('All manifests applied successfully');
    },
  });
}

