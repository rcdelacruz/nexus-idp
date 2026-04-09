import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:repo:setup-promotion
 *
 * Creates 'staging' and 'production' GitHub Environments with required reviewers
 * so the approval gate is active from day one.
 *
 * Runs for all deployment targets (k8s, ECS, App Runner) — GitHub Environments
 * are the universal approval gate regardless of where the app is deployed.
 */
export function createSetupRepoForPromotionAction() {
  return createTemplateAction({
    id: 'github:repo:setup-promotion',
    description: 'Create staging and production GitHub Environments with approval gates on a repo',
    schema: {
      input: z => z.object({
        repoOwner: z.string(),
        repoName: z.string(),
        reviewers: z.array(z.string()).optional().describe('GitHub usernames required to approve promotions'),
      }),
    },
    async handler(ctx) {
      const { repoOwner, repoName, reviewers = [] } = ctx.input;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN not set — cannot set up promotion environments');
      }

      for (const env of ['staging', 'production']) {
        ctx.logger.info(`Creating GitHub Environment: ${env}`);

        const body: any = {};

        if (reviewers.length > 0) {
          const reviewerIds: number[] = [];
          for (const username of reviewers) {
            try {
              const userData = await ghApi(`/users/${username}`, 'GET', token);
              reviewerIds.push(userData.id);
            } catch {
              ctx.logger.warn(`Could not resolve reviewer GitHub user: ${username}`);
            }
          }
          if (reviewerIds.length > 0) {
            body.reviewers = reviewerIds.map(id => ({ type: 'User', id }));
            body.prevent_self_review = true;
          }
        }

        await ghApi(
          `/repos/${repoOwner}/${repoName}/environments/${env}`,
          'PUT',
          token,
          body,
        );
        ctx.logger.info(`Environment '${env}' created`);
      }
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
