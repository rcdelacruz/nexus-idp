import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:repo:add-collaborator
 *
 * Adds a GitHub user as a collaborator on a repository.
 * Skips gracefully if GITHUB_TOKEN is not set or username is empty.
 * Sends an invitation if the user is not already a member of the org.
 */
export function createAddRepoCollaboratorAction() {
  return createTemplateAction({
    id: 'github:repo:add-collaborator',
    description: 'Add a GitHub user as a collaborator on a repository',
    schema: {
      input: z => z.object({
        repoOwner: z.string(),
        repoName: z.string(),
        username: z.string(),
        access: z.enum(['pull', 'triage', 'push', 'maintain', 'admin']).optional().describe('Permission level (default: push)'),
      }),
    },
    async handler(ctx) {
      const { repoOwner, repoName, username, access = 'push' } = ctx.input;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        ctx.logger.warn('GITHUB_TOKEN not set — skipping add-collaborator');
        return;
      }
      if (!username?.trim()) {
        ctx.logger.warn('username is empty — skipping add-collaborator');
        return;
      }

      ctx.logger.info(`Adding ${username} as ${access} collaborator on ${repoOwner}/${repoName}`);

      await ghApi(
        `/repos/${repoOwner}/${repoName}/collaborators/${encodeURIComponent(username)}`,
        'PUT',
        token,
        { permission: access },
      );

      ctx.logger.info(`Collaborator invitation sent to ${username}`);
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
        // 201 = invitation sent, 204 = already a collaborator — both are success
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
