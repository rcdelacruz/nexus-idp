#!/usr/bin/env node
/* eslint-disable no-console -- a command-line script: printing is its output */
// Writes src/components/Root/themes.generated.css from the palettes in theme-utils.
//   node scripts/generate-theme-css.mjs          write the file
//   node scripts/generate-theme-css.mjs --check  exit 1 if the file is stale
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Plain Node (no bundler) cannot resolve workspace packages, so the two data/pure modules are imported by path.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import { PALETTES, THEME_IDS } from '../../theme-utils/src/palettes.ts';
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import { buildThemeCss } from '../../theme-utils/src/themeCss.ts';

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/components/Root/themes.generated.css');
const css = buildThemeCss(PALETTES, THEME_IDS);
if (process.argv.includes('--check')) {
  const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
  if (current !== css) { console.error('themes.generated.css is stale: run `yarn workspace app themes:css`'); process.exit(1); }
  console.log('themes.generated.css is up to date');
} else {
  writeFileSync(target, css);
  console.log(`wrote ${path.relative(process.cwd(), target)} (${THEME_IDS.length} themes)`);
}
