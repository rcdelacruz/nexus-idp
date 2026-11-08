import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerHelp, dockerState, Exec } from './dockerCheck';

const failing = (message: string, stderr = ''): Error & { stderr: string } => Object.assign(new Error(message), { stderr });

test('Docker is ready when the client runs and the daemon answers', async () => {
  const calls: string[] = [];
  const exec: Exec = async (_file, args) => {
    calls.push(args.join(' '));
    return {};
  };
  assert.equal(await dockerState(exec), 'ok');
  assert.deepEqual(calls, ['--version', 'ps -q']);
});

test('no docker command at all: missing', async () => {
  const exec: Exec = async () => {
    throw failing('spawn docker ENOENT');
  };
  assert.equal(await dockerState(exec), 'missing');
});

test('the client is there but the daemon does not answer: not running (Docker Desktop closed)', async () => {
  const exec: Exec = async (_f, args) => {
    if (args[0] === 'ps') throw failing('exit 1', 'Cannot connect to the Docker daemon at unix:///Users/r/.docker/run/docker.sock. Is the docker daemon running?');
  };
  assert.equal(await dockerState(exec), 'not-running');
});

test('a hung daemon (timeout) counts as not running', async () => {
  const exec: Exec = async (_f, args) => {
    if (args[0] === 'ps') throw failing('Command failed: timeout');
  };
  assert.equal(await dockerState(exec), 'not-running');
});

test('running but this user may not use it: no access (Linux docker group)', async () => {
  const exec: Exec = async (_f, args) => {
    if (args[0] === 'ps') throw failing('exit 1', 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock');
  };
  assert.equal(await dockerState(exec), 'no-access');
});

test('help recommends Docker Desktop on macOS and Windows and Docker Engine on Linux', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const lines = dockerHelp('missing', platform).join('\n');
    assert.match(lines, /Docker Desktop \(recommended\): https:\/\/www\.docker\.com\/products\/docker-desktop\//);
    assert.match(lines, /will not start without it/);
  }
  const linux = dockerHelp('missing', 'linux').join('\n');
  assert.match(linux, /Docker Engine: https:\/\/docs\.docker\.com\/engine\/install\//);
  assert.doesNotMatch(linux, /Desktop/);
});

test('help for a closed Docker says to open it and wait; Linux says how to start it', () => {
  assert.match(dockerHelp('not-running', 'darwin').join('\n'), /Open Docker Desktop and wait until it says it is running/);
  assert.match(dockerHelp('not-running', 'linux').join('\n'), /sudo systemctl start docker/);
  assert.match(dockerHelp('no-access', 'linux').join('\n'), /usermod -aG docker/);
});

test('nothing to say when Docker is ready', () => {
  assert.deepEqual(dockerHelp('ok'), []);
});
