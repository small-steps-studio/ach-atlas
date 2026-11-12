'use strict';
// Regression tests inside the stand-in editor and for the texts and scripts of the repository:
// a byte order mark that the editor hides, the formula setting, the licence key input, the trial end
// written down by the Pro gate, and the hygiene of the public files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./helpers/vscode-mock');
const samples = require('../src/samples');
const pkg = require('../package.json');
const { DEFAULTS } = require('../src/settings');
const { diagnosticsBlock } = require('../src/support');

const root = path.join(__dirname, '..');
const VALID = 'file:///work/payroll.ach';
const sample = samples.sampleFor('valid').text;

function start(options) {
  const o = options || {};
  const mock = M.createMock(Object.assign({ files: { [VALID]: sample }, active: VALID, folders: [{ uri: M.Uri.parse('file:///work'), name: 'work' }] }, o));
  const uninstall = M.install(mock.vscode);
  const srcDir = path.join(root, 'src');
  for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
  const ext = require('../src/extension');
  const context = M.makeContext(pkg, o.extensionMode);
  if (o.trialDaysAgo !== undefined) {
    const t = Date.now() - o.trialDaysAgo * 86400000;
    context.globalMap.set('trial.startedAt', t);
    context.globalMap.set('trial.lastSeenAt', t);
  }
  ext.activate(context);
  return { mock: mock, state: mock.state, context: context, uninstall: uninstall, run: (id, ...a) => mock.vscode.commands.executeCommand(id, ...a) };
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function codesOf(x, uri) { return (x.state.diagnostics.get(uri) || []).map((d) => d.code.value); }

// ---- defect 12: the byte order mark --------------------------------------------------------------------

test('a byte order mark that the editor removes from the text is reported from the file on disk', async () => {
  // The editor shows the mark as the encoding of the file and does not put it into the text.
  const x = start({ files: { [VALID]: '﻿' + sample } });
  try {
    x.state.documents[0].setText(sample);
    await wait(700);
    assert.deepEqual(codesOf(x, VALID), ['ACH-BOM']);
    const d = x.state.diagnostics.get(VALID)[0];
    assert.equal(d.severity, 1, 'a warning');
    assert.deepEqual([d.range.start.line, d.range.start.character], [0, 0]);
    assert.match(d.message, /byte order mark.*UTF-8/);
    await x.run('achAtlas.checkFile');
    assert.match(x.state.infoMessages.pop().text, /0 errors, 1 warnings and 0 notes/);
    // The file is saved without the mark: the next check no longer reports it.
    x.state.files.set(VALID, sample);
    await x.run('achAtlas.checkFile');
    assert.match(x.state.infoMessages.pop().text, /0 errors, 0 warnings and 0 notes/);
    assert.deepEqual(codesOf(x, VALID), []);
  } finally { x.uninstall(); }
});

test('the encoding that the editor reports is trusted when it is available', async () => {
  const x = start();
  try {
    const doc = x.state.documents[0];
    await wait(500);
    assert.deepEqual(codesOf(x, VALID), []);
    doc.encoding = 'utf8bom';
    await x.run('achAtlas.checkFile');
    assert.deepEqual(codesOf(x, VALID), ['ACH-BOM']);
    doc.encoding = 'utf8';
    await x.run('achAtlas.checkFile');
    assert.deepEqual(codesOf(x, VALID), []);
  } finally { x.uninstall(); }
});

test('a byte order mark that stays in the text is reported once', async () => {
  const x = start({ files: { [VALID]: '﻿' + sample } });
  try {
    await wait(700);
    assert.deepEqual(codesOf(x, VALID), ['ACH-BOM']);
  } finally { x.uninstall(); }
});

// ---- defect 9: the formula setting ------------------------------------------------------------------------

test('the formula setting is declared, documented, reported and honoured by the export', async () => {
  const prop = pkg.contributes.configuration.properties['achAtlas.export.neutraliseFormulas'];
  assert.equal(prop.type, 'boolean');
  assert.equal(prop.default, true);
  assert.equal(DEFAULTS['export.neutraliseFormulas'], true);
  assert.ok(fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes('`achAtlas.export.neutraliseFormulas`'));
  const block = diagnosticsBlock({ extensionVersion: '0.1.0', settings: { 'export.neutraliseFormulas': false }, defaults: DEFAULTS });
  assert.match(block, /export\.neutraliseFormulas = false/);
  const hostile = sample.replace('ALMA ASHGROVE         ', '=1+1                  ');
  for (const [setting, expected] of [[undefined, ",'=1+1,"], [false, ',=1+1,']]) {
    const target = M.Uri.parse('file:///work/out.csv');
    const cfg = setting === undefined ? {} : { 'achAtlas.export.neutraliseFormulas': setting };
    const x = start({ files: { [VALID]: hostile }, trialDaysAgo: 1, saveAnswers: [target], config: cfg });
    try {
      await x.run('achAtlas.exportCsv');
      assert.ok(x.state.written.get('file:///work/out.csv').includes(expected), 'setting ' + setting);
      const note = x.state.infoMessages.pop().text;
      assert.match(note, setting === undefined ? /start with an apostrophe/ : /Formula protection is off/);
    } finally { x.uninstall(); }
  }
});

// ---- defect 20: the licence key is masked while it is pasted ------------------------------------------------

test('Enter Licence Key asks for the key in a masked input', async () => {
  const x = start({ inputAnswers: [undefined] });
  try {
    await x.run('achAtlas.enterKey');
    assert.equal(x.state.inputOptions.length, 1);
    assert.equal(x.state.inputOptions[0].password, true);
  } finally { x.uninstall(); }
});

// ---- defect 5: the Pro gate writes down the end of the trial ---------------------------------------------------------

test('a Pro command after the trial writes down its end, so that a clock set back cannot reopen it', async () => {
  const x = start({ trialDaysAgo: 20 });
  try {
    await x.run('achAtlas.anonymise');
    assert.ok(x.context.globalMap.get('trial.expiredAt') > 0);
    assert.match(x.state.infoMessages[0].text, /trial ended/);
  } finally { x.uninstall(); }
});

// ---- cosmetic defects: texts and repository hygiene ---------------------------------------------------------------

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('README: the half-million-entry sentence names the setting; the independence statement appears once', () => {
  const readme = read('README.md');
  assert.match(readme, /half a million entries \(about 47 MB\) opens at once, after you raise `achAtlas\.maxFileSizeMB`/);
  const names = readme.slice(readme.indexOf('## Names'));
  assert.equal((names.match(/affiliat/g) || []).length, 1, 'one statement of independence');
  assert.match(readme, /addenda types and the common return reason codes and change codes/);
});

test('record layout documentation: every entry detail section says which SEC codes it covers', () => {
  const doc = read('docs/record-layouts.md');
  const headings = doc.match(/^## Entry detail.*$/gm);
  assert.equal(new Set(headings).size, headings.length, 'no two sections have the same title');
  for (const h of headings) {
    const body = doc.slice(doc.indexOf(h) + h.length).split(/\n## /)[0];
    assert.match(body.split('\n').slice(0, 4).join('\n'), /SEC code/, h + ' does not say which SEC codes it covers');
  }
});

test('Pro tools documentation names the entry kind "zero" as the export writes it', () => {
  const doc = read('docs/pro-tools.md');
  assert.match(doc, /kind \(live, prenote, zero, return\)/);
  const E = require('../src/pro/export');
  const P = require('../src/ach/parse');
  const zero = sample.split('\n');
  zero[2] = zero[2].slice(0, 1) + '24' + zero[2].slice(3, 29) + '0000000000' + zero[2].slice(39);
  const csv = E.toCsv(P.parseAch(zero.join('\n')));
  assert.ok(csv.split('\r\n')[1].includes(',zero,'));
});

test('hygiene: the repository files name no working note; notes are kept out by patterns', () => {
  const words = [['SP', 'EC'], ['STA', 'TUS'], ['TO', 'DO'], ['QA', '-'], ['RELEASE', '-NOTES']].map((p) => p.join(''));
  const re = new RegExp(words.join('|'));
  for (const f of ['.gitignore', '.vscodeignore', 'scripts/release-gate.js', 'scripts/check-vsix.js', 'scripts/run-tests.js', 'test/shell.package.test.js', '.github/workflows/ci.yml']) {
    assert.ok(!re.test(read(f)), f + ' names a working note');
  }
});

test('the test script runs the test files and nothing else', () => {
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.js');
  const script = read('scripts/run-tests.js');
  assert.match(script, /\.test\\\.js\$/);
  assert.ok(fs.readdirSync(path.join(root, 'test')).filter((f) => /\.test\.js$/.test(f)).length >= 10);
});
