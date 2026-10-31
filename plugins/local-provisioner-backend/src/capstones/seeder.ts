import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { CapstoneDefinition } from './definitions';

const execFileP = promisify(execFile);

export interface SeedResult {
  /** The seeded trainee repo: relative path → base64 content. Goes to the scaffolder workspace. */
  files: Record<string, string>;
  /** Instructor-only. Absent for laptop-seeded capstones (they report later). */
  manifest?: unknown;
  credentials?: string;
  answerKey?: string;
  /** Laptop-seeded capstones: the seed script(s) for the lab's one-shot seed container (basename → base64). */
  laptopSeedFiles?: Record<string, string>;
}

export type Fetch = (url: string, init?: { headers?: Record<string, string>; redirect?: 'follow' }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

/**
 * Added to a trainee repo when the capstone's template has none: trainees on Windows (Git's
 * core.autocrlf=true) would otherwise check scripts out with CRLF, which breaks them in Linux
 * containers and Git Bash ("$'\r': command not found").
 */
export const DEFAULT_GITATTRIBUTES = `# Keep LF line endings on every OS (scripts run in Linux containers / Git Bash / WSL).
* text=auto eol=lf
*.db binary
*.sqlite binary
*.png binary
*.jpg binary
*.zip binary
`;
const MAX_REPO_FILES = 2000;

/** Reads a directory into a path → base64 map, skipping symlinks and anything that isn't a regular file. */
export async function readTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let count = 0;
  const walk = async (dir: string, rel: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const st = await fs.lstat(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) await walk(abs, relPath);
      else if (st.isFile()) {
        if (++count > MAX_REPO_FILES) throw new Error(`Trainee template has more than ${MAX_REPO_FILES} files`);
        out[relPath] = (await fs.readFile(abs)).toString('base64');
      }
    }
  };
  await walk(root, '');
  return out;
}

/**
 * Seeds one trainee's copy of a capstone, entirely server-side:
 * 1. download the private capstone repo (tarball, integration token) and extract it to a temp dir;
 * 2. copy its trainee template to a temp app dir;
 * 3. run the capstone's own seed script with this backend's Node (`node:sqlite` is built in);
 * 4. return the seeded app files, plus the manifest/credentials/answer key, which never leave the
 *    server. Temp dirs are always removed.
 * Laptop-seeded capstones stop after step 2 and return the seed script for the lab instead.
 *
 * Only the capstone repo's own (instructor-authored) code runs here; nothing from a trainee.
 */
export async function seedCapstone(
  def: CapstoneDefinition,
  traineeNo: string,
  token: string | undefined,
  fetchImpl: Fetch = fetch as unknown as Fetch,
): Promise<SeedResult> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'capstone-seed-'));
  try {
    // 1. Tarball. GitHub answers with a redirect to codeload; fetch drops the Authorization header
    // on that cross-origin hop, which is what we want.
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nexus-idp-local-provisioner',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(
      `https://api.github.com/repos/${def.sourceRepo}/tarball/${encodeURIComponent(def.branch)}`,
      { headers, redirect: 'follow' },
    );
    if (!res.ok) throw new Error(`Could not download ${def.sourceRepo} (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_TARBALL_BYTES) throw new Error(`${def.sourceRepo} tarball is larger than 50 MB`);
    const tarPath = path.join(tmp, 'source.tar.gz');
    await fs.writeFile(tarPath, buf);
    const src = path.join(tmp, 'src');
    await fs.mkdir(src);
    // GitHub tarballs have one top-level folder (<owner>-<repo>-<sha>/); strip it.
    await execFileP('tar', ['-xzf', tarPath, '-C', src, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], {
      timeout: 60_000,
    });

    // 2. Trainee template → app dir. `cp -R` would follow nothing special; readTree below skips symlinks.
    const templateDir = path.join(src, def.templateDir);
    const app = path.join(tmp, 'app');
    await fs.cp(templateDir, app, { recursive: true, verbatimSymlinks: true });
    const attrs = path.join(app, '.gitattributes');
    if (!(await fs.stat(attrs).catch(() => undefined))) await fs.writeFile(attrs, DEFAULT_GITATTRIBUTES);
    for (const doc of def.traineeDocs) {
      if (doc.includes('/') || doc.startsWith('.')) throw new Error(`traineeDocs must be repo-root files: ${doc}`);
      await fs.copyFile(path.join(src, doc), path.join(app, doc));
    }

    // Laptop-seeded capstones (Terraform): the seed must run against the trainee's own MiniStack,
    // so nothing runs here — the lab gets the seed script and reports back with a single-use token.
    if (def.seedMode === 'laptop') {
      const laptopSeedFiles: Record<string, string> = {};
      for (const f of def.laptopSeedFiles ?? []) {
        if (f.startsWith('/') || f.split('/').includes('..')) throw new Error(`laptopSeedFiles must be repo-relative: ${f}`);
        laptopSeedFiles[path.basename(f)] = (await fs.readFile(path.join(src, f))).toString('base64');
      }
      return { files: await readTree(app), laptopSeedFiles };
    }

    // 3. Seed with this process's own Node binary; no shell, argument array only. Success is the
    // exit code — node:sqlite prints an ExperimentalWarning on stderr.
    const vault = path.join(tmp, 'vault');
    await fs.mkdir(vault);
    await execFileP(process.execPath, [path.join(src, def.seedScript), ...def.seedArgs(app, vault, traineeNo)], {
      cwd: src,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp },
    });

    // 4. Collect. The vault files are read and the whole temp dir is deleted in `finally`.
    const read = (f: string) => fs.readFile(path.join(vault, f), 'utf8');
    return {
      files: await readTree(app),
      manifest: JSON.parse(await read(def.seedOutputs.manifest)),
      credentials: await read(def.seedOutputs.credentials),
      answerKey: await read(def.seedOutputs.answerKey),
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
