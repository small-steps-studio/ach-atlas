'use strict';
// Marketplace and house rules for the package, as tests. Each test is one rule; a failing test
// names the rule that would get the listing refused or would break a promise made to buyers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const contributes = pkg.contributes;
const config = require('../src/licence/config');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function listFiles(dir, out) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) listFiles(rel, out); else out.push(rel);
  }
  return out;
}

const VALID_CATEGORIES = ['Programming Languages', 'Snippets', 'Linters', 'Themes', 'Debuggers', 'Formatters', 'Keymaps', 'SCM Providers', 'Other', 'Extension Packs',
  'Language Packs', 'Visualization', 'Education', 'Testing'];

test('manifest has the fields the marketplace needs', () => {
  assert.equal(pkg.name, 'ach-atlas');
  assert.equal(pkg.displayName, 'ACH Atlas');
  assert.equal(pkg.publisher, 'SmallStepsStudio');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.engines.vscode, '^1.82.0');
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE.txt');
  assert.equal(pkg.icon, 'media/icon.png');
  assert.equal(pkg.main, './src/extension.js');
  assert.ok(pkg.description.length > 20 && pkg.description.length <= 200, 'description must be 21-200 characters: ' + pkg.description.length);
  assert.match(pkg.description, /only the licence check uses the network/);
  assert.match(pkg.homepage, /^https:\/\//);
  assert.equal(pkg.repository.url, 'https://github.com/small-steps-studio/ach-atlas');
  assert.equal(pkg.bugs.url, pkg.repository.url + '/issues');
  assert.equal(pkg.capabilities.untrustedWorkspaces.supported, true);
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
  assert.equal(pkg.devDependencies, undefined);
});

test('rule: the name does not use the name of the rules organisation', () => {
  assert.ok(!/nacha/i.test(pkg.displayName) && !/nacha/i.test(pkg.name));
  assert.ok(!/nacha/i.test(pkg.description));
});

test('rule: the pricing label is Trial (14-day Pro trial; Pro is sold outside the Marketplace)', () => {
  assert.equal(pkg.pricing, 'Trial');
});

test('rule: categories are valid and keywords stay within the limit of 30', () => {
  assert.ok(pkg.categories.length >= 1 && pkg.categories.length <= 3);
  for (const c of pkg.categories) assert.ok(VALID_CATEGORIES.includes(c), 'unknown category ' + c);
  assert.ok(pkg.keywords.length >= 1 && pkg.keywords.length <= 30);
  assert.equal(new Set(pkg.keywords.map((k) => k.toLowerCase())).size, pkg.keywords.length, 'keywords must be unique');
});

test('every file the manifest points to exists', () => {
  const files = [pkg.icon, pkg.main, 'README.md', 'CHANGELOG.md', 'LICENSE.txt', 'PRIVACY.md', 'TERMS.md', '.vscodeignore', 'language-configuration.json', 'media/activity.svg'];
  for (const g of contributes.grammars) files.push(g.path.replace(/^\.\//, ''));
  for (const w of contributes.walkthroughs) for (const s of w.steps) files.push(s.media.markdown);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), f + ' is missing');
  JSON.parse(read('syntaxes/ach.tmLanguage.json'));
  JSON.parse(read('language-configuration.json'));
});

test('the icon is a square PNG of at least 128x128 without metadata chunks', () => {
  const data = fs.readFileSync(path.join(root, 'media/icon.png'));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(data.readUInt32BE(16), data.readUInt32BE(20));
  assert.ok(data.readUInt32BE(16) >= 128);
  const chunks = [];
  let pos = 8;
  while (pos < data.length) { chunks.push(data.toString('ascii', pos + 4, pos + 8)); pos += 12 + data.readUInt32BE(pos); }
  for (const c of chunks) assert.ok(['IHDR', 'IDAT', 'IEND'].includes(c), 'unexpected chunk ' + c);
  assert.ok(data.length < 100 * 1024);
});

test('commands are namespaced, titled with the product name and unique', () => {
  const ids = contributes.commands.map((c) => c.command);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of contributes.commands) {
    assert.ok(c.command.startsWith(config.commandPrefix + '.'), c.command);
    assert.ok(c.title.startsWith(pkg.displayName + ': '), c.title);
  }
  for (const needed of ['buyPro', 'enterKey', 'licenceStatus', 'removeLicence', 'reportProblem', 'showDocumentation', 'openWalkthrough']) {
    assert.ok(ids.includes(config.commandPrefix + '.' + needed), 'command missing: ' + needed);
  }
  assert.equal(config.productName, pkg.displayName);
});

test('rule: every command titled (Pro) is gated, and no free command is', () => {
  const src = read('src/commands.js') + '\n' + read('src/procommands.js');
  for (const c of contributes.commands) {
    const start = src.indexOf("reg('" + c.command + "'");
    assert.ok(start !== -1, c.command + ' is not registered');
    const next = src.indexOf("\n  reg('", start + 5);
    const body = src.slice(start, next === -1 ? undefined : next);
    const gated = /requirePro\(/.test(body) || /return exportAs\(/.test(body);
    if (c.title.endsWith('(Pro)')) assert.ok(gated, c.command + ' must call requirePro');
    else assert.ok(!gated, c.command + ' is free and must not call requirePro');
  }
  assert.match(read('src/procommands.js'), /async function exportAs\(kind\) \{[\s\S]*?requirePro\(/);
});

test('rule: no setting can select the licence environment; every setting is documented', () => {
  const props = contributes.configuration.properties;
  for (const [key, d] of Object.entries(props)) {
    assert.ok(!/licen[cs]e|mode|environment/i.test(key), key + ' looks like a licence setting');
    assert.ok(key.startsWith(config.commandPrefix + '.'), key);
    assert.ok(d.markdownDescription || d.description, key + ' needs a description');
    assert.notEqual(d.default, undefined, key + ' needs a default');
    assert.ok(d.type, key);
  }
  const ext = require('../src/settings');
  for (const key of Object.keys(props)) assert.ok(Object.prototype.hasOwnProperty.call(ext.DEFAULTS, key.replace(/^achAtlas\./, '')), key + ' has no default in the code');
  for (const [key, value] of Object.entries(ext.DEFAULTS)) assert.deepEqual(props['achAtlas.' + key].default, value, key + ': manifest and code defaults differ');
});

test('rule: ACH files keep their trailing spaces and get a ruler at 94', () => {
  const d = contributes.configurationDefaults['[ach]'];
  assert.equal(d['files.trimTrailingWhitespace'], false);
  assert.deepEqual(d['editor.rulers'], [94]);
});

test('rule: the README documents every setting and every command', () => {
  const readme = read('README.md');
  for (const key of Object.keys(contributes.configuration.properties)) assert.ok(readme.includes('`' + key + '`'), key + ' is missing from the README');
  const hidden = (contributes.menus.commandPalette || []).filter((m) => m.when === 'false').map((m) => m.command);
  for (const c of contributes.commands) {
    if (hidden.includes(c.command)) continue;
    const short = c.title.replace(pkg.displayName + ': ', '').replace(/ \(Pro\)$/, '');
    assert.ok(readme.includes(short), 'README does not mention "' + short + '"');
  }
});

test('rule: README images are https links or relative paths, never http or SVG', () => {
  const readme = read('README.md');
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  assert.equal(images.length, 5);
  for (const src of images) {
    assert.ok(!/^http:\/\//i.test(src), 'http image: ' + src);
    assert.ok(!/\.svg(\?|#|$)/i.test(src), 'SVG image: ' + src);
    assert.match(src, /^media\/screenshots\/[a-z0-9-]+\.png$/);
  }
  assert.ok(!/<img\b/i.test(readme));
});

test('rule: the data disclosure is in the README and PRIVACY.md and the two agree', () => {
  const privacy = read('PRIVACY.md');
  const readme = read('README.md');
  for (const text of [privacy, readme]) {
    assert.match(text, /VS Code on <platform>/);
    assert.match(text, /no telemetry/i);
    assert.match(text, /24 hours/);
    assert.match(text, /14 days/);
    assert.match(text, /dodopayments\.com\/legal\/privacy-policy/);
    assert.match(text, /not anonymous/i);
    assert.match(text, /IP address/i);
    assert.match(text, /live\.dodopayments\.com/);
    assert.ok(!/test\.dodopayments\.com/.test(text), 'the test host is never named as a destination');
  }
  for (const heading of ['When it happens', 'What is sent', 'Who receives it']) assert.ok(readme.includes(heading), heading);
});

test('rule: independence from the rules organisation, and no claim of bank acceptance or compliance', () => {
  const readme = read('README.md');
  assert.match(readme, /independent product/i);
  assert.match(readme, /no affiliation/i);
  assert.match(readme, /no affiliation to, approval by or endorsement from Nacha/);
  assert.match(readme, /banks apply further rules/i);
  for (const f of ['README.md', 'CHANGELOG.md', 'TERMS.md', 'PRIVACY.md', 'LICENSE.txt'].concat(listFiles('docs', []))) {
    const text = read(f);
    assert.ok(!/\b(compliant|certified|guarantee[ds]? (?:acceptance|that)|approved by)\b/i.test(text), f + ' makes a compliance or acceptance claim');
    assert.ok(!/\brefund (?:within|guarantee)|money-back\b/i.test(text), f + ' promises a refund');
  }
});

test('rule: no claim about systems that were not tested', () => {
  for (const f of ['README.md', 'CHANGELOG.md']) {
    const text = read(f);
    assert.ok(!/runs on (Windows, )?macOS|(?<!not )tested on (macOS|Linux)|Node (20|22)/.test(text), f);
  }
  assert.match(read('README.md'), /It was not tested on macOS, Linux or in remote workspaces/);
});

test('rule: the licence file states the terms buyers rely on', () => {
  const text = read('LICENSE.txt');
  assert.match(text, /free features/i);
  assert.match(text, /paid licence key/i);
  assert.match(text, /redistribute/i);
  assert.match(text, /without warranty/i);
  assert.match(text, /no bundled third-party components/i);
  assert.match(text, /merchant of record/i);
});

test('prices, trial length and activation limit are the same in every text', () => {
  for (const f of ['README.md', 'TERMS.md', 'docs/licence.md']) {
    const text = read(f);
    assert.match(text, /USD 29/, f);
    assert.match(text, /USD 59 per user/, f);
    assert.match(text, /14-day/, f);
  }
  assert.equal(config.priceText, 'USD 29');
  assert.equal(config.businessPriceText, 'USD 59 per user');
});

test('shipped code has no console output, no dynamic code and no external dependencies', () => {
  const builtins = new Set(require('node:module').builtinModules);
  for (const f of listFiles('src', []).filter((x) => x.endsWith('.js'))) {
    const text = read(f);
    assert.ok(!/\bconsole\./.test(text), f + ' uses console');
    assert.ok(!/\beval\(|new Function\(|child_process/.test(text), f + ' runs dynamic code');
    for (const m of text.matchAll(/require\('([^']+)'\)/g)) {
      const name = m[1];
      assert.ok(name.startsWith('.') || name === 'vscode' || builtins.has(name) || builtins.has(name.replace(/^node:/, '')), f + ' requires ' + name);
    }
  }
});

test('floating-point parsing is never used for amounts, hashes or counts of a file', () => {
  for (const f of listFiles('src', []).filter((x) => x.endsWith('.js'))) {
    const text = read(f);
    assert.ok(!/parseFloat\(|toFixed\(/.test(text), f + ' uses floating point for values');
  }
});

test('the package is an allow-list and keeps notes, tests and tools out', () => {
  const ignore = read('.vscodeignore').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.equal(ignore[0], '**', 'everything is excluded unless listed');
  for (const entry of ignore.slice(1)) assert.ok(entry.startsWith('!'), entry);
  const allowed = ignore.slice(1).map((e) => e.slice(1));
  // Only the product itself is listed: the manifest, the public texts, the source, the grammar and the media the extension uses.
  const ok = [/^(package\.json|README\.md|CHANGELOG\.md|LICENSE\.txt|TERMS\.md|PRIVACY\.md|language-configuration\.json)$/, /^src\/\*\*$/, /^syntaxes\/\*\*$/, /^media\/(icon\.png|activity\.svg|walkthrough\/\*\*)$/];
  for (const entry of allowed) assert.ok(ok.some((re) => re.test(entry)), 'unexpected entry in the package list: ' + entry);
});

test('the repository ignore file keeps notes, packages, secrets and the local harness out of git', () => {
  const ignore = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  for (const entry of ['node_modules/', '*.vsix', '.env', '*.local.md', 'test/smoke/']) assert.ok(ignore.includes(entry), entry);
  // Working notes are kept out by a pattern, not by name: every Markdown file of the top folder except the public ones.
  for (const entry of ['/*.md', '!/README.md', '!/CHANGELOG.md', '!/TERMS.md', '!/PRIVACY.md']) assert.ok(ignore.includes(entry), entry);
});

test('the release scripts refuse a build with a bad or missing release setup', () => {
  assert.match(pkg.scripts['vscode:prepublish'], /release-gate\.js/);
  assert.match(read('scripts/release-gate.js'), /assertShippable/);
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.js');
});
