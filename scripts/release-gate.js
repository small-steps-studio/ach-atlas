'use strict';
// Release gate: everything that must hold before a package is built.
//   node scripts/release-gate.js [--skip-tests] [--allow-placeholders]
// Exits with code 1 and a list of problems when anything fails.
//
// --allow-placeholders (or the environment variable ACH_ATLAS_LOCAL_PACKAGE=1, set by
// scripts/package-local.js) accepts the placeholder product ids, for a local test package that
// is never uploaded. Every other rule still applies, and the placeholders are listed.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];
function fail(text) { problems.push(text); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function listFiles(dir, out) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = (dir ? dir + '/' : '') + entry.name;
    if (entry.name === 'node_modules' || entry.name === '.git' || rel === 'test/.tmp') continue;
    if (entry.isDirectory()) listFiles(rel, out);
    else out.push(rel);
  }
  return out;
}

// .vscodeignore as an allow-list: the last pattern that matches decides; "!" includes.
function globRe(p) {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') { re += '.*'; i++; if (p[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function shippedBy(patterns, rel) {
  let ship = true;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const p = neg ? raw.slice(1) : raw;
    if (globRe(p).test(rel)) ship = neg;
  }
  return ship;
}

const argv = process.argv.slice(2);
const skipTests = argv.indexOf('--skip-tests') !== -1;
const allowPlaceholders = argv.indexOf('--allow-placeholders') !== -1 || process.env.ACH_ATLAS_LOCAL_PACKAGE === '1';
const pkg = JSON.parse(read('package.json'));

// 1. Unit tests.
if (!skipTests) {
  process.stdout.write('Running the unit suite...\n');
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js')], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const summary = (r.stdout || '').split('\n').filter(function (l) { return /^ℹ (tests|pass|fail|skipped) /.test(l); }).join(', ');
  process.stdout.write('  ' + summary + '\n');
  if (r.status !== 0) fail('the unit suite failed (' + summary + ')');
}

// 2. Licence configuration and manifest.
const config = require(path.join(ROOT, 'src/licence/config'));
try { config.assertShippable(pkg, { allowPlaceholders: allowPlaceholders }); } catch (e) { fail(e.message); }
const ph = config.placeholderIds();
if (ph.length && allowPlaceholders) notes.push('NOT FOR PUBLISHING: placeholder product ids accepted for a local package: ' + ph.join(', '));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail('version is not x.y.z');
if (pkg.pricing !== 'Trial') fail('pricing must be Trial (a 14-day trial of the Pro features is offered)');
if (pkg.keywords.length > 30) fail('more than 30 keywords');
if (pkg.dependencies || pkg.devDependencies) fail('the package must have no dependencies');
if (!read('CHANGELOG.md').includes('## ' + pkg.version)) fail('CHANGELOG.md has no entry for ' + pkg.version);
if (/\bnacha\b/i.test(pkg.displayName) || /\bnacha\b/i.test(pkg.name)) fail('the product name must not contain the name of the rules organisation');

// 3. Every problem code is documented, and every documented code exists.
const CODES = require(path.join(ROOT, 'src/ach/validate')).CODES;
const validateSource = read('src/ach/validate.js');
for (const m of validateSource.matchAll(/'(ACH-[A-Z0-9-]+)'/g)) if (!CODES[m[1]]) fail('src/ach/validate.js uses a code that is not in CODES: ' + m[1]);
const problemsDoc = read('docs/problems.md');
for (const code of Object.keys(CODES)) {
  if (!problemsDoc.includes('### ' + code + '\n')) fail('docs/problems.md has no section for ' + code);
  else {
    const section = problemsDoc.split('### ' + code + '\n')[1].split('\n')[0];
    const sev = { error: 'Error.', warning: 'Warning.', info: 'Note.' }[CODES[code]];
    if (!section.startsWith(sev)) fail('docs/problems.md gives ' + code + ' another severity than ' + CODES[code]);
  }
}
for (const m of problemsDoc.matchAll(/^### (ACH-[A-Z0-9-]+)$/gm)) if (!CODES[m[1]]) fail('docs/problems.md documents a code that does not exist: ' + m[1]);

// 4. Every field of every record layout is in docs/record-layouts.md.
const layouts = require(path.join(ROOT, 'src/ach/layout'));
const layoutDoc = read('docs/record-layouts.md');
for (const lay of layouts.ALL) {
  let covered = 0;
  for (const f of lay.fields) {
    const row = '| ' + (f.start === f.end ? f.start : f.start + '-' + f.end) + ' | ' + f.length + ' | ' + f.name + ' |';
    if (!layoutDoc.includes(row)) fail('docs/record-layouts.md lacks ' + lay.name + ': ' + f.name);
    if (f.start !== covered + 1) fail('layout ' + lay.name + ' has a gap or overlap before ' + f.name);
    covered = f.end;
  }
  if (covered !== 94) fail('layout ' + lay.name + ' does not end at position 94');
}

// 5. What would ship, secrets and private paths, line endings.
const ignore = read('.vscodeignore').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
const all = listFiles('', []);
const shipped = all.filter(function (f) { return shippedBy(ignore, f); });
// The package holds the product and nothing else: this list is the whole of it.
const PRODUCT_FILES = [/^(package\.json|README\.md|CHANGELOG\.md|LICENSE\.txt|TERMS\.md|PRIVACY\.md|language-configuration\.json)$/, /^src\/.+\.js$/, /^syntaxes\/[A-Za-z.]+\.json$/,
  /^media\/(icon\.png|activity\.svg)$/, /^media\/walkthrough\/[a-z-]+\.md$/];
for (const f of shipped) {
  if (!PRODUCT_FILES.some(function (re) { return re.test(f); })) fail('would ship a file that is not part of the product: ' + f);
}
for (const required of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE.txt', 'TERMS.md', 'PRIVACY.md', 'src/extension.js', 'media/icon.png', 'syntaxes/ach.tmLanguage.json', 'language-configuration.json']) {
  if (shipped.indexOf(required) === -1) fail('would not ship ' + required);
}
const textFiles = all.filter(function (f) { return /\.(md|json|js|txt|yml|svg|ach)$/.test(f); });
for (const f of textFiles) {
  const text = read(f);
  const tooling = /^(test|scripts)\//.test(f);
  if (/(sk|pk|lk)_(live|test)_[A-Za-z0-9]{16,}/.test(text)) fail(f + ' looks like it contains a secret');
  // The package knows the live licence environment only and reads no environment variable.
  if (shippedBy(ignore, f) && /\.(js|json|md|txt)$/.test(f) && /test\.(checkout\.)?dodopayments\.com|process\.env/.test(text)) fail(f + ' names a test licence address or reads an environment variable');
  if (/MOCK-KEY|_secrets|dodo_test_[a-z_]*key/.test(text) && !tooling) fail(f + ' refers to a test key or a secrets folder');
  if (/[A-Za-z]:\\Users\\|\/home\/[a-z]+\/|\/Users\/[a-z]+\//.test(text) && !tooling) fail(f + ' contains a private file path');
  if (/\r\n/.test(text) && !/^test\/fixtures\//.test(f)) fail(f + ' has CRLF line endings');
}

// 6. README, walkthrough media, screenshots, icon, legal texts.
const readme = read('README.md');
const props = pkg.contributes.configuration.properties;
const hidden = (pkg.contributes.menus.commandPalette || []).filter(function (m) { return m.when === 'false'; }).map(function (m) { return m.command; });
for (const c of pkg.contributes.commands) {
  if (hidden.indexOf(c.command) !== -1) continue;
  const t = c.title.replace(pkg.displayName + ': ', '').replace(/ \(Pro\)$/, '');
  if (!readme.includes(t)) fail('README does not mention the command ' + t);
}
for (const k of Object.keys(props)) if (!readme.includes('`' + k + '`')) fail('README does not document the setting ' + k);
for (const w of pkg.contributes.walkthroughs) for (const s of w.steps) if (!fs.existsSync(path.join(ROOT, s.media.markdown))) fail('walkthrough media missing: ' + s.media.markdown);
for (const m of readme.matchAll(/\]\((media\/screenshots\/[a-z0-9-]+\.png)\)/g)) {
  if (fs.existsSync(path.join(ROOT, m[1]))) continue;
  if (allowPlaceholders) notes.push('local package: README screenshot not taken yet: ' + m[1]);
  else fail('README screenshot missing: ' + m[1]);
}
for (const m of readme.matchAll(/\]\(((?:docs\/)?[A-Za-z-]+\.(?:md|txt))\)/g)) if (!fs.existsSync(path.join(ROOT, m[1]))) fail('README links to a missing file: ' + m[1]);
const icon = fs.readFileSync(path.join(ROOT, 'media/icon.png'));
if (icon.readUInt32BE(16) !== 128 || icon.readUInt32BE(20) !== 128) fail('media/icon.png must be 128 x 128');
for (const t of ['TERMS.md', 'PRIVACY.md', 'LICENSE.txt']) if (!fs.existsSync(path.join(ROOT, t))) fail(t + ' is missing');

for (const n of notes) process.stdout.write(n + '\n');
if (problems.length) {
  process.stdout.write('RELEASE GATE FAILED\n' + problems.map(function (p) { return '  - ' + p; }).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('RELEASE GATE PASSED (' + shipped.length + ' files would ship, ' + Object.keys(CODES).length + ' problem codes documented, ' + layouts.ALL.length + ' record layouts documented' + (allowPlaceholders && ph.length ? '; placeholder product ids accepted for a local package only' : '') + ')\n');
