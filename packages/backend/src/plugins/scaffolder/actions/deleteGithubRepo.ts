import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:repo:delete
 *
 * Deletes a GitHub repository. Idempotent — a 404 (already deleted) is a
 * success, not a failure. A 403 (token lacks delete_repo scope) fails loudly
 * with a clear message, since that's a config problem the caller must fix.
 */
export function createDeleteGithubRepoAction() {
  return createTemplateAction({
    id: 'github:repo:delete',
    description: 'Delete a GitHub repository',
    schema: {
      input: z =>
        z.object({
          repoOwner: z.string(),
          repoName: z.string(),
        }),
      output: z =>
        z.object({
          deleted: z.boolean(),
        }),
    },
    async handler(ctx) {
      const { repoOwner, repoName } = ctx.input;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN not set — cannot delete GitHub repository');
      }

      ctx.logger.info(`Deleting GitHub repository ${repoOwner}/${repoName}...`);

      try {
        await ghApi(`/repos/${repoOwner}/${repoName}`, 'DELETE', token);
        ctx.logger.info(`Deleted: ${repoOwner}/${repoName}`);
        ctx.output('deleted', true);
      } catch (err: any) {
        if (err.statusCode === 404) {
          ctx.logger.warn(`GitHub repo ${repoOwner}/${repoName} not found — already deleted`);
          ctx.output('deleted', true);
          return;
        }
        if (err.statusCode === 403) {
          throw new Error(
            `Cannot delete ${repoOwner}/${repoName}: 403 Forbidden — GITHUB_TOKEN likely lacks the ` +
            `delete_repo scope`,
          );
        }
        throw new Error(`Failed to delete ${repoOwner}/${repoName}: ${err.message}`);
      }
    },
  });
}

function ghApi(path: string, method: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
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
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          const err: any = new Error(`GitHub API ${method} ${path}: ${statusCode} ${data.substring(0, 200)}`);
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('GitHub API request timed out after 30s')); });
    req.end();
  });
}
