/**
 * Is Docker ready? The agent runs labs in Docker and will not start without it, so `start` and `login`
 * check first and say what is wrong and what to install, instead of printing "did not start, see the logs".
 */
import { execFile } from 'child_process';

export type DockerState = 'ok' | 'missing' | 'not-running' | 'no-access';

export type Exec = (file: string, args: string[], options: { timeout: number }) => Promise<unknown>;

const defaultExec: Exec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr ?? '') }));
      else resolve({ stdout, stderr });
    });
  });

const CHECK_TIMEOUT_MS = 15_000;

/** Docker is not installed, installed but not running, running but not usable by this user, or ready. */
export async function dockerState(exec: Exec = defaultExec): Promise<DockerState> {
  try {
    await exec('docker', ['--version'], { timeout: CHECK_TIMEOUT_MS });
  } catch {
    return 'missing';
  }
  try {
    await exec('docker', ['ps', '-q'], { timeout: CHECK_TIMEOUT_MS });
    return 'ok';
  } catch (error: any) {
    return /permission denied/i.test(String(error?.stderr ?? error?.message ?? '')) ? 'no-access' : 'not-running';
  }
}

const DESKTOP = 'https://www.docker.com/products/docker-desktop/';
const ENGINE = 'https://docs.docker.com/engine/install/';

/** What to tell the user, one sentence per line. Empty when Docker is ready. */
export function dockerHelp(state: DockerState, platform: NodeJS.Platform = process.platform): string[] {
  const linux = platform === 'linux';
  switch (state) {
    case 'ok':
      return [];
    case 'missing':
      return linux
        ? ['Docker is not installed, and the agent will not start without it.', `Install Docker Engine: ${ENGINE}`, 'Then run the command again.']
        : [
            'Docker is not installed, and the agent will not start without it.',
            `Install Docker Desktop (recommended): ${DESKTOP}`,
            'Open it and wait until it says it is running, then run the command again.',
          ];
    case 'not-running':
      return linux
        ? ['Docker is installed but not running.', 'Start it with: sudo systemctl start docker', 'Then run the command again.']
        : ['Docker is installed but not running.', 'Open Docker Desktop and wait until it says it is running, then run the command again.'];
    case 'no-access':
      return linux
        ? [
            'Docker is running, but your user is not allowed to use it.',
            'Add yourself to the docker group: sudo usermod -aG docker $USER',
            'Then open a new terminal and run the command again.',
          ]
        : ['Docker is running, but your user is not allowed to use it.', 'Open Docker Desktop and check that your account may use it.'];
  }
}
