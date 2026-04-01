import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as https from 'https';
import * as http from 'http';

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

      for (const doc of docs) {
        const apiVersion = doc.apiVersion;
        const kind = doc.kind;
        const metadata = doc.metadata;
        const namespace = metadata?.namespace;
        const name = metadata?.name;

        ctx.logger.info(`Applying ${kind} ${namespace ? namespace + '/' : ''}${name}`);

        const apiPath = buildApiPath(apiVersion, kind, namespace, name);
        const url = `${config.server}${apiPath}?fieldManager=backstage-scaffolder&force=true`;

        // Try server-side apply (PATCH), fall back to POST (create)
        try {
          await k8sRequest(url, 'PATCH', doc, config);
          ctx.logger.info(`  ${kind}/${name} configured`);
        } catch (patchErr: any) {
          if (patchErr.statusCode === 404) {
            const createPath = buildApiPath(apiVersion, kind, namespace);
            const createUrl = `${config.server}${createPath}`;
            await k8sRequest(createUrl, 'POST', doc, config);
            ctx.logger.info(`  ${kind}/${name} created`);
          } else {
            throw patchErr;
          }
        }
      }

      ctx.logger.info('All manifests applied successfully');
    },
  });
}

interface ClusterConfig {
  server: string;
  token?: string;
  ca?: string;
  clientCert?: string;
  clientKey?: string;
}

/** Resolve cluster connection — in-cluster SA or kubeconfig file */
async function getClusterConfig(): Promise<ClusterConfig> {
  // In-cluster: SA token mounted by K8s
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  if (fs.existsSync(tokenPath)) {
    return {
      server: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
      token: fs.readFileSync(tokenPath, 'utf-8').trim(),
      ca: fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf-8') : undefined,
    };
  }

  // Local: parse kubeconfig — check KUBECONFIG env, then common paths
  const home = process.env.HOME ?? '/root';
  const candidates = [
    process.env.KUBECONFIG,
    path.join(home, '.kube', 'config-talos'),
    path.join(home, '.kube', 'config'),
  ].filter(Boolean) as string[];
  const kubeconfigPath = candidates.find(p => fs.existsSync(p)) ?? candidates[candidates.length - 1];

  if (!fs.existsSync(kubeconfigPath)) {
    throw new Error(`No in-cluster SA and no kubeconfig found at ${kubeconfigPath}`);
  }

  const kubeconfig = yaml.load(fs.readFileSync(kubeconfigPath, 'utf-8')) as any;
  const contextName = kubeconfig['current-context'];
  const context = kubeconfig.contexts?.find((c: any) => c.name === contextName)?.context;
  const cluster = kubeconfig.clusters?.find((c: any) => c.name === context?.cluster)?.cluster;
  const user = kubeconfig.users?.find((u: any) => u.name === context?.user)?.user;

  if (!cluster?.server) throw new Error('Could not parse cluster server from kubeconfig');

  const config: ClusterConfig = { server: cluster.server };

  // CA cert
  if (cluster['certificate-authority-data']) {
    config.ca = Buffer.from(cluster['certificate-authority-data'], 'base64').toString();
  }

  // Token auth
  if (user?.token) {
    config.token = user.token;
  } else if (user?.['token-file']) {
    config.token = fs.readFileSync(user['token-file'], 'utf-8').trim();
  }

  // Client certificate auth (Talos, mTLS)
  if (user?.['client-certificate-data']) {
    config.clientCert = Buffer.from(user['client-certificate-data'], 'base64').toString();
  }
  if (user?.['client-key-data']) {
    config.clientKey = Buffer.from(user['client-key-data'], 'base64').toString();
  }

  return config;
}

/** Build K8s API path from apiVersion + kind */
function buildApiPath(apiVersion: string, kind: string, namespace?: string, name?: string): string {
  const isCore = !apiVersion.includes('/');
  const base = isCore ? `/api/${apiVersion}` : `/apis/${apiVersion}`;
  const resource = kindToResource(kind);

  let apiPath = namespace ? `${base}/namespaces/${namespace}/${resource}` : `${base}/${resource}`;
  if (name) apiPath += `/${name}`;
  return apiPath;
}

/** Map Kind to plural resource name */
function kindToResource(kind: string): string {
  const map: Record<string, string> = {
    Namespace: 'namespaces',
    Deployment: 'deployments',
    Service: 'services',
    Ingress: 'ingresses',
    ConfigMap: 'configmaps',
    Secret: 'secrets',
    Application: 'applications',
    Cluster: 'clusters',
    Pooler: 'poolers',
  };
  return map[kind] ?? kind.toLowerCase() + 's';
}

/** Make HTTPS request to K8s API */
function k8sRequest(url: string, method: string, body: any, config: ClusterConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': method === 'PATCH'
        ? 'application/apply-patch+yaml'
        : 'application/json',
      Accept: 'application/json',
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const bodyStr = method === 'PATCH' ? yaml.dump(body) : JSON.stringify(body);

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      rejectUnauthorized: !!config.ca,
      ...(config.ca ? { ca: config.ca } : {}),
      ...(config.clientCert ? { cert: config.clientCert } : {}),
      ...(config.clientKey ? { key: config.clientKey } : {}),
    };

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          const err: any = new Error(`K8s API ${method} ${url} returned ${statusCode}: ${data}`);
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
