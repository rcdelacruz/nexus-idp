import test from 'node:test';
import assert from 'node:assert/strict';
import { installVersion, shownInstallCommand } from './selfUpdate';

test('the update runs the npm of the running node, into this copy\'s prefix, with that node first on the PATH', async () => {
  const seen: Array<{ command: string; options: { timeout: number; env: NodeJS.ProcessEnv } }> = [];
  const npm = { command: '/n/bin/npm', env: { PATH: '/n/bin:/usr/bin' } as NodeJS.ProcessEnv };
  const r = await installVersion('/home/r/.backstage-agent/npm', '@stratpoint/backstage-agent@0.1.31', async (command, options) => {
    seen.push({ command, options });
    return { stdout: 'ok', stderr: '' };
  }, npm);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, '"/n/bin/npm" install -g --prefix "/home/r/.backstage-agent/npm" @stratpoint/backstage-agent@0.1.31');
  assert.equal(seen[0].options.env.PATH, '/n/bin:/usr/bin');
  assert.ok(seen[0].options.timeout >= 60_000);
  assert.equal(r.shown, 'npm install -g --prefix "/home/r/.backstage-agent/npm" @stratpoint/backstage-agent@0.1.31');
  assert.equal(r.stdout, 'ok');
});

test('a failed install throws, so the command can say so and show the plain npm line', async () => {
  await assert.rejects(
    installVersion(undefined, 'p@1.0.0', async () => {
      throw new Error('EACCES');
    }, { command: 'npm', env: {} }),
    /EACCES/,
  );
  assert.equal(shownInstallCommand(undefined, 'p@1.0.0'), 'npm install -g p@1.0.0');
});
