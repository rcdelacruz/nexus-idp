import test from 'node:test';
import assert from 'node:assert/strict';
import { globalPrefixOf } from './installLocation';

test('finds the npm global prefix the agent runs from', () => {
  assert.equal(globalPrefixOf('/opt/homebrew/lib/node_modules/@stratpoint/backstage-agent', 'darwin'), '/opt/homebrew');
  assert.equal(globalPrefixOf('/Users/r/.nvm/versions/node/v22.11.0/lib/node_modules/@stratpoint/backstage-agent', 'darwin'), '/Users/r/.nvm/versions/node/v22.11.0');
  assert.equal(globalPrefixOf('/usr/local/lib/node_modules/@stratpoint/backstage-agent', 'linux'), '/usr/local');
  assert.equal(globalPrefixOf('C:\\Users\\Ronald Dela Cruz\\AppData\\Roaming\\npm\\node_modules\\@stratpoint\\backstage-agent', 'win32'), 'C:\\Users\\Ronald Dela Cruz\\AppData\\Roaming\\npm');
});

test('is undefined when the agent is not a global npm install', () => {
  assert.equal(globalPrefixOf('/tank/Projects/backstage-main/packages/backstage-agent', 'linux'), undefined);
  assert.equal(globalPrefixOf('/home/r/proj/node_modules/@stratpoint/backstage-agent', 'linux'), undefined); // local dependency
});

import { npmForThisNode } from './installLocation';

test('update runs the npm that sits next to the running node, with that folder first on the PATH', () => {
  const r = npmForThisNode('linux', '/home/r/.nvm/versions/node/v22.1.0/bin/node', p => p === '/home/r/.nvm/versions/node/v22.1.0/bin/npm', { PATH: '/usr/bin:/bin' });
  assert.equal(r.command, '/home/r/.nvm/versions/node/v22.1.0/bin/npm');
  assert.equal(r.env.PATH, '/home/r/.nvm/versions/node/v22.1.0/bin:/usr/bin:/bin');
});

test('without an npm next to node it falls back to npm on the PATH, still with node first', () => {
  const r = npmForThisNode('darwin', '/opt/homebrew/Cellar/node/22.1.0/bin/node', () => false, { PATH: '/usr/bin' });
  assert.equal(r.command, 'npm');
  assert.equal(r.env.PATH, '/opt/homebrew/Cellar/node/22.1.0/bin:/usr/bin');
});

test('Windows is left alone and an empty PATH does not leave a stray colon', () => {
  assert.deepEqual(npmForThisNode('win32', 'C:\\node\\node.exe', () => true, { PATH: 'C:\\x' }), { command: 'npm', env: { PATH: 'C:\\x' } });
  assert.equal(npmForThisNode('linux', '/n/bin/node', () => false, {}).env.PATH, '/n/bin');
});

import { npmInstallCommand } from './installLocation';

test('the update command installs into this copy\'s own prefix with the running node\'s npm, and shows the plain npm command', () => {
  const c = npmInstallCommand('/home/r/.backstage-agent/npm', '@stratpoint/backstage-agent@0.1.31', '/n/bin/npm');
  assert.equal(c.run, '"/n/bin/npm" install -g --prefix "/home/r/.backstage-agent/npm" @stratpoint/backstage-agent@0.1.31');
  assert.equal(c.shown, 'npm install -g --prefix "/home/r/.backstage-agent/npm" @stratpoint/backstage-agent@0.1.31');
  assert.equal(npmInstallCommand(undefined, 'p@1.0.0', 'npm').run, '"npm" install -g p@1.0.0');
});
