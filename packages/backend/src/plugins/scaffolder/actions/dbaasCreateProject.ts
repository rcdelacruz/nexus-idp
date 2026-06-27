import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as yaml from 'js-yaml';

/**
 * dbaas:create-project
 *
 * Creates a new cloud database project for the scaffolded app using the
 * initiating user's stored DBaaS credentials. Also creates the k8s secret
 * <appName>-db-app with key "uri" so the backend deployment manifest works
 * without changes (same format as CNPG creates automatically).
 *
 * Usage in template:
 *   - id: create-db
 *     name: Create Neon Project
 *     if: ${{ parameters.dbProvider === 'neon' }}
 *     action: dbaas:create-project
 *     input:
 *       provider: neon
 *       projectName: ${{ parameters.appName }}
 *       namespace: ${{ parameters.appName }}-${{ parameters.environment }}
 */
export function createDbaasCreateProjectAction(options: {
  discovery: DiscoveryService;
  auth: AuthService;
}) {
  const { discovery, auth } = options;

  return createTemplateAction({
    id: 'dbaas:create-project',
    description: 'Create a cloud database project and inject the connection URI as a k8s secret',
    schema: {
      input: z =>
        z.object({
          provider: z.string().describe('Database provider (e.g. neon)'),
          projectName: z.string().describe('Name for the new cloud database project'),
          namespace: z.string().optional().describe('K8s namespace to create the connection secret in — omit for non-k8s deployments'),
        }),
      output: z =>
        z.object({
          projectId: z.string().describe('Created project ID'),
          connectionUri: z.string().describe('Full database connection URI'),
          host: z.string().describe('Database host'),
          database: z.string().describe('Database name'),
          user: z.string().describe('Database user'),
        }),
    },
    async handler(ctx) {
      const { provider, projectName, namespace } = ctx.input;
      const userRef = ctx.user?.ref;

      if (!userRef) {
        throw new Error('No authenticated user found in scaffolder context — cannot look up DBaaS credentials');
      }

      // ── Step 1: Create the cloud project via dbaas backend ─────────────────
      ctx.logger.info(`Creating ${provider} project "${projectName}" for ${userRef}`);

      const baseUrl = await discovery.getBaseUrl('dbaas');
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'dbaas',
      });

      const createRes = await fetch(`${baseUrl}/scaffold/create-project`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userRef, provider, projectName }),
        signal: AbortSignal.timeout(60000),
      });

      if (!createRes.ok) {
        const body = await createRes.json().catch(() => null) as any;
        const msg = body?.error?.message ?? body?.error ?? createRes.statusText;
        throw new Error(`DBaaS project creation failed: ${msg}`);
      }

      const { project } = await createRes.json() as { project: {
        id: string; name: string; connectionUri: string;
        host: string; database: string; user: string; password: string;
      }};

      ctx.logger.info(`${provider} project created: ${project.id} (host: ${project.host})`);

      // ── Step 2: Create k8s secret <appName>-db-app with key "uri" ──────────
      // Only for k8s deployments — namespace is omitted for ECS/App Runner/etc.
      // Same secret name + key that CNPG creates automatically, so deployment.yaml
      // works without modification regardless of which DB provider is used.
      if (namespace) {
        const secretName = `${projectName}-db-app`;
        ctx.logger.info(`Creating k8s secret ${secretName} in namespace ${namespace}`);

        const clusterCfg = await getClusterConfig();

        const secretManifest = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: secretName, namespace },
          type: 'Opaque',
          stringData: { uri: project.connectionUri },
        };

        const url = `${clusterCfg.server}/api/v1/namespaces/${namespace}/secrets/${secretName}?fieldManager=backstage-scaffolder&force=true`;
        try {
          await k8sRequest(url, 'PATCH', secretManifest, clusterCfg);
        } catch (err: any) {
          if (err.statusCode === 404) {
            await k8sRequest(
              `${clusterCfg.server}/api/v1/namespaces/${namespace}/secrets`,
              'POST',
              secretManifest,
              clusterCfg,
            );
          } else {
            throw err;
          }
        }

        ctx.logger.info(`Secret ${secretName} created in namespace ${namespace}`);
      } else {
        ctx.logger.info('Skipping k8s secret — no namespace provided (non-k8s deployment)');
      }

      ctx.output('projectId', project.id);
      ctx.output('connectionUri', project.connectionUri);
      ctx.output('host', project.host);
      ctx.output('database', project.database);
      ctx.output('user', project.user);
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

async function fileExists(p: string): Promise<boolean> {
  return fs.promises.access(p).then(() => true, () => false);
}

async function getClusterConfig(): Promise<ClusterConfig> {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  if (await fileExists(tokenPath)) {
    return {
      server: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
      token: (await fs.promises.readFile(tokenPath, 'utf-8')).trim(),
      ca: (await fileExists(caPath)) ? await fs.promises.readFile(caPath, 'utf-8') : undefined,
    };
  }

  const home = process.env.HOME ?? '/root';
  const candidates = [
    process.env.KUBECONFIG,
    path.join(home, '.kube', 'config-talos'),
    path.join(home, '.kube', 'config'),
  ].filter(Boolean) as string[];

  let kubeconfigPath: string | undefined;
  for (const p of candidates) {
    if (await fileExists(p)) { kubeconfigPath = p; break; }
  }
  if (!kubeconfigPath) throw new Error('No kubeconfig found');

  const kubeconfig = yaml.load(await fs.promises.readFile(kubeconfigPath, 'utf-8')) as any;
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
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    let bodyStr = '';
    if (body !== undefined) {
      headers['Content-Type'] = method === 'PATCH' ? 'application/apply-patch+yaml' : 'application/json';
      bodyStr = method === 'PATCH' ? yaml.dump(body) : JSON.stringify(body);
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      rejectUnauthorized: true,
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
        else {
          const err: any = new Error(`K8s ${method} ${sc}: ${data.substring(0, 200)}`);
          err.statusCode = sc;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('K8s API request timed out after 30s')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
