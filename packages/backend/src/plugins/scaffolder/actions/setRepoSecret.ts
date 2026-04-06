import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:repo:set-secret
 *
 * Sets the GITHUB_TOKEN from env as GH_PAT on the scaffolded repo
 * so CI/CD can push to GHCR.
 */
export function createSetRepoSecretAction() {
  return createTemplateAction({
    id: 'github:repo:set-secret',
    description: 'Set GH_PAT secret on a GitHub repo for GHCR access',
    schema: {
      input: z => z.object({
        repoOwner: z.string(),
        repoName: z.string(),
      }),
    },
    async handler(ctx) {
      const { repoOwner, repoName } = ctx.input;
      // Prefer a scoped GHCR_TOKEN (packages:write only) over the broad org-level GITHUB_TOKEN.
      const token = process.env.GHCR_TOKEN ?? process.env.GITHUB_TOKEN;
      if (!token) { ctx.logger.warn('GHCR_TOKEN and GITHUB_TOKEN not set — skipping GH_PAT secret'); return; }
      if (!process.env.GHCR_TOKEN) {
        ctx.logger.warn('GHCR_TOKEN not set — falling back to GITHUB_TOKEN. Set GHCR_TOKEN (packages:write scope only) to limit secret exposure.');
      }

      ctx.logger.info(`Setting GH_PAT on ${repoOwner}/${repoName}`);

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

      // Encrypt using libsodium-wrappers
      const sodiumModule = await import('libsodium-wrappers');
      const sodium = sodiumModule.default ?? sodiumModule;
      await sodium.ready;
      const keyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
      const secretBytes = sodium.from_string(token);
      const encrypted = sodium.crypto_box_seal(secretBytes, keyBytes);
      const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

      // Set secret
      await ghApi(`/repos/${repoOwner}/${repoName}/actions/secrets/GH_PAT`, 'PUT', token, {
        encrypted_value: encryptedB64,
        key_id: pubKey.key_id,
      });

      ctx.logger.info('GH_PAT secret set');
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
    req.on('timeout', () => { req.destroy(new Error(`GitHub API request timed out after 30s`)); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
