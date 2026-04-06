/**
 * Registers a file:// URL reader so scaffolder fetch:template can read
 * local skeleton directories during development.
 *
 * Used when ENGINEERING_STANDARDS_LOCAL_PATH is set in .env (local dev only).
 * Production uses GitHub URLs — this module is harmless but unused there.
 */
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { urlReaderFactoriesServiceRef } from '@backstage/backend-defaults/urlReader';
import fsExtra from 'fs-extra';
import nodePath from 'node:path';
import nodeOs from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const fsUrlReaderServiceFactory = createServiceFactory({
  service: urlReaderFactoriesServiceRef,
  deps: {},
  async factory() {
    return function fsReaderFactory() {
      return [
        {
          predicate: (url: URL) => url.protocol === 'file:',
          reader: {
            async readUrl(url: string) {
              const filePath = fileURLToPath(url);
              const content = await fsExtra.readFile(filePath);
              return {
                buffer: async () => content,
                stream: () => Readable.from(content),
                etag: undefined,
              };
            },
            async readTree(url: string) {
              const dirPath = fileURLToPath(url);

              async function walk(dir: string): Promise<{ path: string; data: Readable }[]> {
                const entries = await fsExtra.readdir(dir, { withFileTypes: true });
                const results: { path: string; data: Readable }[] = [];
                for (const entry of entries) {
                  const fullPath = nodePath.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    results.push(...await walk(fullPath));
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
                      for await (const chunk of f.data) chunks.push(chunk as Buffer);
                      return Buffer.concat(chunks);
                    },
                  }));
                },
                dir: async (opts?: { targetDir?: string }) => {
                  if (read) throw new Error('Response has already been read');
                  read = true; // set immediately before any await to prevent TOCTOU race
                  const targetDir = opts?.targetDir ?? await fsExtra.mkdtemp(
                    nodePath.join(nodeOs.tmpdir(), 'backstage-fs-')
                  );
                  for (const { path: relPath, data } of files) {
                    const dest = nodePath.join(targetDir, relPath);
                    await fsExtra.mkdir(nodePath.dirname(dest), { recursive: true });
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
  },
});
