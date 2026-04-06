import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';

/**
 * scaffolder:get-targets
 *
 * Reads available deployment targets from app-config (scaffolder.targets)
 * and returns them as options for form dropdowns.
 *
 * Usage in template:
 *   - id: get-targets
 *     action: scaffolder:get-targets
 *     input:
 *       type: kubernetes
 *   - id: get-aws-targets
 *     action: scaffolder:get-targets
 *     input:
 *       type: aws
 */
export function createGetTargetsAction(options: { config: Config }) {
  const { config } = options;

  return createTemplateAction({
    id: 'scaffolder:get-targets',
    description: 'Read available deployment targets from platform config',
    schema: {
      input: z =>
        z.object({
          type: z
            .enum(['kubernetes', 'aws'])
            .describe('Target type to list'),
        }),
      output: z =>
        z.object({
          targets: z
            .array(
              z.object({
                name: z.string(),
                displayName: z.string(),
              }),
            )
            .describe('Available targets'),
        }),
    },
    async handler(ctx) {
      const { type } = ctx.input;
      const targetsConfig = config.getOptionalConfigArray(`scaffolder.targets.${type}`) ?? [];

      const targets = targetsConfig.map(t => ({
        name: t.getString('name'),
        displayName: t.getString('displayName'),
      }));

      ctx.logger.info(`Available ${type} targets: ${targets.map(t => t.name).join(', ')}`);
      ctx.output('targets', targets);
    },
  });
}
