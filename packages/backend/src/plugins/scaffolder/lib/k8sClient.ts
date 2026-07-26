import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as https from 'https';
import * as http from 'http';

/**
 * Shared Kubernetes API client for scaffolder actions.
 * Works in all environments:
 * - Local: reads kubeconfig from KUBECONFIG env or ~/.kube/config
 * - In-cluster (ECS/K8s): uses service account token
 */

export interface ClusterConfig {
  server: string;
  token?: string;
  ca?: string;
  clientCert?: string;
  clientKey?: string;
}

/** Resolve cluster connection — in-cluster SA or kubeconfig file */
export async function getClusterConfig(): Promise<ClusterConfig> {
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
export function buildApiPath(apiVersion: string, kind: string, namespace?: string, name?: string): string {
  const isCore = !apiVersion.includes('/');
  const base = isCore ? `/api/${apiVersion}` : `/apis/${apiVersion}`;
  const resource = kindToResource(kind);

  let apiPath = namespace ? `${base}/namespaces/${namespace}/${resource}` : `${base}/${resource}`;
  if (name) apiPath += `/${name}`;
  return apiPath;
}

/** Map Kind to plural resource name */
export function kindToResource(kind: string): string {
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
    PersistentVolumeClaim: 'persistentvolumeclaims',
  };
  return map[kind] ?? `${kind.toLowerCase()}s`;
}

/** Make an HTTP(S) request to the K8s API. body may be omitted for GET/DELETE. */
export function k8sRequest(url: string, method: string, body: any, config: ClusterConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': method === 'PATCH'
        ? 'application/merge-patch+json'
        : 'application/json',
      Accept: 'application/json',
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const hasBody = body !== undefined && body !== null;
    const bodyStr = hasBody ? JSON.stringify(body) : '';

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: hasBody ? { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } : headers,
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
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          const err: any = new Error(`K8s API ${method} ${url} returned ${statusCode}: ${data}`);
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`K8s API request timed out after 30s: ${method} ${url}`)); });
    if (hasBody) req.write(bodyStr);
    req.end();
  });
}

/** K8s API server-side apply PATCH uses a different content type than a merge PATCH. */
export function k8sApplyPatch(url: string, body: any, config: ClusterConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyStr = yaml.dump(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/apply-patch+yaml',
      Accept: 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr)),
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'PATCH',
      headers,
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
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          const err: any = new Error(`K8s API PATCH ${url} returned ${statusCode}: ${data}`);
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`K8s API request timed out after 30s: PATCH ${url}`)); });
    req.write(bodyStr);
    req.end();
  });
}
