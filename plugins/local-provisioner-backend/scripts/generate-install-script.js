#!/usr/bin/env node
/**
 * Embeds src/install/install.sh into src/install/installScript.generated.ts, so the backend can serve
 * it without reading a file that the build would not copy (same approach as the app's themes.generated.css).
 *
 *   yarn workspace @stratpoint/plugin-local-provisioner-backend gen:install          write it
 *   yarn workspace @stratpoint/plugin-local-provisioner-backend gen:install --check  fail when it is stale
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'install');
const body = fs.readFileSync(path.join(dir, 'install.sh'), 'utf8');
const out =
  '// Generated from install.sh by `gen:install` (scripts/generate-install-script.js). Do not edit.\n' +
  `export const INSTALL_SCRIPT = ${JSON.stringify(body)};\n`;
const target = path.join(dir, 'installScript.generated.ts');

if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== out) {
    console.error('installScript.generated.ts is out of date: run gen:install');
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, out);
}
