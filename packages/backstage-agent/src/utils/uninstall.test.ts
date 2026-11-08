import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectInstall, MARK_BEGIN, MARK_END, stripBlock, uninstall, UninstallDeps } from './uninstall';

const BLOCK = `${MARK_BEGIN}\ncase ":$PATH:" in *":'/x/bin':"*) ;; *) export PATH='/x/bin':"$PATH" ;; esac\n${MARK_END}\n`;

test('the block is cut out and every other line stays', () => {
  assert.equal(stripBlock(`export A=1\n${BLOCK}# mine\n`), 'export A=1\n# mine\n');
  assert.equal(stripBlock(BLOCK), '');
  assert.equal(stripBlock('nothing here\n'), 'nothing here\n');
});

test('without the end marker nothing is cut (the rest of the file is the person\'s)', () => {
  const edited = `export A=1\n${MARK_BEGIN}\nexport PATH=x\n# my important line\n`;
  assert.equal(stripBlock(edited), edited);
});

test('where the copy lives tells how it was installed', () => {
  const home = '/Users/r';
  assert.deepEqual(detectInstall('/Users/r/.backstage-agent/npm/lib/node_modules/@stratpoint/backstage-agent', home, 'darwin'), { kind: 'installer', home: '/Users/r/.backstage-agent' });
  assert.deepEqual(detectInstall('/opt/homebrew/lib/node_modules/@stratpoint/backstage-agent', home, 'darwin'), { kind: 'npm-global', prefix: '/opt/homebrew' });
  assert.deepEqual(detectInstall('/Users/r/src/backstage-main/packages/backstage-agent', home, 'darwin'), { kind: 'other' });
});

test('an installer folder that is the filesystem root or the home itself is never accepted', () => {
  assert.notEqual(detectInstall('/npm/lib/node_modules/@stratpoint/backstage-agent', '/Users/r', 'linux').kind, 'installer');
  assert.notEqual(detectInstall('/Users/r/npm/lib/node_modules/@stratpoint/backstage-agent', '/Users/r', 'linux').kind, 'installer');
});

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uninstall-'));
  const homeDir = path.join(root, 'u');
  const home = path.join(homeDir, '.backstage-agent');
  const packageRoot = path.join(home, 'npm', 'lib', 'node_modules', '@stratpoint', 'backstage-agent');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  const launcher = path.join(home, 'bin', 'backstage-agent');
  fs.writeFileSync(launcher, '#!/bin/sh\n');
  fs.writeFileSync(path.join(home, 'config.json'), '{"login":1}');
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(home, 'logs', 'agent.log'), 'log');
  fs.writeFileSync(path.join(homeDir, '.zshrc'), `export A=1\n${BLOCK}# mine\n`);
  fs.writeFileSync(path.join(homeDir, '.bash_profile'), `${BLOCK}`);
  fs.mkdirSync(path.join(homeDir, '.config', 'fish', 'conf.d'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.config', 'fish', 'conf.d', 'backstage-agent.fish'), `${BLOCK}`);
  const bin = path.join(homeDir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(launcher, path.join(bin, 'backstage-agent'));
  fs.writeFileSync(path.join(home, 'links'), `${path.join(bin, 'backstage-agent')}\n`);
  const calls = { stopped: 0, npm: [] as string[] };
  const deps: UninstallDeps = {
    packageRoot,
    homeDir,
    env: {},
    platform: 'linux',
    stop: async () => {
      calls.stopped++;
      return { state: 'stopped', pid: 4242, forced: false };
    },
    npmUninstall: async prefix => {
      calls.npm.push(prefix);
    },
  };
  return { root, homeDir, home, deps, calls, bin, launcher };
}

test('installer layout: stops the agent, removes its link, its lines and its folders, keeps login, logs and the rest of each file', async () => {
  const s = sandbox();
  const r = await uninstall(s.deps);
  assert.deepEqual(r.problems, []);
  assert.equal(r.kind, 'installer');
  assert.equal(s.calls.stopped, 1);
  assert.equal(fs.existsSync(path.join(s.bin, 'backstage-agent')), false, 'link');
  assert.equal(fs.readFileSync(path.join(s.homeDir, '.zshrc'), 'utf8'), 'export A=1\n# mine\n');
  assert.equal(fs.readFileSync(path.join(s.homeDir, '.bash_profile'), 'utf8'), '');
  assert.equal(fs.existsSync(path.join(s.homeDir, '.config', 'fish', 'conf.d', 'backstage-agent.fish')), false);
  assert.equal(fs.existsSync(path.join(s.home, 'npm')), false);
  assert.equal(fs.existsSync(path.join(s.home, 'bin')), false);
  assert.equal(fs.existsSync(path.join(s.home, 'links')), false);
  assert.equal(fs.readFileSync(path.join(s.home, 'config.json'), 'utf8'), '{"login":1}');
  assert.equal(fs.readFileSync(path.join(s.home, 'logs', 'agent.log'), 'utf8'), 'log');
  assert.deepEqual(s.calls.npm, []);
  assert.ok(r.done.some(l => /Stopped the running agent \(PID 4242\)/.test(l)));
});

test('a link that someone pointed elsewhere is left alone', async () => {
  const s = sandbox();
  fs.rmSync(path.join(s.bin, 'backstage-agent'));
  fs.symlinkSync('/bin/true', path.join(s.bin, 'backstage-agent'));
  await uninstall(s.deps);
  assert.equal(fs.readlinkSync(path.join(s.bin, 'backstage-agent')), '/bin/true');
});

test('a startup file whose block was edited (no end marker) is left alone and reported', async () => {
  const s = sandbox();
  const edited = `export A=1\n${MARK_BEGIN}\nexport PATH=x\n# keep me\n`;
  fs.writeFileSync(path.join(s.homeDir, '.zshrc'), edited);
  const r = await uninstall(s.deps);
  assert.equal(fs.readFileSync(path.join(s.homeDir, '.zshrc'), 'utf8'), edited);
  assert.ok(r.problems.some(p => /\.zshrc/.test(p) && /by hand/.test(p)));
});

test('running it again when nothing is left does not fail', async () => {
  const s = sandbox();
  await uninstall(s.deps);
  const again = await uninstall({ ...s.deps, stop: async () => ({ state: 'not-running' }) });
  assert.deepEqual(again.problems, []);
});

test('a stop that fails is reported but the rest is still removed', async () => {
  const s = sandbox();
  const r = await uninstall({ ...s.deps, stop: async () => { throw new Error('EPERM'); } });
  assert.ok(r.problems.some(p => /Stopping the agent/.test(p) && /EPERM/.test(p)));
  assert.equal(fs.existsSync(path.join(s.home, 'npm')), false);
});

test('npm -g layout: stops the agent and runs npm uninstall for this copy, touches no startup file', async () => {
  const s = sandbox();
  const zshrc = fs.readFileSync(path.join(s.homeDir, '.zshrc'), 'utf8');
  const packageRoot = '/opt/homebrew/lib/node_modules/@stratpoint/backstage-agent';
  const r = await uninstall({ ...s.deps, packageRoot });
  assert.equal(r.kind, 'npm-global');
  assert.deepEqual(s.calls.npm, ['/opt/homebrew']);
  assert.equal(s.calls.stopped, 1);
  assert.equal(fs.readFileSync(path.join(s.homeDir, '.zshrc'), 'utf8'), zshrc);
  assert.equal(fs.existsSync(path.join(s.home, 'npm')), true);
});

test('npm uninstall failing is reported', async () => {
  const s = sandbox();
  const r = await uninstall({ ...s.deps, packageRoot: '/usr/local/lib/node_modules/@stratpoint/backstage-agent', npmUninstall: async () => { throw new Error('EACCES: permission denied'); } });
  assert.ok(r.problems.some(p => /Removing the agent with npm/.test(p) && /EACCES/.test(p)));
});

test('a copy that is neither installed by the installer nor by npm -g is not touched, and the agent is not stopped', async () => {
  const s = sandbox();
  const r = await uninstall({ ...s.deps, packageRoot: '/home/dev/backstage-main/packages/backstage-agent' });
  assert.equal(r.kind, 'other');
  assert.equal(s.calls.stopped, 0);
  assert.deepEqual(s.calls.npm, []);
  assert.equal(fs.existsSync(path.join(s.home, 'npm')), true);
});
