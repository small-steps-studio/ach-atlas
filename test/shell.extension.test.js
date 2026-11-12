'use strict';
// The extension inside a stand-in editor: activation, providers, free commands, the Pro gate and
// the trial, the Pro commands and the licence commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require('./helpers/vscode-mock');
const samples = require('../src/samples');
const pkg = require('../package.json');
const { codesOf } = require('./helpers/load');

const VALID = 'file:///work/payroll.ach';
const BROKEN = 'file:///work/broken.ach';
const TEXT = 'file:///work/export.txt';

function start(options) {
  const o = options || {};
  const mock = M.createMock(Object.assign({
    files: { [VALID]: samples.sampleFor('valid').text, [BROKEN]: samples.sampleFor('problems').text, [TEXT]: samples.sampleFor('valid').text },
    active: VALID, folders: [{ uri: M.Uri.parse('file:///work'), name: 'work' }]
  }, o));
  const uninstall = M.install(mock.vscode);
  const srcDir = path.join(__dirname, '..', 'src');
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
function doc(x, uri) { return x.state.documents.find((d) => d.uri.toString() === uri); }

test('activation registers every command of the manifest and nothing else', async () => {
  const x = start();
  try {
    const declared = pkg.contributes.commands.map((c) => c.command).sort();
    assert.deepEqual(Array.from(x.state.commands.keys()).sort(), declared);
    assert.ok(x.state.providers.hover && x.state.providers.symbols && x.state.providers.folding);
    assert.ok(x.state.trees['achAtlas.outline']);
    assert.ok(x.state.contentProviders['achatlas-preview']);
  } finally { x.uninstall(); }
});

test('plain text files that start with an ACH file header switch to the ACH language', async () => {
  const x = start();
  try {
    assert.deepEqual(x.state.languageChanges, ['ach']);
    assert.equal(doc(x, TEXT).languageId, 'ach');
  } finally { x.uninstall(); }
  const y = start({ config: { 'achAtlas.detectPlainText': false } });
  try { assert.deepEqual(y.state.languageChanges, []); } finally { y.uninstall(); }
});

test('problems appear with codes and links; the valid sample has none', async () => {
  const x = start();
  try {
    await wait(600);
    assert.deepEqual(x.state.diagnostics.get(VALID), []);
    const diags = x.state.diagnostics.get(BROKEN);
    assert.deepEqual(diags.map((d) => d.code.value).sort(), ['ACH-BATCH-HASH', 'ACH-EFFECTIVE-DATE', 'ACH-RDFI-CHECK-DIGIT', 'ACH-RECORD-LENGTH']);
    assert.match(diags[0].code.target.toString(), /^https:\/\/github\.com\/small-steps-studio\/ach-atlas\/blob\/HEAD\/docs\/problems\.md#ach-/);
    assert.ok(diags.every((d) => d.source === 'ACH Atlas'));
  } finally { x.uninstall(); }
});

test('hover, symbols, folding and the outline tree', async () => {
  const x = start();
  try {
    const d = doc(x, VALID);
    const offset = d.getText().split('\n').slice(0, 2).join('\n').length + 1 + 33;
    const hover = await x.state.providers.hover.provideHover(d, d.positionAt(offset));
    assert.match(hover.contents.value, /Entry detail: Amount[\s\S]*1,842\.50/);
    assert.equal(hover.contents.isTrusted, false);
    assert.equal(hover.contents.supportHtml, false);
    const symbols = x.state.providers.symbols.provideDocumentSymbols(d);
    assert.deepEqual(symbols.map((s) => s.name), ['File header', 'Batch 1: PPD HARBOR LANE CO', 'Batch 2: CCD HARBOR LANE CO', 'File control', 'Filler']);
    const folds = x.state.providers.folding.provideFoldingRanges(d);
    assert.deepEqual(folds.map((f) => [f.start, f.end]), [[1, 6], [7, 11]]);
    await wait(400);
    const tree = x.state.trees['achAtlas.outline'];
    const roots = tree.getChildren();
    assert.equal(roots.length, 5);
    const item = tree.getTreeItem(roots[1]);
    assert.equal(item.label, 'Batch 1: PPD HARBOR LANE CO');
    assert.deepEqual(item.command.arguments, [VALID, 1]);
    await x.run('achAtlas.revealRecord', VALID, 7);
    assert.equal(x.state.activeTextEditor.selection.start.line, 7);
  } finally { x.uninstall(); }
});

test('status bar: field at the cursor and file totals', async () => {
  const x = start();
  try {
    await wait(600);
    const editor = x.state.activeTextEditor;
    const p = editor.document.positionAt(94 + 1 + 94 + 1 + 34);
    editor.selection = new x.mock.vscode.Selection(p, p);
    await x.run('achAtlas.copyPath');
    assert.equal(x.state.clipboard, 'Batch 1 > Entry 1 > Amount (30-39)');
    await x.run('achAtlas.checkFile');
    assert.match(x.state.infoMessages.pop().text, /0 errors, 0 warnings and 0 notes; 2 batches, 5 entries, debits 15,620\.40, credits 4,966\.25\. These are format checks/);
    const totals = x.state.statusItems.find((i) => /batches/.test(i.text));
    assert.ok(totals && totals.visible, 'the totals item is shown');
    assert.match(totals.text, /2 batches · 5 entries · Dr 15,620\.40 · Cr 4,966\.25/);
  } finally { x.uninstall(); }
});

test('Go To Batch and Show File Totals', async () => {
  const x = start({ quickPickAnswers: [1], buttonAnswers: ['Copy Totals'] });
  try {
    await x.run('achAtlas.goToBatch');
    assert.equal(x.state.activeTextEditor.selection.start.line, 7);
    await x.run('achAtlas.showTotals');
    assert.match(x.state.infoMessages[0].text, /2 batches, 5 entries, debits 15,620\.40, credits 4,966\.25, entry hash 0288979342/);
    assert.match(x.state.clipboard, /Batch 2: CCD HARBOR LANE CO \(batch number 0000002 · effective 2026-11-16\): 2 entries, 1 addenda/);
  } finally { x.uninstall(); }
});

test('samples open as ACH files with invented data', async () => {
  const x = start();
  try {
    await x.run('achAtlas.openSampleProblems');
    const opened = x.state.openedDocs.pop();
    assert.equal(opened.uri.toString(), 'untitled:sample-with-problems.ach');
    assert.equal(opened.languageId, 'ach');
    assert.equal(codesOf(opened.getText()).errors.length, 4);
  } finally { x.uninstall(); }
});

test('commands on a file that is not an ACH file explain what they need', async () => {
  const x = start({ files: { 'file:///work/notes.md': '# notes' }, active: 'file:///work/notes.md' });
  try {
    x.state.documents[0].languageId = 'markdown';
    await x.run('achAtlas.copyPath');
    await x.run('achAtlas.fixControls');
    assert.equal(x.state.warningMessages.length, 2);
    assert.match(x.state.warningMessages[0].text, /needs an ACH file in the active editor/);
    assert.ok(!x.context.globalMap.has('trial.startedAt'), 'no trial is started for a command that could not run');
  } finally { x.uninstall(); }
});

test('the first Pro command starts the trial; Recompute Control Records previews and applies', async () => {
  const x = start({ active: BROKEN, buttonAnswers: [undefined, 'Apply'] });
  try {
    await x.run('achAtlas.fixControls');
    assert.match(x.state.infoMessages[0].text, /free 14-day trial of ACH Atlas Pro has started/);
    assert.ok(x.context.globalMap.has('trial.startedAt'));
    const diff = x.state.executed.find((e) => e.id === 'vscode.diff');
    assert.ok(diff, 'the difference is shown first');
    assert.equal(diff.args[0].toString(), BROKEN);
    assert.match(diff.args[1].toString(), /^achatlas-preview:/);
    const question = x.state.warningMessages[0];
    assert.match(question.text, /Apply these changes to the file\? 1 record padded with spaces to 94 characters\. Batch 2 control: entry hash 0114543535 to 0114543534\./);
    assert.deepEqual(question.rest.slice(0, 1), [{ modal: true }]);
    assert.equal(x.state.edits, 1);
    assert.deepEqual(codesOf(doc(x, BROKEN).getText()).errors, ['ACH-EFFECTIVE-DATE', 'ACH-RDFI-CHECK-DIGIT']);
  } finally { x.uninstall(); }
});

test('Recompute Control Records changes nothing without confirmation', async () => {
  const x = start({ active: BROKEN, trialDaysAgo: 1, buttonAnswers: [undefined, undefined] });
  try {
    const before = doc(x, BROKEN).getText();
    await x.run('achAtlas.fixControls');
    assert.equal(x.state.edits, 0);
    assert.equal(doc(x, BROKEN).getText(), before);
  } finally { x.uninstall(); }
});

test('after the trial a Pro command shows the Pro notice and does nothing else', async () => {
  const x = start({ trialDaysAgo: 20 });
  try {
    await x.run('achAtlas.anonymise');
    const msg = x.state.infoMessages[0];
    assert.match(msg.text, /Anonymise File is an ACH Atlas Pro feature\. Your 14-day trial ended/);
    assert.deepEqual(msg.buttons, ['Buy Pro', 'Enter Licence Key']);
    assert.equal(x.state.openedDocs.length, 0);
    assert.equal(x.state.written.size, 0);
  } finally { x.uninstall(); }
});

test('every Pro command is gated: after the trial none of them opens or writes anything', async () => {
  const x = start({ trialDaysAgo: 30, quickPickAnswers: [0, 0, 0, 0, 0], dialogAnswers: [[M.Uri.parse('file:///work')]] });
  try {
    const pro = pkg.contributes.commands.filter((c) => /\(Pro\)$/.test(c.title)).map((c) => c.command);
    assert.equal(pro.length, 10);
    for (const id of pro) await x.run(id);
    assert.equal(x.state.infoMessages.filter((m) => /is an ACH Atlas Pro feature/.test(m.text)).length, 10);
    assert.equal(x.state.openedDocs.length, 0);
    assert.equal(x.state.written.size, 0);
    assert.equal(x.state.edits, 0);
  } finally { x.uninstall(); }
});

test('Create Test File asks six questions and opens a valid file', async () => {
  const x = start({ trialDaysAgo: 1, quickPickAnswers: [1, 2, 0], inputAnswers: ['30', '2', '5.00-900.00', '261116'] });
  try {
    await x.run('achAtlas.generate');
    const out = x.state.openedDocs.pop();
    assert.equal(out.uri.toString(), 'untitled:test-ccd-30.ach');
    assert.deepEqual(codesOf(out.getText(), { checks: { effectiveDate: false } }), { errors: [], warnings: [], notes: [] });
    assert.match(x.state.infoMessages.pop().text, /test file with 30 invented entries in 2 batches/);
  } finally { x.uninstall(); }
});

test('Anonymise File opens a copy and reports what was replaced', async () => {
  const x = start({ trialDaysAgo: 1, quickPickAnswers: [0] });
  try {
    await x.run('achAtlas.anonymise');
    const copy = x.state.openedDocs.pop();
    assert.equal(copy.uri.toString(), 'untitled:payroll-anonymised.ach');
    assert.ok(!copy.getText().includes('ALMA ASHGROVE'));
    assert.deepEqual(codesOf(copy.getText()), { errors: [], warnings: [], notes: [] });
    assert.match(x.state.infoMessages.pop().text, /Replaced: 7 names, 5 account numbers, 5 identification numbers, 7 company names and identifications, 15 routing numbers, 2 free-text fields/);
  } finally { x.uninstall(); }
});

test('Anonymise Folder writes changed files only and reports unchanged and skipped ones', async () => {
  const files = {
    'file:///data/in/a.ach': samples.sampleFor('valid').text,
    'file:///data/in/sub/b.ach': samples.sampleFor('problems').text,
    'file:///data/in/readme.txt': 'not an ACH file\n'
  };
  const x = start({ files: files, active: undefined, trialDaysAgo: 1, dialogAnswers: [[M.Uri.parse('file:///data/in')]], quickPickAnswers: [0], buttonAnswers: [undefined, 'Write'] });
  try {
    await x.run('achAtlas.anonymiseFolder');
    assert.deepEqual(Array.from(x.state.written.keys()).sort(), ['file:///data/in-anonymised/a.ach', 'file:///data/in-anonymised/sub/b.ach']);
    const report = x.state.openedDocs.pop().getText();
    assert.match(report, /## Skipped[\s\S]*readme\.txt/);
    const last = x.state.warningMessages[x.state.warningMessages.length - 1].text;
    assert.match(last, /2 anonymised copies written; 0 file\(s\) unchanged \(nothing to replace, not written\); 1 file\(s\) skipped/);
  } finally { x.uninstall(); }
});

test('Anonymise Folder: an ACH file with nothing to replace is unchanged and not written', async () => {
  // A file header with blank destination, origin and names: an ACH file with nothing to replace.
  const bare = '101' + ' '.repeat(20) + '2611120915A094101' + ' '.repeat(54) + '\n';
  const files = { 'file:///data/in/bare.ach': bare };
  const x = start({ files: files, active: undefined, trialDaysAgo: 1, dialogAnswers: [[M.Uri.parse('file:///data/in')]], quickPickAnswers: [0] });
  try {
    await x.run('achAtlas.anonymiseFolder');
    assert.equal(x.state.written.size, 0);
    assert.match(x.state.warningMessages.pop().text, /No anonymised copy was written: 1 ACH file\(s\) had nothing to replace/);
  } finally { x.uninstall(); }
});

test('Compare With Another File opens a report', async () => {
  const x = start({ active: BROKEN, trialDaysAgo: 1, quickPickAnswers: [(i) => i.label === 'payroll.ach', []], buttonAnswers: [undefined] });
  try {
    await x.run('achAtlas.compare');
    const report = x.state.openedDocs.pop().getText();
    assert.match(report, /^# ACH comparison: payroll\.ach and broken\.ach/);
    assert.match(report, /File creation date|Batch header field/);
  } finally { x.uninstall(); }
});

test('Export Entries As CSV writes where the user chose', async () => {
  const target = M.Uri.parse('file:///work/out.csv');
  const x = start({ trialDaysAgo: 1, saveAnswers: [target] });
  try {
    await x.run('achAtlas.exportCsv');
    const csv = x.state.written.get('file:///work/out.csv');
    assert.equal(csv.split('\r\n').length, 7);
    assert.match(x.state.infoMessages.pop().text, /5 entries exported to out\.csv/);
  } finally { x.uninstall(); }
});

test('Split writes one file per batch after confirmation; Merge opens the result', async () => {
  const x = start({ trialDaysAgo: 1, dialogAnswers: [[M.Uri.parse('file:///work/parts')]], buttonAnswers: [undefined, 'Write'] });
  try {
    await x.run('achAtlas.split');
    assert.deepEqual(Array.from(x.state.written.keys()).sort(), ['file:///work/parts/payroll-batch-0000001.ach', 'file:///work/parts/payroll-batch-0000002.ach']);
    for (const t of x.state.written.values()) assert.deepEqual(codesOf(t), { errors: [], warnings: [], notes: [] });
  } finally { x.uninstall(); }
  const files = { 'file:///m/a.ach': samples.sampleFor('valid').text, 'file:///m/b.ach': samples.sampleFor('valid').text };
  const y = start({ files: files, active: undefined, trialDaysAgo: 1, dialogAnswers: [[M.Uri.parse('file:///m/b.ach'), M.Uri.parse('file:///m/a.ach')]] });
  try {
    await y.run('achAtlas.merge');
    const merged = y.state.openedDocs.pop();
    assert.equal(merged.uri.toString(), 'untitled:merged.ach');
    assert.deepEqual(codesOf(merged.getText()).errors, ['ACH-TRACE-DUPLICATE']);
    assert.match(y.state.infoMessages.pop().text, /2 files merged into one with 4 batches/);
  } finally { y.uninstall(); }
});

test('Reconciliation report for a folder opens HTML and CSV', async () => {
  const x = start({ trialDaysAgo: 1, dialogAnswers: [[M.Uri.parse('file:///work')]], quickPickAnswers: [2] });
  try {
    await x.run('achAtlas.reconcile');
    const csv = x.state.openedDocs.pop();
    const html = x.state.openedDocs.pop();
    assert.equal(html.uri.toString(), 'untitled:ach-reconciliation.html');
    assert.match(html.getText(), /<h1>ACH reconciliation: work<\/h1>/);
    assert.match(csv.getText(), /^Section,File/);
    assert.match(x.state.infoMessages.pop().text, /3 ACH files, 6 batches, 15 entries/);
  } finally { x.uninstall(); }
});

test('Buy Pro: Business asks for the number of users and opens the checkout with that quantity', async () => {
  const x = start({ quickPickAnswers: [1], inputAnswers: ['7'] });
  try {
    await x.run('achAtlas.buyPro');
    assert.deepEqual(x.state.opened, ['https://checkout.dodopayments.com/buy/pdt_0Nrn4FbqyfQSM3RYEI8Oq?quantity=7']);
  } finally { x.uninstall(); }
  const y = start({ quickPickAnswers: [0] });
  try {
    await y.run('achAtlas.buyPro');
    assert.deepEqual(y.state.opened, ['https://checkout.dodopayments.com/buy/pdt_0Nrn49ziRXQQeuqiOIsFX?quantity=1']);
  } finally { y.uninstall(); }
  const z = start({ quickPickAnswers: [1], inputAnswers: ['0'] });
  try {
    await z.run('achAtlas.buyPro');
    assert.deepEqual(z.state.opened, []);
    assert.match(z.state.warningMessages[0].text, /whole number from 1 to 100/);
  } finally { z.uninstall(); }
});

test('no way to the test licence server: not an installed copy, not a development host, not a variable or a setting', async () => {
  const saved = process.env.ACH_ATLAS_LICENCE_MODE;
  process.env.ACH_ATLAS_LICENCE_MODE = 'test';
  try {
    for (const mode of [1, 2, 3]) {
      const x = start({ quickPickAnswers: [0], extensionMode: mode, config: { 'achAtlas.licenceMode': 'test' } });
      try {
        await x.run('achAtlas.buyPro');
        assert.deepEqual(x.state.opened, ['https://checkout.dodopayments.com/buy/pdt_0Nrn49ziRXQQeuqiOIsFX?quantity=1'], 'extension mode ' + mode + ' stays on the live checkout');
      } finally { x.uninstall(); }
    }
  } finally {
    if (saved === undefined) delete process.env.ACH_ATLAS_LICENCE_MODE; else process.env.ACH_ATLAS_LICENCE_MODE = saved;
  }
});

test('Report A Problem copies no file names, values or keys and makes no licence request', async () => {
  const x = start({ config: { 'achAtlas.reconcile.include': 'secret-folder/**/*.ach' } });
  const realFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('offline'); };
  try {
    await x.context.secrets.store('licence.key.live', 'SECRET-KEY-1234');
    x.context.globalMap.set('licence.instanceId.live', 'lki_1');
    x.context.globalMap.set('licence.productId.live', 'pdt_0Nrn49ziRXQQeuqiOIsFX');
    await x.run('achAtlas.reportProblem');
    const block = x.state.clipboard;
    assert.match(block, /^ACH Atlas 0\.1\.0/);
    assert.match(block, /reconcile\.include = customised/);
    assert.match(block, /Licence: Pro key stored \(personal\), next check due, licence server: live/);
    for (const bad of ['payroll', 'HARBOR', 'ASHGROVE', 'SECRET', '1234', '/work/', 'secret-folder', '590123400']) assert.ok(!block.includes(bad), bad);
    assert.equal(requests, 0);
    assert.deepEqual(x.state.opened, ['https://github.com/small-steps-studio/ach-atlas/issues']);
  } finally { global.fetch = realFetch; x.uninstall(); }
});

test('Enter Licence Key without network reports it and stores nothing', async () => {
  const x = start({ inputAnswers: ['ABC-DEF'] });
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  try {
    await x.run('achAtlas.enterKey');
    assert.match(x.state.errorMessages[0].text, /could not be reached/);
    assert.equal(x.context.secretsMap.size, 0);
  } finally { global.fetch = realFetch; x.uninstall(); }
});

test('Remove Licence without a key says so and asks nothing', async () => {
  const x = start();
  try {
    await x.run('achAtlas.removeLicence');
    assert.match(x.state.infoMessages[0].text, /No licence key is stored/);
    assert.equal(x.state.warningMessages.length, 0);
  } finally { x.uninstall(); }
});
