import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describePollError, isConnected, isConnecting, readConnectionState, recordContact, recordPollError, recordStart } from './connectionState';
import { timeAgo } from '../commands/status';
import { logoText } from './logo';

test('connection: a recent poll counts as connected, an old one or none does not', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  assert.equal(isConnected({ lastContactAt: '2026-10-30T23:59:30Z' }, now), true);
  assert.equal(isConnected({ lastContactAt: '2026-10-30T23:58:00Z' }, now), false);
  assert.equal(isConnected({}, now), false);
});

test('connection: the daemon records contact and errors in ~/.backstage-agent/connection.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-conn-'));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.deepEqual(readConnectionState(), {});
    recordContact(new Date('2026-10-31T00:00:00Z'));
    recordPollError('Cannot reach x: the connection was refused', new Date('2026-10-31T00:01:00Z'));
    assert.deepEqual(readConnectionState(), {
      lastContactAt: '2026-10-31T00:00:00.000Z',
      lastError: 'Cannot reach x: the connection was refused',
      lastErrorAt: '2026-10-31T00:01:00.000Z',
    });
    recordContact(new Date('2026-10-31T00:02:00Z')); // a success clears the error
    assert.deepEqual(readConnectionState(), { lastContactAt: '2026-10-31T00:02:00.000Z' });
  } finally {
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('poll errors read as one short line, never the whole URL', () => {
  const url = 'https://portal.example.com';
  assert.equal(describePollError({ code: 'ECONNREFUSED', message: 'request to https://portal.example.com/api/... failed' }, url), 'Cannot reach portal.example.com: the connection was refused');
  assert.match(describePollError({ code: 'ENOTFOUND' }, url), /could not be resolved/);
  assert.match(describePollError({ name: 'AbortError' }, url), /no answer/);
  assert.equal(describePollError({ code: 'EWEIRD' }, url), 'Cannot reach portal.example.com: EWEIRD');
});

test('status: relative times', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  assert.equal(timeAgo('2026-10-30T23:59:48Z', now), '12s ago');
  assert.equal(timeAgo('2026-10-30T23:56:00Z', now), '4m ago');
  assert.equal(timeAgo('2026-10-30T21:00:00Z', now), '3h ago');
  assert.equal(timeAgo('2026-10-28T00:00:00Z', now), '3d ago');
});

test('banner: shows the real version and nothing wider than 80 columns', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const version = require('../../package.json').version;
  const text = logoText().replace(/\u001b\[[0-9;]*m/g, '');
  assert.match(text, new RegExp(`Backstage Agent v${version.replace(/\./g, '\\.')}`));
  for (const line of text.split('\n')) assert.ok(line.length <= 80, `too wide: ${line}`);
});

test('connection: a fresh daemon is "connecting" until its first poll returns, then connected', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-conn-'));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  try {
    recordContact(new Date('2026-10-30T10:00:00Z')); // an old run's contact
    recordStart(new Date('2026-10-31T00:00:00Z'));
    const t5 = new Date('2026-10-31T00:00:05Z');
    assert.equal(isConnecting(readConnectionState(), t5), true);
    assert.equal(isConnected(readConnectionState(), t5), false);
    recordContact(new Date('2026-10-31T00:00:20Z'));
    assert.equal(isConnecting(readConnectionState(), new Date('2026-10-31T00:00:21Z')), false);
    assert.equal(isConnected(readConnectionState(), new Date('2026-10-31T00:00:21Z')), true);
    // never answering: after the window it is no longer "connecting"
    recordStart(new Date('2026-10-31T01:00:00Z'));
    assert.equal(isConnecting(readConnectionState(), new Date('2026-10-31T01:02:00Z')), false);
  } finally {
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
