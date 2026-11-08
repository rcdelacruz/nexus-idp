import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * launchDaemon in a throwaway HOME with a stored login, a fake Docker check and a fake spawn:
 * what it refuses, and what it starts the daemon with.
 */
async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-launch-'));
  const saved = process.env.HOME;
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, '.backstage-agent'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.backstage-agent', 'config.json'),
    JSON.stringify({ backstageUrl: 'https://portal.example.com', agentId: 'agent-1', serviceToken: 't', expiresAt: Date.now() + 3_600_000 }),
  );
  try {
    return await fn(home);
  } finally {
    process.env.HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function captureOutput(): { restore: () => string } {
  // The CLI helpers print with console.log only; stdout itself is left alone (node:test reports through it).
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(' '));
  return {
    restore: () => {
      console.log = log;
      return lines.join('\n');
    },
  };
}

test('Docker missing: nothing is started and the user is told what to install', async () => {
  await withHome(async () => {
    const { launchDaemon } = await import('./daemonLauncher');
    let spawned = 0;
    const cap = captureOutput();
    const r = await launchDaemon({ docker: async () => 'missing', spawnFn: (() => { spawned++; return { unref() {} }; }) as any });
    const out = cap.restore();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-docker');
    assert.equal(spawned, 0);
    assert.match(out, /Docker is not ready/);
    // Docker Desktop on macOS and Windows, Docker Engine on Linux (the text itself is tested in dockerCheck.test.ts).
    assert.match(out, process.platform === 'linux' ? /docs\.docker\.com\/engine\/install/ : /docker\.com\/products\/docker-desktop/);
    assert.match(out, /backstage-agent start/);
  });
});

test('Docker closed: nothing is started and the user is told to open it', async () => {
  await withHome(async () => {
    const { launchDaemon } = await import('./daemonLauncher');
    let spawned = 0;
    const cap = captureOutput();
    const r = await launchDaemon({ docker: async () => 'not-running', spawnFn: (() => { spawned++; return { unref() {} }; }) as any });
    const out = cap.restore();
    assert.equal(r.reason, 'no-docker');
    assert.equal(spawned, 0);
    assert.match(out, /Docker is installed but not running/);
  });
});

test('Docker ready: the daemon is started detached with the Node that is running now, not whatever "node" the PATH holds', async () => {
  await withHome(async home => {
    const { launchDaemon } = await import('./daemonLauncher');
    const calls: Array<{ command: string; args: string[]; options: any }> = [];
    const fakeSpawn = ((command: string, args: string[], options: any) => {
      calls.push({ command, args, options });
      fs.writeFileSync(path.join(home, '.backstage-agent', 'agent.pid'), String(process.pid)); // what the daemon does
      return { unref() {} };
    }) as any;
    const cap = captureOutput();
    const r = await launchDaemon({ docker: async () => 'ok', spawnFn: fakeSpawn });
    cap.restore();
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.match(calls[0].args[0], /agentDaemon\.js$/);
    assert.equal(calls[0].options.detached, true);
  });
});
