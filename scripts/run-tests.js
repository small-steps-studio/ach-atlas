'use strict';
// Runs the unit tests: every test/*.test.js file, and nothing else. (Plain `node --test` would also
// run the helper modules in test/helpers as if they were test files and count them as tests.)
//   node scripts/run-tests.js [extra node --test arguments]

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const files = fs.readdirSync(path.join(ROOT, 'test')).filter(function (f) { return /\.test\.js$/.test(f); }).sort().map(function (f) { return path.join('test', f); });
const r = cp.spawnSync(process.execPath, ['--test'].concat(process.argv.slice(2), files), { cwd: ROOT, stdio: 'inherit', windowsHide: true });
process.exit(r.status === null ? 1 : r.status);
