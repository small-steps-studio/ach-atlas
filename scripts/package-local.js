'use strict';
// Builds a LOCAL test package while the product ids are still placeholders. The package is for
// tests in a throw-away editor profile only and must never be uploaded; the release gate prints
// "NOT FOR PUBLISHING" during the build. For a real release use `npm run package`, which refuses
// placeholder ids.

const cp = require('node:child_process');
const path = require('node:path');

const env = Object.assign({}, process.env, { ACH_ATLAS_LOCAL_PACKAGE: '1' });
const r = cp.spawnSync('npx --yes @vscode/vsce package --no-dependencies', { cwd: path.join(__dirname, '..'), env: env, stdio: 'inherit', shell: true, windowsHide: true });
process.exit(r.status === null ? 1 : r.status);
