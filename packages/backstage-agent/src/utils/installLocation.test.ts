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
