// Run with: yarn build && node --test dist/executor/workspaceClone.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { ensureWorkspace, repoDirName, GitRunner } from './workspaceClone';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ws-'));

/** A real bare repo to clone from, served as a file path (git accepts it like a remote). */
function bareRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-src-'));
  execFileSync('git', ['init', '-q', '-b', 'main', path.join(dir, 'w')]);
  fs.writeFileSync(path.join(dir, 'w', 'README.md'), 'hi');
  execFileSync('git', ['-C', path.join(dir, 'w'), 'add', '-A']);
  execFileSync('git', ['-C', path.join(dir, 'w'), '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['clone', '-q', '--bare', path.join(dir, 'w'), path.join(dir, 'training-lab.git')]);
  return path.join(dir, 'training-lab.git');
}

/** Maps the https URL the portal sends to a local bare repo, so the real git binary does the work. */
const localGit = (bare: string): GitRunner => async (args, cwd) => {
  const mapped = args.map(a => (a === 'https://github.com/stratpoint-engineering/training-lab' ? bare : a));
  try {
    const out = execFileSync('git', mapped, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    // Make "origin" look like the https URL again for the reuse check.
    if (mapped[0] === 'clone') execFileSync('git', ['-C', mapped[mapped.length - 1], 'remote', 'set-url', 'origin', 'https://github.com/stratpoint-engineering/training-lab']);
    return { code: 0, stdout: out, stderr: '' };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: '', stderr: String(e.stderr ?? '') };
  }
};

const URL = 'https://github.com/stratpoint-engineering/training-lab';

test('clones into <root>/<repo> and reuses that clone the next time', async () => {
  const root = tmpRoot();
  const git = localGit(bareRepo());
  const first = await ensureWorkspace(URL, { root, git });
  assert.equal(first.status, 'cloned');
  assert.equal(first.path, path.join(root, 'training-lab'));
  assert.equal(fs.readFileSync(path.join(root, 'training-lab', 'README.md'), 'utf8'), 'hi');
  const again = await ensureWorkspace(URL, { root, git });
  assert.deepEqual([again.status, again.path], ['existing', path.join(root, 'training-lab')]);
});

test('never overwrites an unrelated folder: picks <repo>-2', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'training-lab'));
  fs.writeFileSync(path.join(root, 'training-lab', 'mine.txt'), 'keep me');
  const r = await ensureWorkspace(URL, { root, git: localGit(bareRepo()) });
  assert.equal(r.status, 'cloned');
  assert.equal(r.path, path.join(root, 'training-lab-2'));
  assert.equal(fs.readFileSync(path.join(root, 'training-lab', 'mine.txt'), 'utf8'), 'keep me');
});

test('a missing git login fails softly with a hint, and leaves nothing behind', async () => {
  const root = tmpRoot();
  const git: GitRunner = async args =>
    args[0] === 'clone'
      ? { code: 128, stdout: '', stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }
      : { code: 1, stdout: '', stderr: '' };
  const r = await ensureWorkspace(URL, { root, git });
  assert.equal(r.status, 'failed');
  assert.match(r.hint!, /gh auth login/);
  assert.equal(fs.existsSync(path.join(root, 'training-lab')), false);
});

test('skips anything that is not a plain https repo URL', async () => {
  assert.equal((await ensureWorkspace(undefined)).status, 'skipped');
  for (const bad of ['git@github.com:o/r.git', 'http://github.com/o/r', 'https://evil.example/o/r', 'https://github.com/o/r;rm -rf ~', 'https://github.com/o/..']) {
    assert.equal(repoDirName(bad), undefined, bad);
  }
  assert.equal(repoDirName('https://gitlab.example.com/strat/trainees/capstone-x.git'), 'capstone-x');
});

test('explains a not-found private repo as a pending invitation or wrong account', async () => {
  const { cloneFailureHint } = await import('./workspaceClone');
  assert.match(cloneFailureHint("remote: Repository not found.\nfatal: repository 'https://github.com/o/r/' not found"), /Accept the repository invitation/);
  assert.match(cloneFailureHint('fatal: could not read Username: terminal prompts disabled'), /gh auth login/);
  assert.match(cloneFailureHint('fatal: something else'), /Clone it yourself/);
});
