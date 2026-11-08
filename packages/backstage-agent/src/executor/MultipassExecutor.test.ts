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
  assert.deepEqual(steps, ['Creating the VM', 'Waiting for the VM to accept connections', 'Copying the lab files into the VM', 'Setting up the server', 'Saving a snapshot (for resets)', 'Starting the VM']);
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

// ── A failed attempt must not leave a VM behind ─────────────────────────────────────────────────

/** A stand-in Multipass: instances live in a set; `execFails` is the SSH error to answer `exec` with. */
function standIn(root: string, opts: { execFails?: () => string | undefined; seedExit?: number; instances?: string[]; deleteFails?: string; launchFailsAfterCreating?: string; infoFails?: string } = {}) {
  // A clock that only moves when the executor sleeps, so waiting minutes costs no real time.
  let now = 0;
  const instances = new Set<string>(opts.instances ?? []);
  const calls: string[] = [];
  const run: Run = async (cmd, args) => {
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const fail = (stderr: string) => ({ code: 2, stdout: '', stderr });
    if (cmd === 'ssh-keygen') {
      const f = args[args.indexOf('-f') + 1];
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'k');
      fs.writeFileSync(`${f}.pub`, 'pub');
      return ok();
    }
    calls.push(args.slice(0, 3).join(' '));
    switch (args[0]) {
      case 'version': return ok('multipass 1.14.0');
      case 'launch': {
        const n = args[args.indexOf('--name') + 1];
        if (instances.has(n)) return fail(`launch failed: instance "${n}" already exists`);
        instances.add(n);
        return opts.launchFailsAfterCreating ? fail(opts.launchFailsAfterCreating) : ok();
      }
      case 'exec': {
        const e = opts.execFails?.();
        if (e) return fail(e);
        return args.includes('sh') ? ok(`EXIT:${opts.seedExit ?? 0}\nseed said bye\n`) : ok();
      }
      case 'delete': {
        if (opts.deleteFails) return fail(opts.deleteFails);
        const n = args[args.length - 1];
        if (!instances.has(n)) return fail(`instance "${n}" does not exist`);
        instances.delete(n);
        return ok();
      }
      case 'info':
        if (opts.infoFails) return fail(opts.infoFails);
        if (!instances.has(args[1])) return fail(`info failed: instance "${args[1]}" does not exist`);
        return ok(JSON.stringify({ info: { [args[1]]: { ipv4: ['192.168.64.5'] } } }));
      default: return ok();
    }
  };
  const cm = { getTaskDir: (id: string) => { const d = path.join(root, id); fs.mkdirSync(d, { recursive: true }); return d; } } as any;
  const ex = new MultipassExecutor(cm, run, 'multipass', path.join(root, 'keys'), undefined, async ms => { now += ms; }, () => now);
  return { ex, instances, calls, folders: () => fs.readdirSync(root).filter(f => f !== 'keys'), keys: () => (fs.existsSync(path.join(root, 'keys')) ? fs.readdirSync(path.join(root, 'keys')) : []) };
}
const NAME = 'linux-capstone-a-jane-doe-20261103-1001';
const attempt = (id: string) => ({ task_id: id, resource_name: NAME, config: { vm: spec } }) as any;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mp-fail-'));

test('a step that fails after the VM was created deletes that VM, its key and its folder, and says so', async () => {
  const mp = standIn(tmp(), { execFails: () => "exec failed: ssh connection failed: 'Failed to connect: No route to host'" });
  const r = await mp.ex.executeTask(attempt('a1'));
  assert.equal(r.success, false);
  assert.match(r.error!, /Waiting for the VM to accept connections failed: .*No route to host/);
  assert.match(r.error!, /VPN software and firewalls as causes \(https:\/\/documentation\.ubuntu\.com\/multipass\/[^)]*\)\. The unfinished VM was deleted, so Retry starts clean\.$/);
  assert.deepEqual([...mp.instances], [], 'no VM left running');
  assert.deepEqual(mp.folders(), [], 'no lab folder left');
  assert.deepEqual(mp.keys(), [], 'no key left');
});

test('so the Retry that follows does not meet "instance already exists"', async () => {
  let down = true;
  const mp = standIn(tmp(), { execFails: () => (down ? "exec failed: ssh connection failed: 'Failed to connect: No route to host'" : undefined) });
  assert.equal((await mp.ex.executeTask(attempt('a1'))).success, false);
  down = false;
  const retry = await mp.ex.executeTask(attempt('a2'));
  assert.equal(retry.success, true, retry.error);
  assert.deepEqual([...mp.instances], [NAME]);
});

test('a VM that was not created by this attempt is never deleted ("already exists" belongs to someone else)', async () => {
  const mp = standIn(tmp(), { instances: [NAME] });
  const r = await mp.ex.executeTask(attempt('a2'));
  assert.equal(r.success, false);
  assert.match(r.error!, /Creating the VM failed: launch failed: instance ".*" already exists$/);
  assert.deepEqual([...mp.instances], [NAME], 'the existing VM is untouched');
  assert.ok(!mp.calls.some(c => c.startsWith('delete')), 'no delete was even attempted');
});

test('waits for a VM whose network is not up yet instead of failing on the first connection', async () => {
  let refusals = 3;
  const mp = standIn(tmp(), { execFails: () => (refusals-- > 0 ? "exec failed: ssh connection failed: 'Failed to connect: No route to host'" : undefined) });
  const progress: string[] = [];
  const r = await mp.ex.executeTask(attempt('a1'), phase => progress.push(phase));
  assert.equal(r.success, true, r.error);
  assert.ok(progress.includes('Waiting for the VM to accept connections'));
});

test('a seed that fails also leaves no VM behind, and the error keeps the seed\'s last line', async () => {
  const mp = standIn(tmp(), { seedExit: 3 });
  const r = await mp.ex.executeTask(attempt('a1'));
  assert.equal(r.success, false);
  assert.match(r.error!, /Setting up the server failed \(exit 3\): seed said bye\. The unfinished VM was deleted/);
  assert.deepEqual([...mp.instances], []);
});

test('says how to remove the VM by hand when it cannot be deleted', async () => {
  const mp = standIn(tmp(), { execFails: () => 'exec failed: boom', deleteFails: 'delete failed: daemon busy' });
  const r = await mp.ex.executeTask(attempt('a1'));
  assert.equal(r.success, false);
  assert.match(r.error!, new RegExp(`could not be deleted \\(delete failed: daemon busy\\); remove it with: multipass delete --purge ${NAME}`));
  assert.deepEqual([...mp.instances], [NAME], 'it is still there, and the message says how to remove it');
  assert.ok(mp.folders().length > 0, 'its lab folder is kept, so "Stop & remove" in the portal can still remove it');
});

test('a launch that fails after it created the VM (an initialisation timeout) is cleaned up too', async () => {
  const mp = standIn(tmp(), { launchFailsAfterCreating: 'launch failed: Timed out waiting for initialization to complete' });
  const r = await mp.ex.executeTask(attempt('a1'));
  assert.equal(r.success, false);
  assert.match(r.error!, /Timed out waiting for initialization to complete\. The unfinished VM was deleted/);
  assert.deepEqual([...mp.instances], []);
});

test('when Multipass cannot say whether the VM exists, a failed launch deletes nothing', async () => {
  const mp = standIn(tmp(), { infoFails: 'info failed: cannot connect to the multipass socket', launchFailsAfterCreating: 'launch failed: boom' });
  const r = await mp.ex.executeTask(attempt('a1'));
  assert.equal(r.success, false);
  assert.ok(!mp.calls.some(c => c.startsWith('delete')), 'no delete attempted');
  assert.deepEqual([...mp.instances], [NAME], 'left alone, since it may not be ours');
});

test('two long resource names that differ only at the end get different VM names', () => {
  const long = 'terraform-capstone-b-maria-theresa-fernandez-dela-cruz-santos';
  const a = instanceName(`${long}-20261103-1001`);
  const b = instanceName(`${long}-20261103-1544`);
  assert.notEqual(a, b);
  for (const n of [a, b]) assert.match(n, /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/);
  assert.ok(a.length <= 63 && b.length <= 63);
  assert.equal(instanceName(`${long}-20261103-1001`), a, 'stable for the same name');
  // short names and the usual lab names are unchanged
  assert.equal(instanceName('linux-capstone-a-jane-doe-20261103-1001'), 'linux-capstone-a-jane-doe-20261103-1001');
  assert.equal(instanceName('7-lab'), 'lab-7-lab');
});
