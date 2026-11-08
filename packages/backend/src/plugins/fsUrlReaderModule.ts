/**
 * Registers a file:// URL reader so scaffolder fetch:template can read
 * local skeleton directories during development.
 *
 * ONLY when ENGINEERING_STANDARDS_LOCAL_PATH is set (local dev), and ONLY inside that directory. It used to be registered always and
 * read any path: the scaffolder's dry-run takes an inline template from the caller, so any engineer could have a step read
 * /proc/self/environ (GITHUB_TOKEN, DB password, BACKEND_SECRET...) or the service-account token and get it back in the response
 * (audit 2026-11-07). Production sets no such variable, so no file: reader exists there.
 */
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { urlReaderFactoriesServiceRef } from '@backstage/backend-defaults/urlReader';
import fsExtra from 'fs-extra';
import nodePath from 'node:path';
import nodeOs from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/** The real path of `filePath`, refused unless it is `root` itself or inside it (symlinks resolved, so they cannot lead out). */
export async function resolveInside(
  root: string,
  filePath: string,
): Promise<string> {
  const [realRoot, real] = await Promise.all([
    fsExtra.realpath(root),
    fsExtra.realpath(filePath),
  ]);
  if (real !== realRoot && !real.startsWith(realRoot + nodePath.sep)) {
    throw new Error(`Refusing to read outside ${root}`);
  }
  return real;
}

/** The reader factory for `root`; no readers at all when `root` is not set. Exported for tests. */
export function createFsReaderFactory(root: string | undefined) {
  return function fsReaderFactory() {
    if (!root) return [];
    return [
      {
        predicate: (url: URL) => url.protocol === 'file:',
        reader: {
          async readUrl(url: string) {
            const filePath = await resolveInside(root, fileURLToPath(url));
            const content = await fsExtra.readFile(filePath);
            return {
              buffer: async () => content,
              stream: () => Readable.from(content),
              etag: undefined,
            };
          },
          async readTree(url: string) {
            const dirPath = await resolveInside(root, fileURLToPath(url));

            async function walk(
              dir: string,
            ): Promise<{ path: string; data: Readable }[]> {
              const entries = await fsExtra.readdir(dir, {
                withFileTypes: true,
              });
              const results: { path: string; data: Readable }[] = [];
              for (const entry of entries) {
                const fullPath = nodePath.join(dir, entry.name);
                // A symlink inside the tree could point anywhere: do not follow it.
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) {
                  results.push(...(await walk(fullPath)));
                } else {
                  const relPath = nodePath.relative(dirPath, fullPath);
                  const content = await fsExtra.readFile(fullPath);
                  results.push({ path: relPath, data: Readable.from(content) });
                }
              }
              return results;
            }

            const files = await walk(dirPath);
            let read = false;

            return {
              files: async () => {
                if (read) throw new Error('Response has already been read');
                read = true;
                return files.map(f => ({
                  path: f.path,
                  content: async () => {
                    const chunks: Buffer[] = [];
                    for await (const chunk of f.data)
                      chunks.push(chunk as Buffer);
                    return Buffer.concat(chunks);
                  },
                }));
              },
              dir: async (opts?: { targetDir?: string }) => {
                if (read) throw new Error('Response has already been read');
                read = true; // set immediately before any await to prevent TOCTOU race
                const targetDir =
                  opts?.targetDir ??
                  (await fsExtra.mkdtemp(
                    nodePath.join(nodeOs.tmpdir(), 'backstage-fs-'),
                  ));
                for (const { path: relPath, data } of files) {
                  const dest = nodePath.join(targetDir, relPath);
                  await fsExtra.mkdir(nodePath.dirname(dest), {
                    recursive: true,
                  });
                  const chunks: Buffer[] = [];
                  for await (const chunk of data) chunks.push(chunk as Buffer);
                  await fsExtra.writeFile(dest, Buffer.concat(chunks));
                }
                return targetDir;
              },
              archive: async () => {
                throw new Error('archive() not supported by FsUrlReader');
              },
              etag: '',
            };
          },
          async search() {
            throw new Error('search() not supported by FsUrlReader');
          },
        },
      },
    ];
  };
}

export const fsUrlReaderServiceFactory = createServiceFactory({
  service: urlReaderFactoriesServiceRef,
  deps: {},
  async factory() {
    return createFsReaderFactory(
      process.env.ENGINEERING_STANDARDS_LOCAL_PATH?.trim() || undefined,
    );
  },
});
