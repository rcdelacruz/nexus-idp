import { exec } from 'child_process';
import { promisify } from 'util';
import { npmForThisNode, npmInstallCommand } from './installLocation';

const execAsync = promisify(exec);

export type ExecFn = (command: string, options: { timeout: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;

/**
 * Install `spec` into `prefix` (this copy's own global prefix) with the npm that belongs to the Node running the agent,
 * which also goes first on the PATH for npm's own scripts. Returns the plain command to show a person if it fails.
 */
export async function installVersion(
  prefix: string | undefined,
  spec: string,
  run: ExecFn = execAsync as unknown as ExecFn,
  npm: ReturnType<typeof npmForThisNode> = npmForThisNode(),
): Promise<{ shown: string; stdout: string; stderr: string }> {
  const { shown, run: command } = npmInstallCommand(prefix, spec, npm.command);
  const { stdout, stderr } = await run(command, { timeout: 5 * 60 * 1000, env: npm.env });
  return { shown, stdout, stderr };
}

/** The command a person can type by hand (used in messages before and after a failed install). */
export function shownInstallCommand(prefix: string | undefined, spec: string): string {
  return npmInstallCommand(prefix, spec, 'npm').shown;
}

/**
 * `npm uninstall -g` of this copy (the one under `prefix`), with the npm that belongs to the running Node.
 */
export async function uninstallGlobal(
  prefix: string,
  spec: string,
  run: ExecFn = execAsync as unknown as ExecFn,
  npm: ReturnType<typeof npmForThisNode> = npmForThisNode(),
): Promise<void> {
  await run(`"${npm.command}" uninstall -g --prefix "${prefix}" ${spec}`, { timeout: 5 * 60 * 1000, env: npm.env });
}
