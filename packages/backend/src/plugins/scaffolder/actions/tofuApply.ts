import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { spawn } from 'child_process';
import path from 'path';

/**
 * infra:tofu-apply
 *
 * Runs `tofu init` + `tofu apply` in the scaffolder workspace.
 * Used by infra templates to provision infrastructure directly from the
 * scaffolder step rather than waiting for GitHub Actions.
 *
 * Requires OpenTofu to be installed in the backend environment and
 * AWS credentials available via env vars or instance profile.
 *
 * Usage in template:
 *   - id: tofu-apply
 *     name: Provision Infrastructure
 *     action: infra:tofu-apply
 *     input:
 *       workingDir: infra/
 *       autoApprove: true
 *       vars:
 *         aws_region: us-west-2
 */
export function createTofuApplyAction() {
  return createTemplateAction({
    id: 'infra:tofu-apply',
    description: 'Run tofu init + tofu apply in the scaffolder workspace',
    schema: {
      input: z =>
        z.object({
          workingDir: z
            .string()
            .optional()
            .describe('Subdirectory within workspace to run tofu in (default: root)'),
          autoApprove: z
            .boolean()
            .optional()
            .describe('Skip interactive approval (default: true)'),
          vars: z
            .record(z.string())
            .optional()
            .describe('Additional -var key=value pairs to pass to tofu'),
          destroy: z
            .boolean()
            .optional()
            .describe('Run tofu destroy instead of apply (default: false)'),
        }),
      output: z =>
        z.object({
          outputs: z.record(z.string()).describe('tofu output values'),
        }),
    },
    async handler(ctx) {
      const {
        workingDir,
        autoApprove = true,
        vars = {},
        destroy = false,
      } = ctx.input;

      let cwd = ctx.workspacePath;
      if (workingDir) {
        const resolved = path.resolve(ctx.workspacePath, workingDir);
        if (!resolved.startsWith(ctx.workspacePath + path.sep) && resolved !== ctx.workspacePath) {
          throw new Error(`workingDir must be within the workspace: ${workingDir}`);
        }
        cwd = resolved;
      }

      // Build a minimal env — only PATH, HOME, AWS_*, and TF_* vars.
      // Passing the full process.env would expose all backend secrets (DB passwords, OAuth secrets, etc.)
      // to the tofu subprocess and its log output.
      const tofuEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) =>
            k.startsWith('AWS_') || k.startsWith('TF_'),
          ),
        ),
      };

      const run = (cmd: string, args: string[]) =>
        new Promise<string>((resolve, reject) => {
          ctx.logger.info(`$ ${cmd} ${args.join(' ')}`);
          let stdout = '';
          let stderr = '';
          const proc = spawn(cmd, args, { cwd, env: tofuEnv });
          proc.stdout.on('data', (d: Buffer) => {
            const s = d.toString();
            stdout += s;
            ctx.logger.info(s.trimEnd());
          });
          proc.stderr.on('data', (d: Buffer) => {
            const s = d.toString();
            stderr += s;
            ctx.logger.warn(s.trimEnd());
          });
          proc.on('close', code => {
            if (code !== 0) {
              reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
            } else {
              resolve(stdout);
            }
          });
        });

      // tofu init
      await run('tofu', ['init', '-input=false']);

      // tofu apply / destroy
      const varArgs = Object.entries(vars).flatMap(([k, v]) => [
        '-var',
        `${k}=${v}`,
      ]);
      const applyCmd = destroy ? 'destroy' : 'apply';
      const applyArgs = [
        applyCmd,
        '-input=false',
        ...(autoApprove ? ['-auto-approve'] : []),
        ...varArgs,
      ];
      await run('tofu', applyArgs);

      // tofu output -json
      let outputs: Record<string, string> = {};
      try {
        const outputJson = await run('tofu', ['output', '-json']);
        const parsed = JSON.parse(outputJson);
        outputs = Object.fromEntries(
          Object.entries(parsed).map(([k, v]: [string, any]) => [
            k,
            String(v?.value ?? v),
          ]),
        );
      } catch {
        ctx.logger.warn('Could not parse tofu outputs');
      }

      ctx.output('outputs', outputs);
    },
  });
}
