import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('a task the agent was in the middle of is reported on the next start, once', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-'));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const { markRunning, clearRunning, takeInterrupted } = await import('./runningTasks');
    markRunning('ffa3a379-263b-47e6-a134-638e0048d5d7', 'linux-capstone-x');
    markRunning('aaaa-finished', 'ministack-y');
    clearRunning('aaaa-finished'); // finished normally
    markRunning('../../etc/passwd', 'evil'); // never a path
    const interrupted = takeInterrupted();
    assert.deepEqual(interrupted.map(t => [t.taskId, t.resourceName]), [['ffa3a379-263b-47e6-a134-638e0048d5d7', 'linux-capstone-x']]);
    assert.deepEqual(takeInterrupted(), [], 'reported once');
  } finally {
    process.env.HOME = prev;
  }
});
