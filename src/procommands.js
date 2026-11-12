'use strict';
// Pro commands: anonymise (file and folder), create test file, compare, export, reconciliation
// report, split, merge, recompute control records. Every command checks the licence or the trial
// first (requirePro) and writes files only after the user confirmed where.

const crypto = require('node:crypto');
const V = require('./ach/values');
const P = require('./ach/parse');
const U = require('./util');

// The Pro modules are loaded when first used, which keeps start-up light.
function loadPro(name) {
  switch (name) {
    case 'anonymise': return require('./pro/anonymise');
    case 'generate': return require('./pro/generate');
    case 'compare': return require('./pro/compare');
    case 'export': return require('./pro/export');
    case 'reconcile': return require('./pro/reconcile');
    case 'splitmerge': return require('./pro/splitmerge');
    case 'fixup': return require('./pro/fixup');
    default: throw new Error('unknown module ' + name);
  }
}

const PREVIEW_SCHEME = 'achatlas-preview';

function registerProCommands(app) {
  const vscode = app.vscode;
  const ui = app.ui;
  const before = ui.disposables.length;
  const reg = ui.reg;
  const info = ui.info;
  const warn = ui.warn;
  const NAME = ui.NAME;
  const requirePro = ui.requirePro;

  // Read-only documents for the preview of Recompute Control Records.
  const previews = new Map();
  const previewEmitter = new vscode.EventEmitter();
  if (vscode.workspace.registerTextDocumentContentProvider) {
    ui.disposables.push(vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      onDidChange: previewEmitter.event,
      provideTextDocumentContent: function (uri) { return previews.get(uri.toString()) || ''; }
    }));
  }

  async function readText(uri) {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  }
  // The editor hides a UTF-8 byte order mark from the text of a document; Compare compares it, so
  // it is put back in front of the text when the file has one.
  async function textWithMark(document) {
    const text = document.getText();
    if (text.charCodeAt(0) === 0xFEFF) return text;
    let mark = false;
    try { mark = !!(app.diagnostics && app.diagnostics.hasByteOrderMark && await app.diagnostics.hasByteOrderMark(document)); } catch (e) { mark = false; }
    return mark ? '﻿' + text : text;
  }
  async function exists(uri) {
    try { await vscode.workspace.fs.stat(uri); return true; } catch (e) { return false; }
  }
  function parentOf(uri) {
    const p = uri.path.replace(/\/+$/, '');
    const cut = p.lastIndexOf('/');
    return cut > 0 ? uri.with({ path: p.slice(0, cut) }) : null;
  }
  function lastSegment(uri) { const p = uri.path.replace(/\/+$/, ''); return p.slice(p.lastIndexOf('/') + 1); }

  // ---- Anonymise -----------------------------------------------------------------------------------
  async function askAmounts() {
    const pick = await vscode.window.showQuickPick([
      { label: 'Keep amounts', id: 'keep', detail: 'Names, accounts, identifications, routing numbers and free text are replaced; amounts stay as they are.' },
      { label: 'Replace amounts as well', id: 'replace', detail: 'Live entries get other amounts with the same number of digits; the control totals are adjusted.' }
    ], { placeHolder: 'Amounts in the anonymised copy' });
    return pick ? pick.id : null;
  }
  // One random 256-bit key per command run; it is never shown, stored or logged.
  function newKey() { return crypto.randomBytes(32); }

  reg('achAtlas.anonymise', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    if (!(await requirePro('Anonymise File'))) return;
    const amounts = await askAmounts();
    if (!amounts) return;
    const A = loadPro('anonymise');
    const original = editor.document.getText();
    // A file of many megabytes takes a few seconds: the progress notice is shown before the work starts.
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': anonymising the file' }, async function () {
      await new Promise(function (resolve) { setImmediate(resolve); });
      return A.createAnonymiser({ key: newKey(), amounts: amounts }).anonymise(original);
    });
    if (!res.changed) { warn('No value to replace was found in this file (no names, accounts, identifications or routing numbers), so no copy was made.'); return; }
    await ui.openText(res.text, 'ach', ui.baseName(editor.document.uri) + '-anonymised.ach');
    info(NAME + ': anonymised copy opened as a new, unsaved file. Replaced: ' + A.countsText(res.counts) + '. Dates, transaction codes and descriptions are kept' + (amounts === 'keep' ? ', and so are the amounts' : '') + '; check the copy before you share it.');
  });

  // Anonymise Folder works in two passes over the files, one at a time, so that no copy is kept in
  // memory: the first pass only counts, the second (after the confirmation) repeats the same run
  // with the same key, which gives the same replacements, and writes each copy at once.
  reg('achAtlas.anonymiseFolder', async function () {
    if (!(await requirePro('Anonymise Folder'))) return;
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Anonymise this folder' });
    if (!picked || !picked[0]) return;
    const folder = picked[0];
    const parent = parentOf(folder);
    if (!parent) { warn('Choose a folder below a drive or volume root; the copies are written next to it.'); return; }
    const amounts = await askAmounts();
    if (!amounts) return;
    const A = loadPro('anonymise');
    const s = app.getSettings();
    const target = vscode.Uri.joinPath(parent, lastSegment(folder) + '-anonymised');
    const runKey = newKey();
    const base = folder.path.replace(/\/+$/, '').length + 1;
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, s.reconcileInclude), '**/{node_modules,.git}/**', s.reconcileMaxFiles);
    files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });

    async function pass(write, progress, token) {
      const anonymiser = A.createAnonymiser({ key: runKey, amounts: amounts });
      const out = { copies: [], unchanged: [], skipped: [], failed: [] };
      for (const f of files) {
        if (token.isCancellationRequested) return null;
        const rel = f.path.slice(base);
        let text;
        try { text = await readText(f); } catch (e) { out.failed.push(rel); continue; }
        if (!P.looksLikeAch(text)) { out.skipped.push(rel); continue; }
        const res = anonymiser.anonymise(text);
        if (!res.changed) { out.unchanged.push(rel); continue; }
        if (write) {
          try {
            const uri = vscode.Uri.joinPath(target, ...rel.split('/'));
            const dir = parentOf(uri);
            if (dir && vscode.workspace.fs.createDirectory) await vscode.workspace.fs.createDirectory(dir);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(res.text, 'utf8'));
          } catch (e) { out.failed.push(rel); continue; }
        }
        out.copies.push({ rel: rel, counts: res.counts });
        progress.report({ message: rel });
      }
      return out;
    }

    const counted = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': reading the files', cancellable: true }, function (progress, token) { return pass(false, progress, token); });
    if (!counted) return;
    if (!counted.copies.length) {
      warn('No anonymised copy was written: ' + counted.unchanged.length + ' ACH file(s) had nothing to replace and ' + counted.skipped.length + ' file(s) are not ACH files.');
      return;
    }
    const existing = await exists(target);
    const ok = await vscode.window.showWarningMessage(NAME + ': Write ' + counted.copies.length + ' anonymised cop' + (counted.copies.length === 1 ? 'y' : 'ies') + ' to the folder "' + lastSegment(target) + '" next to the chosen folder?' + (existing ? ' The folder exists; files with the same names are replaced.' : ''), { modal: true }, 'Write');
    if (ok !== 'Write') return;
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': writing anonymised copies', cancellable: true }, function (progress, token) { return pass(true, progress, token); });
    if (!result) { warn('Stopped. The copies written so far are in the folder "' + lastSegment(target) + '".'); return; }
    const lines = ['# Anonymised copies', '', 'Written to `' + U.escapeMarkdown(lastSegment(target)) + '` next to the chosen folder.', '', '| File | Replaced |', '| --- | --- |'];
    for (const c of result.copies) lines.push('| ' + U.escapeMarkdown(c.rel) + ' | ' + U.escapeMarkdown(A.countsText(c.counts)) + ' |');
    if (result.unchanged.length) { lines.push('', '## Unchanged, not written', '', 'No value to replace was found in these ACH files, so no copy was written:', ''); for (const r of result.unchanged) lines.push('* ' + U.escapeMarkdown(r)); }
    if (result.skipped.length) { lines.push('', '## Skipped', '', 'These files do not start with an ACH file header:', ''); for (const r of result.skipped) lines.push('* ' + U.escapeMarkdown(r)); }
    if (result.failed.length) { lines.push('', '## Could not be read or written', ''); for (const r of result.failed) lines.push('* ' + U.escapeMarkdown(r)); }
    await ui.openText(lines.join('\n') + '\n', 'markdown', 'anonymise-report.md');
    const text = result.copies.length + ' anonymised copies written; ' + result.unchanged.length + ' file(s) unchanged (nothing to replace, not written); ' + result.skipped.length + ' file(s) skipped (not ACH files)' + (result.failed.length ? '; ' + result.failed.length + ' file(s) could not be read or written' : '') + '. The report lists every file.';
    if (result.unchanged.length || result.skipped.length || result.failed.length) warn(text); else info(NAME + ': ' + text);
  });

  // The seed of the invented values of a test file comes from the system's random source.
  function testSeed() { return crypto.randomInt(0, 2147483647); }

  // ---- Create Test File ------------------------------------------------------------------------------
  reg('achAtlas.generate', async function () {
    if (!(await requirePro('Create Test File'))) return;
    const G = loadPro('generate');
    const sec = await vscode.window.showQuickPick([
      { label: 'PPD', detail: 'Prearranged payments and deposits to consumer accounts (for example payroll)' },
      { label: 'CCD', detail: 'Corporate credits or debits between businesses' },
      { label: 'CTX', detail: 'Corporate trade exchange with remittance addenda' },
      { label: 'WEB', detail: 'Internet-initiated or mobile entries' },
      { label: 'TEL', detail: 'Telephone-initiated entries (debits only)' }
    ], { placeHolder: 'SEC code of the test file (step 1 of 6)' });
    if (!sec) return;
    let direction = 'debit';
    if (sec.label !== 'TEL') {
      const d = await vscode.window.showQuickPick([{ label: 'Credits', id: 'credit' }, { label: 'Debits', id: 'debit' }, { label: 'Mixed credits and debits', id: 'mixed' }], { placeHolder: 'Direction of the entries (step 2 of 6)' });
      if (!d) return;
      direction = d.id;
    }
    const countText = await vscode.window.showInputBox({ title: 'Number of entries (step 3 of 6)', value: '25', ignoreFocusOut: true, validateInput: function (v) { return /^[0-9]{1,6}$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= G.MAX_ENTRIES ? null : 'A whole number from 1 to ' + G.MAX_ENTRIES + '.'; } });
    if (countText === undefined) return;
    const count = Number(countText.trim());
    const batchText = await vscode.window.showInputBox({ title: 'Number of batches (step 4 of 6)', value: '1', ignoreFocusOut: true, validateInput: function (v) { const n = Number(String(v).trim()); return /^[0-9]{1,2}$/.test(String(v).trim()) && n >= 1 && n <= Math.min(G.MAX_BATCHES, count) ? null : 'A whole number from 1 to ' + Math.min(G.MAX_BATCHES, count) + '.'; } });
    if (batchText === undefined) return;
    const rangeError = function (v) {
      const m = /^\s*([0-9.,]+)\s*-\s*([0-9.,]+)\s*$/.exec(String(v));
      if (!m) return 'Two amounts with a hyphen, for example 10.00-2500.00.';
      const a = V.parseDecimal(m[1]);
      const b = V.parseDecimal(m[2]);
      if (a === null || b === null || a < 1n || b < a) return 'Two amounts from 0.01 upwards, the smaller first, at most two decimals.';
      return null;
    };
    const rangeText = await vscode.window.showInputBox({ title: 'Amount range per entry (step 5 of 6)', value: '10.00-2500.00', ignoreFocusOut: true, validateInput: rangeError });
    if (rangeText === undefined) return;
    const m = /^\s*([0-9.,]+)\s*-\s*([0-9.,]+)\s*$/.exec(rangeText);
    const today = V.localDay(new Date());
    const nextBusinessDay = V.yymmddOfDay(V.nextWeekday(today));
    const dateText = await vscode.window.showInputBox({ title: 'Effective entry date, YYMMDD (step 6 of 6)', value: nextBusinessDay, ignoreFocusOut: true, validateInput: function (v) { return V.parseYYMMDD(String(v).trim()) ? null : 'A valid date as YYMMDD, for example ' + nextBusinessDay + '.'; } });
    if (dateText === undefined) return;
    const addenda = sec.label === 'TEL' ? false : (await vscode.window.showQuickPick([{ label: 'With addenda records', id: true }, { label: 'Without addenda records', id: false }], { placeHolder: 'Addenda (payment related information)' }) || {}).id;
    if (addenda === undefined) return;
    const now = new Date();
    const created = { date: V.yymmddOfDay(today), time: String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') };
    const eolSetting = vscode.workspace.getConfiguration('files').get('eol');
    const res = G.generate({ sec: sec.label, direction: direction, count: count, batches: Number(batchText.trim()), min: V.parseDecimal(m[1]), max: V.parseDecimal(m[2]), effectiveDate: dateText.trim(), created: created, addenda: addenda, seed: testSeed(), lineBreak: eolSetting === '\r\n' ? '\r\n' : '\n' });
    if (!res.ok) { warn(res.reason); return; }
    await ui.openText(res.text, 'ach', 'test-' + sec.label.toLowerCase() + '-' + count + '.ach');
    info(NAME + ': test file with ' + count + ' invented entries in ' + res.summary.batches + ' batch' + (res.summary.batches === 1 ? '' : 'es') + ' (debits ' + V.formatCents(res.summary.debit) + ', credits ' + V.formatCents(res.summary.credit) + '). The routing numbers are invented; replace them with your bank\'s test numbers where needed.');
  });

  // ---- Compare -------------------------------------------------------------------------------------
  let lastComparison = null;
  reg('achAtlas.compare', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    if (!(await requirePro('Compare With Another File'))) return;
    const others = vscode.workspace.textDocuments.filter(function (d) { return d !== editor.document && app.isAchDocument(d); })
      .map(function (d) { return { label: vscode.workspace.asRelativePath(d.uri, false), description: 'open editor', document: d }; });
    const pick = await vscode.window.showQuickPick(others.concat([{ label: 'Browse...', description: 'pick a file', browse: true }]), { placeHolder: 'The FIRST (older) file; the active file is the second' });
    if (!pick) return;
    let otherText;
    let otherLabel;
    if (pick.browse) {
      const files = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare' });
      if (!files || !files[0]) return;
      otherText = await readText(files[0]);
      otherLabel = vscode.workspace.asRelativePath(files[0], false);
    } else { otherText = await textWithMark(pick.document); otherLabel = pick.label; }
    const opts = await vscode.window.showQuickPick([
      { label: 'Ignore trace numbers and batch numbers', id: 'trace', detail: 'Match entries by transaction code, routing number, account and identification instead' },
      { label: 'Ignore dates', id: 'dates', detail: 'File creation date and time, file ID modifier, effective, descriptive and settlement dates' }
    ], { canPickMany: true, placeHolder: 'Options (none: compare everything)' });
    if (opts === undefined) return;
    const ids = opts.map(function (o) { return o.id; });
    const C = loadPro('compare');
    const labels = { a: otherLabel, b: vscode.workspace.asRelativePath(editor.document.uri, false) };
    const res = C.compare(otherText, await textWithMark(editor.document), { ignoreTrace: ids.indexOf('trace') !== -1, ignoreDates: ids.indexOf('dates') !== -1, labels: labels });
    lastComparison = res;
    await ui.openText(C.toMarkdown(res, 'ACH comparison: ' + labels.a + ' and ' + labels.b), 'markdown', 'ach-comparison.md');
    const c = res.counts;
    const pickCsv = await info(NAME + ': ' + C.summaryText(res), 'Open CSV');
    if (pickCsv === 'Open CSV' && lastComparison) await ui.openText(C.toCsv(lastComparison, { neutraliseFormulas: app.getSettings().neutraliseFormulas }), 'plaintext', 'ach-comparison.csv');
  });

  // ---- Export --------------------------------------------------------------------------------------
  async function exportAs(kind) {
    const editor = ui.achEditor();
    if (!editor) return;
    if (!(await requirePro(kind === 'csv' ? 'Export Entries As CSV' : 'Export Entries As JSON'))) return;
    const E = loadPro('export');
    const parsed = app.parsedOf(editor.document, true);
    const neutralise = app.getSettings().neutraliseFormulas;
    const text = kind === 'csv' ? E.toCsv(parsed, { neutraliseFormulas: neutralise }) : E.toJson(parsed);
    const base = ui.baseName(editor.document.uri) + '-entries.' + kind;
    const folder = editor.document.uri.scheme === 'file' ? parentOf(editor.document.uri) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri : null);
    const target = await vscode.window.showSaveDialog({ defaultUri: folder ? vscode.Uri.joinPath(folder, base) : undefined, filters: kind === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] }, saveLabel: 'Export' });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    let entries = 0;
    for (const b of parsed.structure.batches) entries += P.entriesOf(parsed.records, b).length;
    info(NAME + ': ' + entries + ' entries exported to ' + lastSegment(target) + '.' + (kind === 'csv' ? (neutralise ? ' Values that a spreadsheet would read as a formula start with an apostrophe.' : ' Formula protection is off (setting achAtlas.export.neutraliseFormulas): open the file in a spreadsheet only if you trust its content.') : ' Amounts are written as decimal text.'));
  }
  reg('achAtlas.exportCsv', function () { return exportAs('csv'); });
  reg('achAtlas.exportJson', function () { return exportAs('json'); });

  // ---- Reconciliation report -------------------------------------------------------------------------
  reg('achAtlas.reconcile', async function () {
    if (!(await requirePro('Reconciliation Report'))) return;
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Report on this folder' });
    if (!picked || !picked[0]) return;
    const folder = picked[0];
    const format = await vscode.window.showQuickPick([{ label: 'HTML report', id: 'html' }, { label: 'CSV', id: 'csv' }, { label: 'Both', id: 'both' }], { placeHolder: 'Report format' });
    if (!format) return;
    const s = app.getSettings();
    const R = loadPro('reconcile');
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': reading ACH files', cancellable: true }, async function (progress, token) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, s.reconcileInclude), '**/{node_modules,.git}/**', s.reconcileMaxFiles);
      uris.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      // One file at a time: no file text is kept after it was read.
      const reconciler = R.createReconciler({ checks: s.checks });
      for (const u of uris) {
        if (token.isCancellationRequested) return null;
        const name = u.path.slice(folder.path.replace(/\/+$/, '').length + 1);
        let text;
        try { text = await readText(u); } catch (e) { continue; }
        reconciler.add(name, text);
        progress.report({ message: name });
      }
      return { report: reconciler.result(), count: uris.length };
    });
    if (!res) return;
    if (!res.report.files.length) { warn('No ACH file was found in that folder (setting achAtlas.reconcile.include).'); return; }
    const title = 'ACH reconciliation: ' + lastSegment(folder);
    if (format.id !== 'csv') await ui.openText(R.toHtml(res.report, title), 'html', 'ach-reconciliation.html');
    if (format.id !== 'html') await ui.openText(R.toCsv(res.report, { neutraliseFormulas: s.neutraliseFormulas }), 'plaintext', 'ach-reconciliation.csv');
    const t = res.report.totals;
    info(NAME + ': ' + t.files + ' ACH files, ' + t.batches + ' batches, ' + t.entries + ' entries; debits ' + V.formatCents(t.debit) + ', credits ' + V.formatCents(t.credit) + '; ' + res.report.anomalies.length + ' anomalies listed' + (res.report.skipped.length ? '; ' + res.report.skipped.length + ' files skipped (not ACH files)' : '') + '. The report is open as a new file; save it where you need it.');
  });

  // ---- Split and merge -------------------------------------------------------------------------------
  reg('achAtlas.split', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    if (!(await requirePro('Split Into One File Per Batch'))) return;
    const S = loadPro('splitmerge');
    const res = S.split(editor.document.getText(), ui.baseName(editor.document.uri));
    if (!res.ok) { warn(res.reason); return; }
    const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Write the batch files here', defaultUri: editor.document.uri.scheme === 'file' ? parentOf(editor.document.uri) || undefined : undefined });
    if (!folder || !folder[0]) return;
    const targets = res.files.map(function (f) { return { file: f, uri: vscode.Uri.joinPath(folder[0], f.name) }; });
    let existing = 0;
    for (const t of targets) if (await exists(t.uri)) existing++;
    const ok = await vscode.window.showWarningMessage(NAME + ': Write ' + targets.length + ' file' + (targets.length === 1 ? '' : 's') + ' (' + targets.slice(0, 5).map(function (t) { return t.file.name; }).join(', ') + (targets.length > 5 ? ', ...' : '') + ')?' + (existing ? ' ' + existing + ' of them exist and will be replaced.' : '') + ' ' + res.notes.join(' '), { modal: true }, 'Write');
    if (ok !== 'Write') return;
    for (const t of targets) await vscode.workspace.fs.writeFile(t.uri, Buffer.from(t.file.text, 'utf8'));
    info(NAME + ': ' + targets.length + ' file' + (targets.length === 1 ? '' : 's') + ' written, one per batch, each with its own file control, filler and file ID modifier.');
  });

  reg('achAtlas.merge', async function () {
    if (!(await requirePro('Merge Files'))) return;
    const files = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: 'Merge these files' });
    if (!files) return;
    if (files.length < 2) { warn('Choose at least two files to merge.'); return; }
    const list = files.slice().sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    const items = [];
    for (const f of list) items.push({ name: lastSegment(f), text: await readText(f) });
    const S = loadPro('splitmerge');
    const res = S.merge(items);
    if (!res.ok) { warn(res.reason); return; }
    await ui.openText(res.text, 'ach', 'merged.ach');
    info(NAME + ': ' + items.length + ' files merged into one with ' + res.batches + ' batches (in file name order). ' + res.notes.join(' '));
  });

  // ---- Recompute control records and padding ---------------------------------------------------------
  reg('achAtlas.fixControls', async function () {
    const editor = ui.achEditor();
    if (!editor) return;
    if (!(await requirePro('Recompute Control Records And Padding'))) return;
    const document = editor.document;
    const version = document.version;
    const F = loadPro('fixup');
    const res = F.fixUp(document.getText());
    if (!res.ok) { warn(res.reason); return; }
    if (!res.changed) { info(NAME + ': the control records, the record lengths and the filler are already correct; nothing to change.'); return; }
    const previewUri = vscode.Uri.parse(PREVIEW_SCHEME + ':/' + encodeURIComponent(ui.baseName(document.uri)) + '-recomputed.ach?' + Date.now());
    previews.set(previewUri.toString(), res.text);
    await vscode.commands.executeCommand('vscode.diff', document.uri, previewUri, ui.baseName(document.uri) + ': current and recomputed', { preview: true }).then(undefined, function () { /* the diff could not be shown; the dialog still lists the changes */ });
    const shown = res.changes.slice(0, 8).join(' ') + (res.changes.length > 8 ? ' (' + (res.changes.length - 8) + ' more)' : '');
    const pick = await vscode.window.showWarningMessage(NAME + ': Apply these changes to the file? ' + shown + ' Entries, addenda and headers are not changed.', { modal: true }, 'Apply');
    previews.delete(previewUri.toString());
    if (pick !== 'Apply') return;
    if (document.version !== version) { warn('The file changed while the preview was open; nothing was applied. Run the command again.'); return; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), res.text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) info(NAME + ': ' + res.changes.length + ' change' + (res.changes.length === 1 ? '' : 's') + ' applied. Save the file to keep them; Undo reverts them.');
    else warn('The editor did not apply the change; the file is unchanged.');
  });

  return ui.disposables.slice(before);
}

module.exports = { registerProCommands: registerProCommands };
