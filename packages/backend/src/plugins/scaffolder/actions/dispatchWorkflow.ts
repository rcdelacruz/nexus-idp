import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: github:dispatch-workflow
 *
 * Triggers a GitHub Actions workflow_dispatch event on an existing repository.
 * Used by the promote-app template to trigger governed promotion workflows.
 */
export function createDispatchWorkflowAction() {
  return createTemplateAction({
    id: 'github:dispatch-workflow',
    description: 'Trigger a GitHub Actions workflow via workflow_dispatch',
    schema: {
      input: z =>
        z.object({
          repoOwner: z.string().describe('GitHub org or user owning the repo'),
          repoName: z.string().describe('Repository name'),
          workflowId: z
            .string()
            .describe('Workflow file name (e.g. promote-staging.yml) or workflow ID'),
          ref: z.string().optional().describe('Git ref to run the workflow on (default: main)'),
          inputs: z
            .record(z.string())
            .optional()
            .describe('Workflow input key/value pairs'),
        }),
    },
    async handler(ctx) {
      const { repoOwner, repoName, workflowId, ref = 'main', inputs = {} } = ctx.input;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN is not set — cannot dispatch workflow');
      }

      ctx.logger.info(
        `Dispatching workflow ${workflowId} on ${repoOwner}/${repoName} @ ${ref}`,
      );

      await ghApi(
        `/repos/${repoOwner}/${repoName}/actions/workflows/${workflowId}/dispatches`,
        'POST',
        token,
        { ref, inputs },
      );

      ctx.logger.info('Workflow dispatch triggered successfully');
    },
  });
}

function ghApi(path: string, method: string, token: string, body?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'backstage-scaffolder',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
              }
            : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => {
          // workflow_dispatch returns 204 No Content on success
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `GitHub API ${method} ${path}: ${res.statusCode} ${data.substring(0, 300)}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('GitHub API request timed out after 30s'));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
