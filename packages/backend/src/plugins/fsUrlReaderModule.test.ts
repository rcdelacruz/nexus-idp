import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createFsReaderFactory, resolveInside } from './fsUrlReaderModule';

/**
 * The file: URL reader exists only for local development and only inside ENGINEERING_STANDARDS_LOCAL_PATH. It used to be registered
 * always and read any path, which made the scaffolder's dry-run (inline template from the caller) a way for any engineer to read the
 * portal process's environment and the service-account token (audit 2026-11-07).
 */
describe('file: URL reader', () => {
  let root: string;
  let outside: string;
  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fsreader-'));
    root = path.join(base, 'standards');
    outside = path.join(base, 'secret');
    fs.mkdirSync(path.join(root, 'templates', 'a'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, 'templates', 'a', 'skeleton.txt'), 'inside');
    fs.writeFileSync(path.join(outside, 'token'), 'outside-secret');
    fs.symlinkSync(path.join(outside, 'token'), path.join(root, 'templates', 'a', 'link-to-secret'));
    fs.symlinkSync(outside, path.join(root, 'link-to-dir'));
  });
  afterAll(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));

  const reader = (r: string | undefined) => {
    const [entry] = createFsReaderFactory(r)();
    return entry as undefined | { predicate: (u: URL) => boolean; reader: any };
  };
  const url = (p: string) => pathToFileURL(p).toString();

  it('registers no reader at all when no local path is configured (production)', () => {
    expect(createFsReaderFactory(undefined)()).toEqual([]);
    expect(reader(undefined)).toBeUndefined();
  });

  it('reads a file and a tree inside the configured folder (the local-dev use)', async () => {
    const r = reader(root)!.reader;
    expect((await (await r.readUrl(url(path.join(root, 'templates', 'a', 'skeleton.txt')))).buffer()).toString()).toBe('inside');
    const files = await (await r.readTree(url(path.join(root, 'templates')))).files();
    expect(files.map((f: any) => f.path)).toEqual(['a/skeleton.txt']);
  });

  it.each(['/proc/self/environ', '/etc/passwd', os.homedir()])('refuses %s', async target => {
    await expect(reader(root)!.reader.readUrl(url(target))).rejects.toThrow(/Refusing to read outside/);
    await expect(reader(root)!.reader.readTree(url(target))).rejects.toThrow(/Refusing to read outside/);
  });

  it('refuses the in-cluster service-account token path (whether or not it exists on this machine)', async () => {
    const token = url('/var/run/secrets/kubernetes.io/serviceaccount/token');
    await expect(reader(root)!.reader.readUrl(token)).rejects.toThrow();
    await expect(reader(root)!.reader.readTree(token)).rejects.toThrow();
  });

  it('refuses a ../ path out of the folder and the sibling folder that shares the name prefix', async () => {
    await expect(reader(root)!.reader.readUrl(url(path.join(root, '..', 'secret', 'token')))).rejects.toThrow(/Refusing/);
    fs.mkdirSync(`${root}-evil`, { recursive: true });
    fs.writeFileSync(path.join(`${root}-evil`, 'x'), 'x');
    await expect(reader(root)!.reader.readUrl(url(path.join(`${root}-evil`, 'x')))).rejects.toThrow(/Refusing/);
  });

  it('does not follow a symlink that leads out, for a file, a directory or inside a tree', async () => {
    await expect(reader(root)!.reader.readUrl(url(path.join(root, 'templates', 'a', 'link-to-secret')))).rejects.toThrow(/Refusing/);
    await expect(reader(root)!.reader.readUrl(url(path.join(root, 'link-to-dir', 'token')))).rejects.toThrow(/Refusing/);
    const files = await (await reader(root)!.reader.readTree(url(path.join(root, 'templates')))).files();
    expect(files.map((f: any) => f.path)).not.toContain('a/link-to-secret');
  });

  it('resolveInside accepts the root itself and rejects a missing path', async () => {
    await expect(resolveInside(root, root)).resolves.toBeTruthy();
    await expect(resolveInside(root, path.join(root, 'nope'))).rejects.toThrow();
  });
});
