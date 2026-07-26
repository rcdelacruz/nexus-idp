import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import * as https from 'https';

/**
 * Scaffolder action: infra:destroy-aws-repos
 *
 * AWS infra (RDS/ECS/EKS/EC2) here is provisioned by pushing OpenTofu files to
 * a dedicated repo whose bundled GitHub Actions workflow (tofu.yml) applies
 * them via an OIDC-assumed AWS role — the Backstage backend never runs `tofu`
 * itself (no tofu/git binary in the runtime image). Teardown has to go
 * through the same path: dispatch that workflow's destroy job, wait for it to
 * actually finish, and only delete the repo afterward — deleting it first
 * would cancel the workflow before it destroys anything.
 */
export function createDestroyAwsInfraAction() {
  return createTemplateAction({
    id: 'infra:destroy-aws-repos',
    description: 'Dispatch the destroy job on each AWS infra repo\'s tofu workflow, wait for completion, then optionally delete the repo',
    schema: {
      input: z =>
        z.object({
          repos: z.array(z.object({
            repoOwner: z.string(),
            repoName: z.string(),
            resourceType: z.string(),
          })),
          deleteRepoAfter: z.boolean().default(true),
          workflowFile: z.string().default('tofu.yml'),
          timeoutSeconds: z.number().default(900).describe('Max time to wait for each destroy workflow to complete'),
        }),
      output: z =>
        z.object({
          destroyed: z.array(z.string()).describe('repoOwner/repoName that destroyed successfully'),
          failed: z.array(z.string()).describe('repoOwner/repoName that failed — repo was NOT deleted, needs manual cleanup'),
        }),
    },
    async handler(ctx) {
      const { repos } = ctx.input;
      // zod's schema-level .default() is a type/UI contract only — Backstage
      // does not apply it to ctx.input for unpassed fields at runtime (same
      // bug confirmed live in deleteArgocdApp.ts).
      const deleteRepoAfter = ctx.input.deleteRepoAfter ?? true;
      const workflowFile = ctx.input.workflowFile ?? 'tofu.yml';
      const timeoutSeconds = ctx.input.timeoutSeconds ?? 900;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN not set — cannot dispatch or poll AWS infra destroy workflows');
      }

      const destroyed: string[] = [];
      const failed: string[] = [];

      for (const { repoOwner, repoName, resourceType } of repos) {
        const slug = `${repoOwner}/${repoName}`;
        const dispatchedAt = new Date();

        ctx.logger.info(`Dispatching destroy workflow on ${slug} (${resourceType})...`);
        try {
          await ghApi(`/repos/${repoOwner}/${repoName}/actions/workflows/${workflowFile}/dispatches`, 'POST', token, {
            ref: 'main',
            inputs: { destroy: 'destroy' },
          });
        } catch (err: any) {
          ctx.logger.error(`Could not dispatch destroy workflow on ${slug}: ${err.message}`);
          failed.push(slug);
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const runId = await findDispatchedRun(repoOwner, repoName, workflowFile, dispatchedAt, token, ctx.logger);
        if (!runId) {
          ctx.logger.error(`Could not find the dispatched destroy run for ${slug} — check the Actions tab manually`);
          failed.push(slug);
          continue;
        }

        ctx.logger.info(`Waiting for destroy run ${runId} on ${slug} to complete (timeout ${timeoutSeconds}s)...`);
        // eslint-disable-next-line no-await-in-loop
        const conclusion = await pollRunConclusion(repoOwner, repoName, runId, timeoutSeconds, token);

        if (conclusion !== 'success') {
          ctx.logger.error(
            `Destroy workflow ${runId} on ${slug} finished with conclusion "${conclusion}" — ` +
            `repo NOT deleted, manual cleanup required: https://github.com/${slug}/actions/runs/${runId}`,
          );
          failed.push(slug);
          continue;
        }

        ctx.logger.info(`AWS resources destroyed: ${slug}`);
        destroyed.push(slug);

        if (deleteRepoAfter) {
          ctx.logger.info(`Deleting infra repo ${slug}...`);
          try {
            await ghApi(`/repos/${repoOwner}/${repoName}`, 'DELETE', token);
          } catch (err: any) {
            if (err.statusCode !== 404) {
              ctx.logger.warn(`Could not delete infra repo ${slug}: ${err.message}`);
            }
          }
        }
      }

      ctx.output('destroyed', destroyed);
      ctx.output('failed', failed);

      if (failed.length > 0) {
        throw new Error(`AWS infra destroy failed for: ${failed.join(', ')} — see task log for details`);
      }
    },
  });
}

/** Find the workflow run created by our dispatch (created_at >= dispatchedAt). */
async function findDispatchedRun(
  repoOwner: string,
  repoName: string,
  workflowFile: string,
  dispatchedAt: Date,
  token: string,
  logger: { info: (m: string) => void },
): Promise<number | undefined> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 5000));
    // eslint-disable-next-line no-await-in-loop
    const runs = await ghApi(
      `/repos/${repoOwner}/${repoName}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=5`,
      'GET',
      token,
    ).catch(() => undefined);
    const match = (runs?.workflow_runs ?? []).find((run: any) => new Date(run.created_at) >= dispatchedAt);
    if (match) return match.id;
    logger.info(`  Still waiting for the destroy run to appear on ${repoOwner}/${repoName}...`);
  }
  return undefined;
}

/** Poll a workflow run until it reports status=completed, returning its conclusion. */
async function pollRunConclusion(
  repoOwner: string,
  repoName: string,
  runId: number,
  timeoutSeconds: number,
  token: string,
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const run = await ghApi(`/repos/${repoOwner}/${repoName}/actions/runs/${runId}`, 'GET', token);
    if (run.status === 'completed') return run.conclusion ?? 'unknown';
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  return 'timed_out';
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
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          const err: any = new Error(`GitHub API ${method} ${path}: ${statusCode} ${data.substring(0, 300)}`);
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('GitHub API request timed out after 30s')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
