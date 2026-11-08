import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgmgr-'));
const previousHome = process.env.HOME;
const previousProfile = process.env.USERPROFILE;
process.env.HOME = home;
process.env.USERPROFILE = home;
test.after(() => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousProfile;
  fs.rmSync(home, { recursive: true, force: true });
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConfigManager } = require('./ConfigManager') as typeof import('./ConfigManager');
const mode = (p: string) => fs.statSync(p).mode & 0o777;

test('getTaskDir refuses an id that is a path and creates nothing', () => {
  const cm = new ConfigManager();
  for (const evil of ['../..', '../../projects/x', '..', 'a/b']) assert.throws(() => cm.getTaskDir(evil), /Invalid task id/, evil);
  assert.equal(fs.existsSync(path.join(home, 'projects')), false);
});

test('the service token and the task folders are private to the user', { skip: process.platform === 'win32' }, () => {
  const cm = new ConfigManager();
  cm.saveConfig({ agentId: 'a', serviceToken: 'secret-token' } as any);
  const dir = path.join(home, '.backstage-agent');
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, 'config.json')), 0o600);
  const task = cm.getTaskDir('0d7c1a46-9d2e-4c0e-9d57-5b0f3f6f8a11');
  assert.equal(mode(task), 0o700);
});

test('a config file left world-readable by an older version is tightened on the next save', { skip: process.platform === 'win32' }, () => {
  const dir = path.join(home, '.backstage-agent');
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o755);
  fs.writeFileSync(path.join(dir, 'config.json'), '{}', { mode: 0o644 });
  new ConfigManager().saveConfig({ agentId: 'a', serviceToken: 't2' } as any);
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, 'config.json')), 0o600);
});
