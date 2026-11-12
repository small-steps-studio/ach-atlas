'use strict';
// Checks the packaged .vsix: lists its files, refuses tests, scripts, documentation sources,
// screenshots, notes and secrets inside it, and confirms the manifest inside (version, pricing,
// engine).
//   node scripts/check-vsix.js [path/to/ach-atlas-x.y.z.vsix]
// A .vsix is a zip file; the central directory is read and entries are inflated with Node's zlib.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const file = process.argv[2] || path.join(ROOT, pkg.name + '-' + pkg.version + '.vsix');
const problems = [];
function fail(t) { problems.push(t); }

function readZip(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = b.readUInt16LE(eocd + 10);
  let pos = b.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(pos + 10);
    const compressedSize = b.readUInt32LE(pos + 20);
    const nameLength = b.readUInt16LE(pos + 28);
    const extraLength = b.readUInt16LE(pos + 30);
    const commentLength = b.readUInt16LE(pos + 32);
    const localOffset = b.readUInt32LE(pos + 42);
    const name = b.toString('utf8', pos + 46, pos + 46 + nameLength);
    const dataStart = localOffset + 30 + b.readUInt16LE(localOffset + 26) + b.readUInt16LE(localOffset + 28);
    const raw = b.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null;
    if (data === null) throw new Error('unsupported compression for ' + name);
    entries.push({ name: name, data: data });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const buf = fs.readFileSync(file);
const entries = readZip(buf);
const names = entries.map(function (e) { return e.name; });
process.stdout.write(names.map(function (n) { return '  ' + n; }).join('\n') + '\n');

// The package holds the product and nothing else: this list is the whole of it.
const PRODUCT_ENTRIES = [/^extension\/(package\.json|readme\.md|changelog\.md|LICENSE\.txt|TERMS\.md|PRIVACY\.md|language-configuration\.json)$/i, /^extension\/src\/.+\.js$/,
  /^extension\/syntaxes\/[A-Za-z.]+\.json$/, /^extension\/media\/(icon\.png|activity\.svg)$/, /^extension\/media\/walkthrough\/[a-z-]+\.md$/, /^extension\.vsixmanifest$/, /^\[Content_Types\]\.xml$/];
for (const n of names) if (!PRODUCT_ENTRIES.some(function (re) { return re.test(n); })) fail('the package contains a file that is not part of the product: ' + n);

const lower = names.map(function (n) { return n.toLowerCase(); });
const required = ['extension/package.json', 'extension/readme.md', 'extension/changelog.md', 'extension/LICENSE.txt', 'extension/TERMS.md', 'extension/PRIVACY.md',
  'extension/media/icon.png', 'extension/media/activity.svg', 'extension/src/extension.js', 'extension/src/procommands.js', 'extension/src/ach/validate.js',
  'extension/src/pro/anonymise.js', 'extension/syntaxes/ach.tmLanguage.json', 'extension/language-configuration.json', 'extension/media/walkthrough/open-sample.md', 'extension.vsixmanifest'];
for (const r of required) if (lower.indexOf(r.toLowerCase()) === -1) fail('the package lacks ' + r);
if (new Set(lower).size !== lower.length) fail('the package holds two entries whose names differ only in case');

let scanned = 0;
for (const e of entries) {
  if (/\.(png|ico)$/.test(e.name)) continue;
  scanned++;
  const text = e.data.toString('utf8');
  if (/MOCK-KEY|[A-Za-z]:\\Users\\|\/home\/[a-z]+\/|\/Users\/[a-z]+\//.test(text)) fail(e.name + ' contains a test key or a private path');
  if (/(sk|pk|lk)_(live|test)_[A-Za-z0-9]{16,}/.test(text)) fail(e.name + ' looks like it contains a secret');
  if (/test\.(checkout\.)?dodopayments\.com|process\.env/.test(text)) fail(e.name + ' names a test licence address or reads an environment variable');
}

const inner = entries.find(function (e) { return e.name === 'extension/package.json'; });
if (inner) {
  const manifest = JSON.parse(inner.data.toString('utf8'));
  if (manifest.version !== pkg.version) fail('version inside the package is ' + manifest.version);
  if (manifest.pricing !== 'Trial') fail('pricing inside the package is ' + manifest.pricing);
  if (manifest.engines.vscode !== '^1.82.0') fail('engine inside the package is ' + manifest.engines.vscode);
}
const vsixmanifest = entries.find(function (e) { return e.name === 'extension.vsixmanifest'; });
if (vsixmanifest) {
  const xml = vsixmanifest.data.toString('utf8');
  if (!/Pricing" Value="Trial"/.test(xml)) fail('extension.vsixmanifest does not carry Pricing=Trial');
  if (!/Microsoft\.VisualStudio\.Code\.ExecutesCode" Value="true"/.test(xml)) fail('ExecutesCode flag missing');
}

process.stdout.write(names.length + ' entries (' + scanned + ' text entries scanned), ' + Math.round(buf.length / 1024) + ' KB\n');
if (buf.length > 2 * 1024 * 1024) fail('the package is larger than 2 MB');
if (problems.length) {
  process.stdout.write('VSIX CHECK FAILED\n' + problems.map(function (p) { return '  - ' + p; }).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('VSIX CHECK PASSED: ' + path.basename(file) + '\n');
