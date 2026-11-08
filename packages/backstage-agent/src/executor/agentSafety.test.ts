import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dockerImageIsCached } from './DockerComposeExecutor';
import { parseVmState } from './MultipassExecutor';

/**
 * Audit 2026-11-07. An image name comes from the lab's compose file: it was interpolated into a shell command, so a command
 * substitution in an `image:` value ran on the trainee's machine. And multipass.json (the agent's own VM record) was trusted as written.
 */
test('an image name goes to docker as one argument and no shell ever sees it', { skip: process.platform === 'win32' }, async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakedocker-'));
  const marker = path.join(bin, 'PWNED');
  const argvLog = path.join(bin, 'argv.log');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvLog}"\necho abc123\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  try {
    for (const image of [`x$(touch ${marker})`, `x\`touch ${marker}\``, `x; touch ${marker}`, `x" ; touch ${marker} ; "`, `x && touch ${marker}`]) {
      assert.equal(await dockerImageIsCached(image), true);
    }
    assert.equal(fs.existsSync(marker), false, 'a shell ran the image name');
    const argv = fs.readFileSync(argvLog, 'utf8').split('\n');
    assert.ok(argv.includes(`x$(touch ${marker})`), 'the name did not arrive as one literal argument');
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('a name that looks like an option is not passed to docker at all', async () => {
  let called = false;
  assert.equal(await dockerImageIsCached('--help', async () => { called = true; return { stdout: 'x' }; }), false);
  assert.equal(await dockerImageIsCached('', async () => { called = true; return { stdout: 'x' }; }), false);
  assert.equal(called, false);
});

test('a normal image reads the answer docker gives', async () => {
  assert.equal(await dockerImageIsCached('postgres:17', async () => ({ stdout: 'abc\n' })), true);
  assert.equal(await dockerImageIsCached('postgres:17', async () => ({ stdout: '\n' })), false);
});

test('the VM record is refused unless it is a real instance, login and key inside the keys folder', () => {
  const keys = path.join(os.tmpdir(), 'agent-keys');
  const ok = { instance: 'linux-capstone-a-ron-20261103-1001', sshUser: 'trainee', keyPath: path.join(keys, 'linux-capstone-a-ron-20261103-1001') };
  assert.deepEqual(parseVmState(JSON.stringify(ok), keys), ok);
  assert.deepEqual(parseVmState(JSON.stringify({ ...ok, keyPath: '' }), keys).keyPath, '');
  const bad: Array<[string, unknown]> = [
    ['instance with a shell', { ...ok, instance: 'x; rm -rf ~' }],
    ['instance as an option', { ...ok, instance: '--help' }],
    ['uppercase instance', { ...ok, instance: 'Lab' }],
    ['login with a shell', { ...ok, sshUser: 'root;id' }],
    ['key outside the keys folder', { ...ok, keyPath: path.join(os.homedir(), '.ssh', 'id_ed25519') }],
    ['key that climbs out', { ...ok, keyPath: path.join(keys, '..', '..', 'victim') }],
    ['key that is a sibling with the same prefix', { ...ok, keyPath: `${keys}-evil/key` }],
    ['key that is the folder itself', { ...ok, keyPath: keys }],
    ['no key field', { instance: ok.instance, sshUser: 'trainee' }],
    ['not an object', 'text'],
  ];
  for (const [name, record] of bad) assert.throws(() => parseVmState(JSON.stringify(record), keys), /not valid/, name);
});

test('a task cannot write multipass.json (the agent\'s own VM record), anywhere, but its source files are written', async () => {
  const { DockerComposeExecutor } = await import('./DockerComposeExecutor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcfiles-'));
  try {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    (new DockerComposeExecutor() as any).writeSourceFiles(
      { 'multipass.json': b64('{"instance":"x"}'), 'sub/multipass.json': b64('{}'), 'app/main.js': b64('console.log(1)'), '../escape.txt': b64('x') },
      dir,
    );
    assert.equal(fs.existsSync(path.join(dir, 'multipass.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'sub', 'multipass.json')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'app', 'main.js'), 'utf8'), 'console.log(1)');
    assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.txt')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
