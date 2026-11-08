import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertSafeTaskId, ensurePrivateDir, isSafeTaskId, writePrivateFile } from './safeFiles';

const mode = (p: string) => fs.statSync(p).mode & 0o777;

test('a task id is a plain id: uuids and simple ids pass, anything that is a path does not', () => {
  for (const ok of ['0d7c1a46-9d2e-4c0e-9d57-5b0f3f6f8a11', 'task-1', 'T_2', 'a'.repeat(100)]) assert.equal(isSafeTaskId(ok), true, ok);
  for (const bad of ['', '..', '.', '../..', '../../projects/myapp', 'a/b', 'a\\b', '/etc', 'a.b', 'a b', 'a\0b', 'a'.repeat(101), '~', undefined, null, 5, {}, ['x']]) {
    assert.equal(isSafeTaskId(bad), false, String(bad));
    assert.throws(() => assertSafeTaskId(bad), /Invalid task id/);
  }
});

test('private folders are 0700 and private files 0600, and older, looser ones are tightened', { skip: process.platform === 'win32' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'safefiles-'));
  try {
    const dir = path.join(base, 'a', 'b');
    ensurePrivateDir(dir);
    assert.equal(mode(dir), 0o700);
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, 'old', { mode: 0o644 });
    fs.chmodSync(dir, 0o755);
    ensurePrivateDir(dir);
    writePrivateFile(file, 'new');
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(file), 0o600);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
