import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, 'cli.js');
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Run the compiled CLI in a throwaway HOME so nothing real is touched. */
function run(args: string[]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-'));
  try {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH } });
    return { status: r.status, out: plain(`${r.stdout}${r.stderr}`) };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('--help lists the uninstall command and the --uninstall flag', () => {
  const { status, out } = run(['--help']);
  assert.equal(status, 0);
  assert.match(out, /^\s+uninstall\s+Remove the agent from this machine/m, 'in the Commands list');
  assert.match(out, /^\s+--uninstall\s+Remove the agent from this machine/m, 'in the Options list');
});

test('uninstall has its own help', () => {
  const { status, out } = run(['uninstall', '--help']);
  assert.equal(status, 0);
  assert.match(out, /Usage: backstage-agent uninstall/);
});

test('--uninstall and uninstall do the same thing; on a copy that was not installed they remove nothing and say so', () => {
  for (const args of [['--uninstall'], ['uninstall']]) {
    const { status, out } = run(args);
    assert.equal(status, 0, args.join(' '));
    assert.match(out, /nothing for --uninstall to remove/, args.join(' '));
  }
});
