import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';

/**
 * Scaffolder action: scaffolder:resolve-skeleton-url
 *
 * Resolves the URL for a skeleton directory dynamically from app-config.
 * Eliminates hardcoded file:// paths in template YAML files.
 *
 * app-config.yaml:
 *   scaffolder:
 *     engineeringStandards:
 *       localPath: ${ENGINEERING_STANDARDS_LOCAL_PATH}   # local dev
 *       githubUrl: https://github.com/org/engineering-standards/blob/main  # production
 *
 * Usage in template:
 *   - id: resolve-nextjs-url
 *     action: scaffolder:resolve-skeleton-url
 *     input:
 *       type: framework
 *       name: nextjs
 *   - id: fetch-framework
 *     action: fetch:template
 *     input:
 *       url: ${{ steps['resolve-nextjs-url'].output.url }}
 */
export function createResolveSkeletonUrlAction(options: { config: Config }) {
  const { config } = options;

  return createTemplateAction({
    id: 'scaffolder:resolve-skeleton-url',
    description: 'Resolve a skeleton directory URL from platform config — eliminates hardcoded paths in templates',
    schema: {
      input: z =>
        z.object({
          type: z
            .enum(['framework', 'target', 'infra'])
            .describe('Skeleton type: "framework" (app code), "target" (deployment config), or "infra" (infrastructure provisioning)'),
          name: z
            .string()
            .describe('Skeleton name, e.g. "nextjs", "k8s", "ecs", "lambda", "aws-ecs-cluster", "aws-ec2", "aws-rds", "k8s-namespace"'),
        }),
      output: z =>
        z.object({
          url: z.string().describe('Resolved URL to the skeleton directory'),
          isLocal: z.boolean().describe('True if resolved to a local file:// path'),
        }),
    },
    async handler(ctx) {
      const { type, name } = ctx.input;

      const skeletonsSubPath = type === 'infra'
        ? `templates/skeletons/infra/${name}`
        : `templates/skeletons/${type}s/${name}`;

      // Prefer local path (dev), fall back to GitHub URL (production)
      const localPath = config.getOptionalString('scaffolder.engineeringStandards.localPath');
      const githubUrl = config.getOptionalString('scaffolder.engineeringStandards.githubUrl');

      let url: string;
      let isLocal: boolean;

      if (localPath) {
        url = `file://${localPath}/${skeletonsSubPath}`;
        isLocal = true;
      } else if (githubUrl) {
        url = `${githubUrl}/${skeletonsSubPath}`;
        isLocal = false;
      } else {
        throw new Error(
          'Neither scaffolder.engineeringStandards.localPath nor scaffolder.engineeringStandards.githubUrl is configured in app-config.yaml. ' +
          'Set ENGINEERING_STANDARDS_LOCAL_PATH in your .env for local development, or configure githubUrl for production.',
        );
      }

      ctx.logger.info(`Resolved skeleton URL [${type}/${name}]: ${url}`);
      ctx.output('url', url);
      ctx.output('isLocal', isLocal);
    },
  });
}
