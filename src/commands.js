'use strict';
// Free commands (checks, navigation, totals, samples, help) and the licence and trial commands.
// The Pro commands are in procommands.js.

const config = require('./licence/config');
const messages = require('./licence/messages');
const { createUi } = require('./ui');
const { sampleFor } = require('./samples');
const { diagnosticsBlock, reportProblemText } = require('./support');
const D = require('./ach/describe');
const O = require('./ach/outline');
const V = require('./ach/values');
const providers = require('./providers');

const WALKTHROUGH_ID = 'SmallStepsStudio.ach-atlas#achAtlas.gettingStarted';

function registerCommands(app) {
  const vscode = app.vscode;
  const ui = createUi(app);
  app.ui = ui;
  const reg = ui.reg;
  const info = ui.info;
  const warn = ui.warn;
  const NAME = ui.NAME;
  const BUTTONS = ui.BUTTONS;

  function reveal(editor, offset, endOffset) {
    const doc = editor.document;
    const a = doc.positionAt(offset);
    const b = doc.positionAt(endOffset === undefined ? offset : endOffset);
    editor.selection = new vscode.Selection(a, b);
    editor.revealRange(new vscode.Range(a, b), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // ---- free commands -----------------------------------------------------------------------------
  reg('achAtlas.checkFile', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    if (app.diagnostics) await app.diagnostics.refreshEncoding(editor.document);
    const r = app.diagnostics ? app.diagnostics.run(editor.document, true) : null;
    if (!r || !r.counts) return;
    const t = r.totals;
    info(NAME + ': ' + r.counts.error + ' errors, ' + r.counts.warning + ' warnings and ' + r.counts.info + ' notes; ' + r.batches + ' batches, ' + t.entries + ' entries, debits ' + V.formatCents(t.debit) + ', credits ' + V.formatCents(t.credit) + '. These are format checks; your bank applies its own rules as well.');
    if (app.status) app.status.update();
  });

  reg('achAtlas.copyPath', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    const at = providers.locate(app, editor.document, editor.selection.active, true);
    if (!at) { warn('The cursor is not on a record.'); return; }
    const path = D.pathAt(at.parsed, at.record, at.column);
    await vscode.env.clipboard.writeText(path);
    vscode.window.setStatusBarMessage(NAME + ': copied ' + path, 4000);
  });

  reg('achAtlas.goToBatch', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    const parsed = app.parsedOf(editor.document, true);
    const list = O.batchList(parsed);
    if (!list.length) { warn('This file has no batches.'); return; }
    const pick = await vscode.window.showQuickPick(list, { placeHolder: 'Batch to go to', matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    const r = parsed.records;
    reveal(editor, r.starts[pick.record], r.starts[pick.record] + r.lengths[pick.record]);
  });

  reg('achAtlas.showTotals', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    const parsed = app.parsedOf(editor.document, true);
    const res = app.validateParsed(parsed);
    const t = res.totals;
    const lines = [NAME + ' totals (computed from the entries)', 'Batches: ' + parsed.structure.batches.length, 'Entries: ' + t.entries + ', addenda: ' + t.addenda,
      'Debits: ' + V.formatCents(t.debit), 'Credits: ' + V.formatCents(t.credit), 'Entry hash: ' + V.hashField(t.hash), 'Records up to the file control: ' + t.recordsToControl + ' (' + t.blocks + ' blocks)',
      'Problems: ' + res.counts.error + ' errors, ' + res.counts.warning + ' warnings, ' + res.counts.info + ' notes'];
    for (const b of O.batchList(parsed)) lines.push(b.label + ' (' + b.description + '): ' + b.detail);
    const pick = await info(NAME + ': ' + parsed.structure.batches.length + ' batches, ' + t.entries + ' entries, debits ' + V.formatCents(t.debit) + ', credits ' + V.formatCents(t.credit) + ', entry hash ' + V.hashField(t.hash) + '.', 'Copy Totals', 'Go To Batch');
    if (pick === 'Copy Totals') { await vscode.env.clipboard.writeText(lines.join('\n') + '\n'); vscode.window.setStatusBarMessage(NAME + ': totals copied', 4000); }
    else if (pick === 'Go To Batch') await vscode.commands.executeCommand('achAtlas.goToBatch');
  });

  reg('achAtlas.revealRecord', async function (uriText, record) {
    const uri = vscode.Uri.parse(String(uriText), true);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: true });
    const parsed = app.parsedOf(doc, true);
    const i = Math.max(0, Math.min(parsed.records.count - 1, Number(record) || 0));
    if (!parsed.records.count) return;
    reveal(editor, parsed.records.starts[i], parsed.records.starts[i] + parsed.records.lengths[i]);
  });

  reg('achAtlas.refreshOutline', function () { if (app.tree) app.tree.refresh(); });

  async function openSample(kind) {
    const s = sampleFor(kind);
    if (!s) { warn('This installation is incomplete; reinstall the extension.'); return; }
    await ui.openText(s.text, s.languageId, s.fileName);
    vscode.window.setStatusBarMessage(NAME + ': opened the ' + s.title + ' (invented data)', 5000);
  }
  reg('achAtlas.openSample', function () { return openSample('valid'); });
  reg('achAtlas.openSampleProblems', function () { return openSample('problems'); });
  reg('achAtlas.openWalkthrough', async function () { await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false); });
  reg('achAtlas.showDocumentation', async function () { await ui.openExternal(config.docsUrl); });

  reg('achAtlas.reportProblem', async function () {
    const editor = vscode.window.activeTextEditor;
    let active = null;
    if (editor) {
      const summary = app.diagnostics ? app.diagnostics.summaryOf(editor.document) : null;
      active = {
        kind: app.isAchDocument(editor.document) ? 'ACH file' : 'not an ACH file (' + editor.document.languageId + ')',
        size: app.lengthOf(editor.document),
        records: summary ? summary.records : undefined, counts: summary ? summary.counts : undefined, skipped: summary ? summary.skipped : undefined
      };
    }
    const block = diagnosticsBlock({
      extensionVersion: app.extensionVersion, editorName: vscode.env && vscode.env.appName, editorVersion: vscode.version, platform: process.platform,
      osRelease: app.osRelease(), arch: process.arch, nodeVersion: process.versions && process.versions.node, settings: app.settingsForReport(), defaults: app.defaults,
      licence: await app.licence.peek(), active: active
    });
    await vscode.env.clipboard.writeText(block);
    const opened = await ui.openExternal(config.issuesUrl);
    info(NAME + ': ' + reportProblemText(opened !== false));
  });

  // ---- licence commands ----------------------------------------------------------------------------
  reg('achAtlas.buyPro', async function () {
    const choice = await vscode.window.showQuickPick(messages.buyChoices(), { placeHolder: 'Which licence? Both unlock the same Pro features.', matchOnDescription: true, matchOnDetail: true });
    if (!choice) return;
    let users = 1;
    if (choice.tier === 'business') {
      const answer = await vscode.window.showInputBox({ title: NAME + ' Pro Business: ' + messages.businessUsersQuestion(), value: '1', ignoreFocusOut: true, validateInput: messages.businessUsersError });
      if (answer === undefined) return;
      if (messages.businessUsersError(answer)) { warn(messages.businessUsersError(answer) + ' The checkout page was not opened.'); return; }
      users = Number(String(answer).trim());
    }
    const url = app.licence.buyUrl(choice.tier, users);
    if (!url) { info(NAME + ': ' + choice.label + ' is not on sale yet. Please check the extension page again soon.'); return; }
    await ui.openExternal(url);
  });

  reg('achAtlas.enterKey', async function () {
    const raw = await vscode.window.showInputBox({
      title: NAME + ' Pro: paste the licence key from your purchase e-mail', placeHolder: 'Licence key', ignoreFocusOut: true, password: true,
      validateInput: function (v) { return /\s/.test((v || '').trim()) ? 'A licence key contains no spaces.' : null; }
    });
    const key = (raw || '').trim();
    if (!key) return;
    const result = await app.licence.activate(key);
    if (result.ok) info(NAME + ': ' + messages.activatedText(result.licenceType, result));
    else {
      const pick = await vscode.window.showErrorMessage(NAME + ': ' + messages.activationFailureText(result), BUTTONS.lost);
      if (pick === BUTTONS.lost) await ui.showLostKey();
    }
  });

  reg('achAtlas.licenceStatus', async function () {
    const st = await app.licence.status(true);
    const text = NAME + ': ' + messages.licenceStatusText(st);
    let pick;
    if (st.pro) pick = await info(text, BUTTONS.remove);
    else if (st.hasKey) pick = await info(text, BUTTONS.enter, BUTTONS.remove, BUTTONS.lost);
    else pick = await info(text, BUTTONS.buy, BUTTONS.enter, BUTTONS.lost);
    await ui.handleLicenceButton(pick);
  });

  reg('achAtlas.removeLicence', async function () {
    const st = await app.licence.peek();
    if (!st.hasKey) { info(NAME + ': No licence key is stored on this computer, so there is nothing to remove.'); return; }
    const pick = await vscode.window.showWarningMessage(NAME + ': ' + messages.removeConfirmText(), { modal: true }, BUTTONS.remove);
    if (pick !== BUTTONS.remove) return;
    const result = await app.licence.remove();
    info(NAME + ': ' + (result.deactivated
      ? 'The licence was removed from this computer and the activation was freed. You can enter the key on another computer now.'
      : 'The licence was removed from this computer. The licence server could not be reached, so the activation may still count against the limit of ' + config.activationLimit + '; if a later activation is refused, contact ' + config.supportContact() + '.'));
  });

  return ui.disposables;
}

module.exports = { registerCommands: registerCommands };
