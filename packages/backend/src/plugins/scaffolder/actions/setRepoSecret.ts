import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:repo:set-secret
 *
 * Sets a secret on a GitHub repository using the Actions Secrets API.
 * When secretName/secretValue are omitted, defaults to setting GH_PAT
 * (the GHCR push token used by CI/CD).
 */
export function createSetRepoSecretAction() {
  return createTemplateAction({
    id: 'github:repo:set-secret',
    description: 'Set a secret on a GitHub repo (defaults to GH_PAT for GHCR access)',
    schema: {
      input: z => z.object({
        repoOwner: z.string(),
        repoName: z.string(),
        secretName: z.string().optional().describe('Secret name (default: GH_PAT)'),
        secretValue: z.string().optional().describe('Secret value (default: GHCR_TOKEN or GITHUB_TOKEN)'),
      }),
    },
    async handler(ctx) {
      const { repoOwner, repoName } = ctx.input;
      const secretName = ctx.input.secretName ?? 'GH_PAT';

      // Resolve secret value: explicit input > named env var > fallback defaults
      const ENV_MAP: Record<string, string | undefined> = {
        GH_PAT: process.env.GHCR_TOKEN ?? process.env.GITHUB_TOKEN,
        ARGOCD_TOKEN: process.env.ARGOCD_TOKEN,
        // ARGOCD_FRONTEND_URL is the public URL reachable from GitHub Actions.
        // ARGOCD_URL is the internal cluster URL — unusable outside the cluster.
        ARGOCD_SERVER: process.env.ARGOCD_FRONTEND_URL ?? process.env.ARGOCD_URL ?? process.env.ARGOCD_SERVER,
      };
      const secretValue = ctx.input.secretValue
        ?? ENV_MAP[secretName]
        ?? process.env.GHCR_TOKEN
        ?? process.env.GITHUB_TOKEN;

      const token = process.env.GHCR_TOKEN ?? process.env.GITHUB_TOKEN;
      if (!token) {
        ctx.logger.warn('GHCR_TOKEN and GITHUB_TOKEN not set — skipping secret');
        return;
      }
      if (!secretValue) {
        ctx.logger.warn(`No value for secret ${secretName} — skipping`);
        return;
      }

      ctx.logger.info(`Setting ${secretName} on ${repoOwner}/${repoName}`);

      // GitHub Actions API is not immediately ready on a freshly created repo — retry
      let pubKey: any;
      for (let attempt = 1; attempt <= 8; attempt++) {
        try {
          pubKey = await ghApi(`/repos/${repoOwner}/${repoName}/actions/secrets/public-key`, 'GET', token);
          break;
        } catch (err: any) {
          if (attempt === 8) throw err;
          ctx.logger.info(`Actions API not ready yet (attempt ${attempt}/8), retrying in 5s…`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      const sodiumModule = await import('libsodium-wrappers');
      const sodium = sodiumModule.default ?? sodiumModule;
      await sodium.ready;
      const keyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
      const secretBytes = sodium.from_string(secretValue);
      const encrypted = sodium.crypto_box_seal(secretBytes, keyBytes);
      const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

      await ghApi(`/repos/${repoOwner}/${repoName}/actions/secrets/${secretName}`, 'PUT', token, {
        encrypted_value: encryptedB64,
        key_id: pubKey.key_id,
      });

      ctx.logger.info(`${secretName} secret set`);
    },
  });
}

function ghApi(path: string, method: string, token: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'backstage-scaffolder',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error(`GitHub API ${method} ${path}: ${res.statusCode} ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('GitHub API request timed out after 30s')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
