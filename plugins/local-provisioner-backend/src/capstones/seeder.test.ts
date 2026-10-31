import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { seedCapstone } from './seeder';
import { CapstoneDefinition } from './definitions';

/** A GitHub-style tarball (one top-level folder) of a tiny capstone with a stand-in seed script. */
function buildTarball(): { tarball: Buffer; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'capstone-fixture-'));
  const root = path.join(dir, 'strat-training-demo-capstone-abc123');
  mkdirSync(path.join(root, 'trainee-template', 'data'), { recursive: true });
  mkdirSync(path.join(root, 'instructor', 'seed'), { recursive: true });
  writeFileSync(path.join(root, 'trainee-template', 'README.md'), '# app\n');
  writeFileSync(path.join(root, 'CAPSTONE.md'), '# spec\n');
  mkdirSync(path.join(root, 'instructor', 'answer-keys'), { recursive: true });
  writeFileSync(path.join(root, 'instructor', 'answer-keys', 'key.md'), 'secret answers');
  writeFileSync(path.join(root, 'trainee-template', '.env'), 'JWT_SECRET="planted"\n');
  symlinkSync('/etc/passwd', path.join(root, 'trainee-template', 'evil-link'));
  // Stand-in for make_seed.mjs: seeds the app per trainee number and writes the instructor files.
  writeFileSync(
    path.join(root, 'instructor', 'seed', 'make_seed.mjs'),
    `import { writeFileSync } from 'node:fs';
     import { join } from 'node:path';
     const a = Object.fromEntries(process.argv.slice(2).map((v, i, arr) => v.startsWith('--') ? [v.slice(2), arr[i + 1]] : []).filter(x => x.length));
     writeFileSync(join(a.app, 'data', 'db.bin'), 'db-for-' + a.trainee);
     writeFileSync(join(a.app, 'HANDOVER.md'), 'handover ' + a.trainee);
     writeFileSync(join(a.out, 'seed-manifest.json'), JSON.stringify({ trainee: a.trainee, secretEnv: process.env.GITHUB_TOKEN ?? null }));
     writeFileSync(join(a.out, 'credentials.txt'), 'admin / pw-' + a.trainee);
     writeFileSync(join(a.out, 'handover-answer-key.md'), 'answers ' + a.trainee);
     console.error('ExperimentalWarning: SQLite is an experimental feature');`,
  );
  const tarPath = path.join(dir, 'x.tar.gz');
  execFileSync('tar', ['-czf', tarPath, '-C', dir, 'strat-training-demo-capstone-abc123']);
  return { tarball: readFileSync(tarPath), dir };
}

const def: CapstoneDefinition = {
  id: 'demo',
  title: 'Demo',
  sourceRepo: 'strat-training/demo-capstone',
  branch: 'main',
  templateDir: 'trainee-template',
  traineeDocs: ['CAPSTONE.md'],
  seedScript: 'instructor/seed/make_seed.mjs',
  seedArgs: (app, out, no) => ['--app', app, '--out', out, '--trainee', no],
  seedOutputs: { manifest: 'seed-manifest.json', credentials: 'credentials.txt', answerKey: 'handover-answer-key.md' },
  handout: { sourcePath: 'x', targetPath: 'y', branch: 'b', commitMessage: 'm', prTitle: 't', prBody: 'p' },
  gradeCommand: 'grade',
};

describe('seedCapstone', () => {
  let fixture: { tarball: Buffer; dir: string };
  beforeAll(() => {
    fixture = buildTarball();
  });
  afterAll(() => rmSync(fixture.dir, { recursive: true, force: true }));

  it('downloads, seeds per trainee number, and keeps instructor files out of the trainee repo', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fetchImpl = async (url: string, init?: any) => {
      calls.push({ url, headers: init?.headers });
      return { ok: true, status: 200, arrayBuffer: async () => fixture.tarball.buffer.slice(fixture.tarball.byteOffset, fixture.tarball.byteOffset + fixture.tarball.length) };
    };
    const tmpBefore = readdirSync(os.tmpdir()).filter(f => f.startsWith('capstone-seed-')).length;
    process.env.GITHUB_TOKEN = 'must-not-reach-the-seed';
    try {
      const r = await seedCapstone(def, '07', 'tok', fetchImpl as any);

      expect(calls[0].url).toBe('https://api.github.com/repos/strat-training/demo-capstone/tarball/main');
      expect(calls[0].headers?.Authorization).toBe('Bearer tok');
      expect(Buffer.from(r.files['data/db.bin'], 'base64').toString()).toBe('db-for-07');
      expect(Buffer.from(r.files['HANDOVER.md'], 'base64').toString()).toBe('handover 07');
      expect(r.files['.env']).toBeDefined(); // the planted fault ships on purpose
      expect(Buffer.from(r.files['.gitattributes'], 'base64').toString()).toContain('* text=auto eol=lf'); // Windows trainees
      expect(r.files['evil-link']).toBeUndefined(); // symlinks never copied
      expect(Buffer.from(r.files['CAPSTONE.md'], 'base64').toString()).toBe('# spec\n');
      expect(Object.keys(r.files).some(f => f.startsWith('instructor/') || f.includes('key.md'))).toBe(false);
      expect(Object.keys(r.files).some(f => /manifest|credentials|answer/.test(f))).toBe(false);
      expect(r.manifest).toEqual({ trainee: '07', secretEnv: null }); // seed runs with a minimal env
      expect(r.credentials).toBe('admin / pw-07');
      expect(r.answerKey).toBe('answers 07');
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
    expect(readdirSync(os.tmpdir()).filter(f => f.startsWith('capstone-seed-')).length).toBe(tmpBefore);
  });

  it('fails cleanly when the capstone repo cannot be downloaded', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(seedCapstone(def, '01', 'tok', fetchImpl as any)).rejects.toThrow(/Could not download .* \(404\)/);
  });
});
