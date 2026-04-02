import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as yaml from 'js-yaml';

/**
 * Scaffolder action: kubernetes:create-pull-secret
 *
 * Creates a Docker registry pull secret in a K8s namespace.
 * Uses the GitHub token from the environment to authenticate with GHCR.
 */
export function createPullSecretAction() {
  return createTemplateAction({
    id: 'kubernetes:create-pull-secret',
    description: 'Create a Docker registry pull secret in a K8s namespace',
    schema: {
      input: z => z.object({
        namespace: z.string().describe('K8s namespace to create the secret in'),
        secretName: z.string().default('ghcr-pull-secret').describe('Name of the pull secret'),
        registry: z.string().default('ghcr.io').describe('Docker registry URL'),
      }),
    },
    async handler(ctx) {
      const namespace = ctx.input.namespace;
      const secretName = ctx.input.secretName ?? 'ghcr-pull-secret';
      const registry = ctx.input.registry ?? 'ghcr.io';
      const token = process.env.GITHUB_TOKEN ?? '';

      if (!token) {
        ctx.logger.warn('GITHUB_TOKEN not set — skipping pull secret creation');
        return;
      }

      ctx.logger.info(`Creating pull secret ${secretName} in namespace ${namespace}`);

      const config = await getClusterConfig();

      // Create namespace first (idempotent)
      const nsManifest = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } };
      try {
        await k8sRequest(`${config.server}/api/v1/namespaces/${namespace}?fieldManager=backstage-scaffolder&force=true`, 'PATCH', nsManifest, config);
      } catch { /* namespace might already exist */ }

      // Create docker-registry secret
      const auth = Buffer.from(`stratpoint-engineering:${token}`).toString('base64');
      const dockerConfigJson = JSON.stringify({
        auths: { [registry]: { auth } },
      });

      const secretManifest = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: secretName, namespace },
        type: 'kubernetes.io/dockerconfigjson',
        data: { '.dockerconfigjson': Buffer.from(dockerConfigJson).toString('base64') },
      };

      const url = `${config.server}/api/v1/namespaces/${namespace}/secrets/${secretName}?fieldManager=backstage-scaffolder&force=true`;
      try {
        await k8sRequest(url, 'PATCH', secretManifest, config);
        ctx.logger.info(`Pull secret ${secretName} created`);
      } catch (err: any) {
        if (err.statusCode === 404) {
          await k8sRequest(`${config.server}/api/v1/namespaces/${namespace}/secrets`, 'POST', secretManifest, config);
          ctx.logger.info(`Pull secret ${secretName} created`);
        } else {
          throw err;
        }
      }
    },
  });
}

// Reuse cluster config resolution from kubernetesApply
interface ClusterConfig {
  server: string;
  token?: string;
  ca?: string;
  clientCert?: string;
  clientKey?: string;
}

async function getClusterConfig(): Promise<ClusterConfig> {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  if (fs.existsSync(tokenPath)) {
    return {
      server: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
      token: fs.readFileSync(tokenPath, 'utf-8').trim(),
      ca: fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf-8') : undefined,
    };
  }

  const home = process.env.HOME ?? '/root';
  const candidates = [
    process.env.KUBECONFIG,
    path.join(home, '.kube', 'config-talos'),
    path.join(home, '.kube', 'config'),
  ].filter(Boolean) as string[];
  const kubeconfigPath = candidates.find(p => fs.existsSync(p)) ?? candidates[candidates.length - 1];

  if (!fs.existsSync(kubeconfigPath)) {
    throw new Error(`No kubeconfig found`);
  }

  const kubeconfig = yaml.load(fs.readFileSync(kubeconfigPath, 'utf-8')) as any;
  const ctxName = kubeconfig['current-context'];
  const context = kubeconfig.contexts?.find((c: any) => c.name === ctxName)?.context;
  const cluster = kubeconfig.clusters?.find((c: any) => c.name === context?.cluster)?.cluster;
  const user = kubeconfig.users?.find((u: any) => u.name === context?.user)?.user;

  const cfg: ClusterConfig = { server: cluster.server };
  if (cluster['certificate-authority-data']) cfg.ca = Buffer.from(cluster['certificate-authority-data'], 'base64').toString();
  if (user?.token) cfg.token = user.token;
  if (user?.['client-certificate-data']) cfg.clientCert = Buffer.from(user['client-certificate-data'], 'base64').toString();
  if (user?.['client-key-data']) cfg.clientKey = Buffer.from(user['client-key-data'], 'base64').toString();
  return cfg;
}

function k8sRequest(url: string, method: string, body: any, config: ClusterConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers: Record<string, string> = {
      'Content-Type': method === 'PATCH' ? 'application/apply-patch+yaml' : 'application/json',
      Accept: 'application/json',
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const bodyStr = method === 'PATCH' ? yaml.dump(body) : JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search, method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      rejectUnauthorized: !!config.ca,
      timeout: 30000,
      ...(config.ca ? { ca: config.ca } : {}),
      ...(config.clientCert ? { cert: config.clientCert } : {}),
      ...(config.clientKey ? { key: config.clientKey } : {}),
    };
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const sc = res.statusCode ?? 0;
        if (sc >= 200 && sc < 300) resolve(JSON.parse(data || '{}'));
        else { const err: any = new Error(`K8s ${method} ${sc}: ${data.substring(0, 200)}`); err.statusCode = sc; reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`K8s API request timed out after 30s`)); });
    req.write(bodyStr);
    req.end();
  });
}
