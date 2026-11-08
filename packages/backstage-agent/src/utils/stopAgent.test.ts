import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stopAgent } from './stopAgent';

function pidFile(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stop-'));
  const file = path.join(dir, 'agent.pid');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}
const noSleep = async () => {};

test('no pid file: not running', async () => {
  assert.deepEqual(await stopAgent({ pidFile: pidFile(), kill: () => assert.fail('must not signal'), sleep: noSleep }), { state: 'not-running' });
});

test('a stale pid file (no such process) is removed and counts as not running', async () => {
  const file = pidFile('4242');
  const kill = (_pid: number) => { throw new Error('ESRCH'); };
  assert.deepEqual(await stopAgent({ pidFile: file, kill, sleep: noSleep }), { state: 'not-running' });
  assert.equal(fs.existsSync(file), false);
});

test('a running agent gets SIGTERM and stops on its own', async () => {
  const file = pidFile('4242');
  const sent: Array<string | number> = [];
  let alive = true;
  const kill = (_pid: number, sig: NodeJS.Signals | 0) => {
    sent.push(sig);
    if (sig === 'SIGTERM') alive = false;
    else if (!alive) throw new Error('ESRCH');
  };
  assert.deepEqual(await stopAgent({ pidFile: file, kill, sleep: noSleep }), { state: 'stopped', pid: 4242, forced: false });
  assert.deepEqual(sent.filter(s => s !== 0), ['SIGTERM']);
  assert.equal(fs.existsSync(file), false);
});

test('an agent that ignores SIGTERM is killed after the wait', async () => {
  const file = pidFile('4242');
  const sent: Array<string | number> = [];
  const kill = (_pid: number, sig: NodeJS.Signals | 0) => void sent.push(sig);
  assert.deepEqual(await stopAgent({ pidFile: file, kill, sleep: noSleep }), { state: 'stopped', pid: 4242, forced: true });
  assert.ok(sent.includes('SIGKILL'));
});

test('a pid file with 0, 1, a negative number or junk never signals anything', async () => {
  for (const content of ['0', '1', '-1', '-4242', 'abc', '']) {
    const file = pidFile(content);
    // Record every attempt: a mock that throws would be swallowed as "no such process" and hide a signal that was sent.
    const signalled: Array<[number, NodeJS.Signals | 0]> = [];
    const r = await stopAgent({ pidFile: file, kill: (pid, sig) => void signalled.push([pid, sig]), sleep: noSleep });
    assert.deepEqual(r, { state: 'not-running' }, content);
    assert.deepEqual(signalled, [], `signalled for pid file "${content}"`);
    assert.equal(fs.existsSync(file), false, content);
  }
});
