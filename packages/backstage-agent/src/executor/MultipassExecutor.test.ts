import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { instanceName, MultipassExecutor, Run, SEED_RUNNER, validateVmSpec } from './MultipassExecutor';

const spec = {
  image: '24.04', cpus: 2, memoryGb: 4, diskGb: 40, sshUser: 'trainee',
  seedFiles: { 'run-seed.sh': 'ZWNobw==' }, seedCommand: ['bash', '/tmp/lab-seed/run-seed.sh'], seedEnv: { SEED_TOKEN: 't' },
};

test('accepts the Linux capstone VM spec and rejects unsafe ones', () => {
  assert.equal(validateVmSpec(spec), undefined);
  const bad: [string, any][] = [
    ['image with spaces', { ...spec, image: '24.04; rm' }],
    ['0 cpus', { ...spec, cpus: 0 }],
    ['huge memory', { ...spec, memoryGb: 512 }],
    ['seed file path', { ...spec, seedFiles: { '../x': 'eA==' } }],
    ['empty command', { ...spec, seedCommand: [] }],
    ['bad env key', { ...spec, seedEnv: { 'a b': 'x' } }],
    ['bad ssh user', { ...spec, sshUser: 'root;id' }],
  ];
  for (const [name, v] of bad) assert.notEqual(validateVmSpec(v), undefined, name);
});

test('derives a valid Multipass instance name', () => {
  assert.equal(instanceName('linux-capstone-mia-20261030-1730'), 'linux-capstone-mia-20261030-1730');
  assert.equal(instanceName('Linux_Capstone.Mia'), 'linux-capstone-mia');
  assert.equal(instanceName('7-lab'), 'lab-7-lab');
});

test('explains how to install Multipass when it is missing, without touching anything', async () => {
  const calls: string[] = [];
  const run: Run = async (cmd, args) => { calls.push(`${cmd} ${args[0]}`); return { code: 127, stdout: '', stderr: 'not found' }; };
  const cm = { getTaskDir: (id: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')), id) } as any;
  const ex = new MultipassExecutor(cm, run, 'multipass', fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')));
  const r = await ex.executeTask({ task_id: 't1', resource_name: 'linux-capstone-x', config: { vm: spec } } as any);
  assert.equal(r.success, false);
  assert.match(r.error!, /brew install --cask multipass/);
  assert.match(r.error!, /snap install multipass/);
  assert.deepEqual(calls, ['multipass version']);
});

test('an existing VM lab on a machine without Multipass: install steps, and the lab folder and key are kept', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-missing-'));
  const cm = { getTaskDir: (id: string) => path.join(root, id) } as any;
  fs.mkdirSync(cm.getTaskDir('t1'), { recursive: true });
  const keyPath = path.join(root, 'key');
  fs.writeFileSync(keyPath, 'private');
  fs.writeFileSync(path.join(cm.getTaskDir('t1'), 'multipass.json'), JSON.stringify({ instance: 'lab', sshUser: 'trainee', keyPath }));
  const run: Run = async () => ({ code: 1, stdout: '', stderr: '', missing: true });
  const ex = new MultipassExecutor(cm, run, 'multipass', root);
  for (const op of [() => ex.stopResource('t1'), () => ex.startResource('t1'), () => ex.cleanupTask('t1')]) {
    const r = await op();
    assert.equal(r.success, false);
    assert.match(r.error!, /not installed \(or not on your PATH\)[\s\S]*snap install multipass/);
  }
  assert.ok(fs.existsSync(path.join(cm.getTaskDir('t1'), 'multipass.json')), 'lab folder kept');
  assert.ok(fs.existsSync(keyPath), 'trainee key kept');
});

test('the real command runner flags a missing binary', async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const r = await runCmd('definitely-not-a-real-binary-xyz', ['version'], 5_000);
  assert.equal(r.missing, true);
});

test('runCmd streams output as it arrives and still returns all of it', async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const chunks: string[] = [];
  const r = await runCmd('sh', ['-c', 'printf "Retrieving image: 10%%\\r"; sleep 0.2; printf "Retrieving image: 60%%\\r"; sleep 0.2; echo Launched; echo oops >&2; exit 3'], 10_000, c => chunks.push(c));
  assert.equal(r.code, 3);
  assert.match(r.stdout, /Launched/);
  assert.match(r.stderr, /oops/);
  assert.ok(chunks.length >= 3, `streamed in ${chunks.length} chunks`);
});

test('runCmd kills a command that runs past its timeout', async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const t0 = Date.now();
  const r = await runCmd('sleep', ['30'], 500);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Timed out/);
  assert.ok(Date.now() - t0 < 5_000);
});

// A seed like the Linux capstone's: prints, leaves programs running (its planted lock holder), exits.
const LEAVES_PROGRAMS_RUNNING = 'echo planting faults; (sleep 300 &); nohup sleep 300 & echo done; exit 0';

test('the bug: a seed that leaves programs running never "finishes" when run on the connection itself', async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const r = await runCmd('bash', ['-c', LEAVES_PROGRAMS_RUNNING], 3_000);
  assert.match(r.stderr, /Timed out/, 'the command never returned — what hung the Linux lab');
});

// The seed runner only ever runs inside the lab's Ubuntu VM (it needs setsid, which macOS and
// Windows hosts don't have), so its real-process tests run on Linux only.
const IN_VM_OS = process.platform === 'linux' ? {} : { skip: 'the seed runner runs inside the Ubuntu VM; tested on Linux' };

test('the fix: the seed runner returns at once and the seed reports its exit code and output to files', IN_VM_OS, async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-run-'));
  const runner = path.join(dir, 'lab-run.sh');
  fs.writeFileSync(runner, SEED_RUNNER, { mode: 0o755 });
  const t0 = Date.now();
  const start = await (async () => {
    process.env.LAB_LOG_DIR = dir;
    try {
      return await runCmd('bash', [runner, 'SEED_DAYS=90', 'bash', '-c', `echo days=$SEED_DAYS; ${LEAVES_PROGRAMS_RUNNING}`], 10_000);
    } finally {
      delete process.env.LAB_LOG_DIR;
    }
  })();
  assert.equal(start.code, 0);
  assert.equal(start.stdout.trim(), 'started');
  assert.ok(Date.now() - t0 < 3_000, `returned in ${Date.now() - t0} ms`);
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'lab-seed.exit')); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.readFileSync(path.join(dir, 'lab-seed.exit'), 'utf8').trim(), '0');
  assert.equal(fs.readFileSync(path.join(dir, 'lab-seed.log'), 'utf8'), 'days=90\nplanting faults\ndone\n');
  await runCmd('pkill', ['-f', '^sleep 300$'], 5_000);
});

test('a failing seed fails the step with its exit code and last line', IN_VM_OS, async () => {
  const { runCmd } = await import('./MultipassExecutor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-fail-'));
  const runner = path.join(dir, 'lab-run.sh');
  fs.writeFileSync(runner, SEED_RUNNER, { mode: 0o755 });
  process.env.LAB_LOG_DIR = dir;
  await runCmd('bash', [runner, 'bash', '-c', 'echo pip failed >&2; exit 3'], 10_000);
  delete process.env.LAB_LOG_DIR;
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'lab-seed.exit')); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.readFileSync(path.join(dir, 'lab-seed.exit'), 'utf8').trim(), '3');
  assert.equal(fs.readFileSync(path.join(dir, 'lab-seed.log'), 'utf8'), 'pip failed\n');
});

/** A fake Multipass that runs the detached-seed protocol: polls answer with log lines, then an exit code. */
function fakeMultipass(polls: Array<{ exit: string; log: string }>, launchOutput: string[] = []) {
  const calls: string[][] = [];
  const run: Run = async (cmd, args, _t, onOutput) => {
    calls.push([cmd, ...args]);
    if (cmd === 'ssh-keygen') {
      const f = args[args.indexOf('-f') + 1];
      fs.writeFileSync(f, 'k');
      fs.writeFileSync(`${f}.pub`, 'ssh-ed25519 AAAA test');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'launch') launchOutput.forEach(c => onOutput?.(c));
    if (args[0] === 'exec' && args.includes('/tmp/lab-seed/lab-run.sh')) return { code: 0, stdout: 'started\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('sh')) {
      const p = polls.shift() ?? { exit: '0', log: '' };
      return { code: 0, stdout: `EXIT:${p.exit}\n${p.log}`, stderr: '' };
    }
    if (args[0] === 'info') return { code: 0, stdout: JSON.stringify({ info: { 'linux-capstone-x': { ipv4: ['192.168.64.5'] } } }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}
const noWait = async () => undefined;

test('a VM lab reports every step, the download percentage and the live seed output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-progress-'));
  const cm = { getTaskDir: (id: string) => path.join(root, id) } as any;
  const { run, calls } = fakeMultipass(
    [
      { exit: '', log: 'Setting up nginx (1.24.0) ...\n' },
      { exit: '', log: 'Setting up nginx (1.24.0) ...\n[seed] planted fault 3/14\n' },
      { exit: '0', log: '[lab] seeded and reported\n' },
    ],
    ['Retrieving image: 35%\r', 'Retrieving image: 80%\r', 'Launched: linux-capstone-x\n'],
  );
  const reports: Array<{ phase: string; detail?: any }> = [];
  const ex = new MultipassExecutor(cm, run, 'multipass', path.join(root, 'keys'), undefined, noWait);
  const r = await ex.executeTask({ task_id: 't1', resource_name: 'linux-capstone-x', config: { vm: spec } } as any, (phase, detail) =>
    reports.push({ phase, detail }),
  );
  assert.equal(r.success, true, r.error);
  const steps = reports.map(x => x.phase).filter((p, i, a) => p !== a[i - 1]);
  assert.deepEqual(steps, ['Creating the VM', 'Copying the lab files into the VM', 'Setting up the server', 'Saving a snapshot (for resets)', 'Starting the VM']);
  assert.deepEqual(reports.filter(x => x.phase === 'Creating the VM').map(x => x.detail?.progress?.percent).filter(Boolean), [35, 80]);
  const outputs = reports.filter(x => x.phase === 'Setting up the server' && x.detail?.output).map(x => x.detail.output);
  assert.deepEqual(outputs, ['Setting up nginx (1.24.0) ...', 'Setting up nginx (1.24.0) ...\n[seed] planted fault 3/14', '[lab] seeded and reported']);
  // The seed runs through the detached runner with its env and command, never directly on the connection.
  const start = calls.find(c => c.includes('/tmp/lab-seed/lab-run.sh'))!;
  assert.deepEqual(start.slice(start.indexOf('/tmp/lab-seed/lab-run.sh') + 1), ['SEED_TOKEN=t', 'bash', '/tmp/lab-seed/run-seed.sh']);
  assert.ok(calls.some(c => c[1] === 'transfer' && c[2].endsWith('lab-run.sh')), 'runner copied into the VM');
  assert.equal(r.connectionDetails?.host, '192.168.64.5');
});

test('a seed that exits non-zero fails the lab with its last line; a missed poll is retried', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-fail-'));
  const cm = { getTaskDir: (id: string) => path.join(root, id) } as any;
  const { run } = fakeMultipass([{ exit: '', log: 'installing\n' }, { exit: '3', log: 'installing\nERROR: pandas has no wheel\n' }]);
  let first = true;
  const flaky: Run = async (cmd, args, t, o) => {
    if (first && args[0] === 'exec' && args.includes('sh')) {
      first = false;
      return { code: 255, stdout: '', stderr: 'ssh: connect timed out' };
    }
    return run(cmd, args, t, o);
  };
  const reports: any[] = [];
  const ex = new MultipassExecutor(cm, flaky, 'multipass', path.join(root, 'keys'), undefined, noWait);
  const r = await ex.executeTask({ task_id: 't1', resource_name: 'linux-capstone-x', config: { vm: spec } } as any, (p, d) => reports.push([p, d]));
  assert.equal(r.success, false);
  assert.match(r.error!, /Setting up the server failed \(exit 3\): ERROR: pandas has no wheel/);
  assert.ok(reports.some(([, d]) => /could not reach the VM .* retrying; 1 so far/.test(d?.output ?? '')));
});

test('a seed that never finishes fails after the limit instead of hanging forever', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-limit-'));
  const cm = { getTaskDir: (id: string) => path.join(root, id) } as any;
  const polls = Array.from({ length: 1000 }, () => ({ exit: '', log: 'still going\n' }));
  const { run } = fakeMultipass(polls);
  let now = 0;
  const ex = new MultipassExecutor(cm, run, 'multipass', path.join(root, 'keys'), undefined, async ms => {
    now += ms;
  }, () => now);
  const r = await ex.executeTask({ task_id: 't1', resource_name: 'linux-capstone-x', config: { vm: spec } } as any);
  assert.equal(r.success, false);
  assert.match(r.error!, /exit 124/);
});
