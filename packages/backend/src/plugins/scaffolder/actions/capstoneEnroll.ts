/**
 * Brownfield capstones (strat-training/*-training-capstone) through the Local Provisioner backend,
 * which owns the enrollment store and runs the capstone's own seed server-side:
 *
 *   stratpoint:capstone-enroll    POST /capstones/enrollments → writes the seeded trainee files into
 *                                 the workspace. The seed manifest, credentials and answer key stay
 *                                 in the backend (instructor-only); they never reach the workspace.
 *   stratpoint:capstone-link-repo PUT  /capstones/enrollments/:id/repo after publish:github.
 *
 * Both call on behalf of the user running the template (same pattern as stratpoint:local-provision).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { InputError } from '@backstage/errors';
import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';
import fs from 'fs-extra';
import path from 'path';

export interface CapstoneActionOptions {
  discovery: DiscoveryService;
  auth: AuthService;
}

/** Resolve `rel` under `root`, refusing anything that escapes it (absolute paths, `..`). */
export function safeJoin(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new InputError(`Refusing to write outside the workspace: ${rel}`);
  }
  return target;
}

export const createCapstoneEnrollAction = ({ discovery, auth }: CapstoneActionOptions) =>
  createTemplateAction({
    id: 'stratpoint:capstone-enroll',
    description: 'Enroll the current user in a brownfield capstone and write their seeded copy into the workspace',
    schema: {
      input: {
        capstone: z => z.string({ description: 'Capstone id, e.g. nodejs' }),
        targetPath: z => z.string({ description: 'Workspace-relative directory for the trainee repo, e.g. ./trainee-repo' }),
        seedFilesPath: z =>
          z
            .string({ description: 'Laptop-seeded capstones: workspace-relative directory for the lab seed container files (e.g. ./rendered/seed)' })
            .optional(),
      },
      output: {
        enrollmentId: z => z.string(),
        traineeNumber: z => z.string(),
        seedToken: z => z.string({ description: 'Laptop-seeded capstones: single-use seed-report token' }).optional(),
        seedReportUrl: z => z.string().optional(),
      },
    },
    async handler(ctx) {
      const { capstone, targetPath } = ctx.input;
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await ctx.getInitiatorCredentials(),
        targetPluginId: 'local-provisioner',
      });
      const baseUrl = await discovery.getBaseUrl('local-provisioner');
      const res = await fetch(`${baseUrl}/capstones/enrollments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ capstone }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Capstone enrollment failed (${res.status}): ${body.message ?? body.error ?? 'unknown error'}`);
      }

      const dir = safeJoin(ctx.workspacePath, targetPath);
      const files: Record<string, string> = body.files ?? {};
      for (const [rel, b64] of Object.entries(files)) {
        const dest = safeJoin(dir, rel);
        await fs.ensureDir(path.dirname(dest));
        await fs.writeFile(dest, Buffer.from(b64, 'base64'));
      }
      ctx.logger.info(
        `Enrolled in ${capstone} as trainee #${body.enrollment.traineeNo}; wrote ${Object.keys(files).length} file(s) to ${targetPath}`,
      );
      ctx.output('enrollmentId', body.enrollment.id);
      ctx.output('traineeNumber', body.enrollment.traineeNo);

      // Laptop-seeded capstones (Terraform): the seed script for the lab's one-shot seed container,
      // and the single-use token it reports back with. Never logged.
      if (body.laptopSeed) {
        if (!ctx.input.seedFilesPath) throw new InputError(`${capstone} is seeded on the laptop: set seedFilesPath`);
        const seedDir = safeJoin(ctx.workspacePath, ctx.input.seedFilesPath);
        for (const [name, b64] of Object.entries(body.laptopSeed.files as Record<string, string>)) {
          const dest = safeJoin(seedDir, name);
          await fs.ensureDir(path.dirname(dest));
          await fs.writeFile(dest, Buffer.from(b64, 'base64'));
        }
        ctx.output('seedToken', body.laptopSeed.token);
        ctx.output('seedReportUrl', body.laptopSeed.reportUrl);
      }
    },
  });

export const createCapstoneLinkRepoAction = ({ discovery, auth }: CapstoneActionOptions) =>
  createTemplateAction({
    id: 'stratpoint:capstone-link-repo',
    description: "Record the trainee's published repo on their capstone enrollment",
    schema: {
      input: {
        enrollmentId: z => z.string(),
        repoUrl: z => z.string({ description: 'https://github.com/<owner>/<repo> (publish:github remoteUrl)' }),
      },
      output: {
        runnerToken: z =>
          z.string({ description: 'Laptop-seeded capstones: self-hosted Actions runner registration token (~1 h)' }).optional(),
      },
    },
    async handler(ctx) {
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await ctx.getInitiatorCredentials(),
        targetPluginId: 'local-provisioner',
      });
      const baseUrl = await discovery.getBaseUrl('local-provisioner');
      const res = await fetch(`${baseUrl}/capstones/enrollments/${encodeURIComponent(ctx.input.enrollmentId)}/repo`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: ctx.input.repoUrl }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Could not record the capstone repo (${res.status}): ${body.error ?? 'unknown error'}`);
      }
      ctx.logger.info(`Capstone enrollment ${ctx.input.enrollmentId} linked to ${ctx.input.repoUrl}`);
      if (body.runner?.token) ctx.output('runnerToken', body.runner.token);
    },
  });
