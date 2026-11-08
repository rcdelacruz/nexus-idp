import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DockerComposeExecutor, labEnvFile } from './DockerComposeExecutor';

test('the lab .env points compose at the clone, with forward slashes and the host user', () => {
  assert.equal(labEnvFile('/Users/ann/stratpoint/nodejs-capstone-ann', 501, 20), 'WORKSPACE_DIR=/Users/ann/stratpoint/nodejs-capstone-ann\nLAB_UID=501\nLAB_GID=20\n');
});

/** Runs only the clone-and-wait part of a workspace-mount lab (compose is never reached on failure). */
async function provision(git: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-home-'));
  const prev = { HOME: process.env.HOME, WS: process.env.BACKSTAGE_AGENT_WORKSPACE };
  process.env.HOME = home;
  process.env.BACKSTAGE_AGENT_WORKSPACE = path.join(home, 'ws');
  const steps: Array<[string, any]> = [];
  try {
    const ex = new DockerComposeExecutor();
    (ex as any).checkDockerAvailable = async () => true;
    ex.gitRunner = async args => git(args);
    ex.sleep = async () => undefined;
    // Stop right after the workspace step: no Docker needed for these tests.
    (ex as any).portConflicts = async () => {
      throw new Error('STOP_AFTER_WORKSPACE');
    };
    const r = await ex.executeTask(
      { task_id: 't1', resource_name: 'nodejs-capstone-x', task_type: 'provision-training',
        config: { labId: 'nodejs-capstone', workspaceMount: true, dockerCompose: 'services: {}', githubRepoUrl: 'https://github.com/o/nodejs-capstone-x.git' } } as any,
      (p, d) => steps.push([p, d]),
    );
    return { r, steps, home };
  } finally {
    process.env.HOME = prev.HOME;
    process.env.BACKSTAGE_AGENT_WORKSPACE = prev.WS;
  }
}

test('waits for repo access (the invitation), then clones and writes the lab .env', async () => {
  let denied = 2;
  const { r, steps, home } = await provision(args => {
    if (args[0] === 'clone' && denied-- > 0) return { code: 128, stdout: '', stderr: 'remote: Repository not found.' };
    if (args[0] === 'clone') {
      fs.mkdirSync(path.join(args[args.length - 1], '.git'), { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  });
  assert.match(r.error ?? '', /STOP_AFTER_WORKSPACE/, 'reached the step after the workspace');
  assert.deepEqual([...new Set(steps.map(s => s[0]))], ['Getting your repo', 'Waiting for access to your repo']);
  const waiting = steps.find(s => s[0] === 'Waiting for access to your repo')![1];
  assert.match(waiting.output, /1\. Accept the GitHub invitation \(once\): https:\/\/github\.com\/o\/nodejs-capstone-x\/invitations/);
  assert.match(waiting.output, /gh auth status/);
  assert.deepEqual(waiting.action, { label: 'Accept the GitHub invitation', url: 'https://github.com/o/nodejs-capstone-x/invitations' });
  const env = fs.readFileSync(path.join(home, '.backstage-agent', 'tasks', 't1', '.env'), 'utf8');
  assert.match(env, new RegExp(`^WORKSPACE_DIR=${path.join(home, 'ws', 'nodejs-capstone-x').split(path.sep).join('/')}\\n`));
});

test('a failure waiting cannot fix (git missing) fails at once and leaves no lab folder', async () => {
  const { r, steps, home } = await provision(() => ({ code: 127, stdout: '', stderr: 'spawn git ENOENT' }));
  assert.match(r.error ?? '', /Could not get your repo/);
  assert.equal(steps.filter(s => s[0] === 'Waiting for access to your repo').length, 0);
  assert.equal(fs.existsSync(path.join(home, '.backstage-agent', 'tasks', 't1')), false);
});

test('a login problem (not "not found") gets the hint, no invitation button', async () => {
  const { waitingForAccess } = await import('./DockerComposeExecutor');
  const w = waitingForAccess('https://github.com/o/r.git', "Your git isn't logged in to this host. Run `gh auth login`", 3);
  assert.equal(w.action, undefined);
  assert.match(w.output, /gh auth login[\s\S]*attempt 3/);
});
