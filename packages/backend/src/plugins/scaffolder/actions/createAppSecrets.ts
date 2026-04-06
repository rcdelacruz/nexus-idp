import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';

/**
 * Scaffolder action: kubernetes:create-app-secrets
 *
 * Creates the <appName>-secrets Kubernetes secret during template execution.
 * Generates a random AUTH_SECRET and sets empty placeholders for OAuth credentials.
 * OAuth credentials must be updated manually after the app is deployed.
 */
export function createAppSecretsAction() {
  return createTemplateAction({
    id: 'kubernetes:create-app-secrets',
    description: 'Create app secrets (auth-secret, OAuth placeholders) in a K8s namespace',
    schema: {
      input: z => z.object({
        namespace: z.string().describe('K8s namespace to create the secret in'),
        appName: z.string().describe('App name — secret will be named <appName>-secrets'),
      }),
    },
    async handler(ctx) {
      const { namespace, appName } = ctx.input;
      const secretName = `${appName}-secrets`;

      ctx.logger.info(`Creating app secrets ${secretName} in namespace ${namespace}`);

      const config = await getClusterConfig();

      // Auto-generate a secure AUTH_SECRET as a hex string.
      // Using hex (not base64) ensures the injected env var is always valid UTF-8.
      // Stored in stringData so Kubernetes handles the base64 encoding internally.
      const authSecret = crypto.randomBytes(32).toString('hex');

      const secretManifest = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: secretName, namespace },
        type: 'Opaque',
        stringData: {
          'auth-secret': authSecret,
          'auth-github-id': '',
          'auth-github-secret': '',
          'auth-google-id': '',
          'auth-google-secret': '',
        },
      };

      const url = `${config.server}/api/v1/namespaces/${namespace}/secrets/${secretName}?fieldManager=backstage-scaffolder&force=true`;
      try {
        await k8sRequest(url, 'PATCH', secretManifest, config);
        ctx.logger.info(`App secrets ${secretName} created`);
      } catch (err: any) {
        if (err.statusCode === 404) {
          await k8sRequest(`${config.server}/api/v1/namespaces/${namespace}/secrets`, 'POST', secretManifest, config);
          ctx.logger.info(`App secrets ${secretName} created`);
        } else {
          throw err;
        }
      }

      ctx.logger.warn(`OAuth credentials in ${secretName} are empty — update auth-github-id, auth-github-secret, auth-google-id, auth-google-secret before the app can authenticate`);
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
  if (!kubeconfigPath) throw new Error(`No kubeconfig found`);

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
        else { const err: any = new Error(`K8s ${method} ${sc}: ${data.substring(0, 200)}`); err.statusCode = sc; reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`K8s API request timed out after 30s`)); });
    req.write(bodyStr);
    req.end();
  });
}
