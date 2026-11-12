'use strict';
// Editor features of the free tier: detection of ACH files saved as plain text, problems, hover,
// document symbols, folding, the outline tree view and the two status bar items.

const P = require('./ach/parse');
const D = require('./ach/describe');
const O = require('./ach/outline');
const V = require('./ach/values');
const config = require('./licence/config');

const DEBOUNCE_MS = 400;
const TYPING_LIMIT = 2 * 1024 * 1024;

function rangeOf(vscode, document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(Math.max(start, end)));
}

/** Record index of a text offset (binary search over the record starts), or -1. */
function recordAt(parsed, offset) {
  const r = parsed.records;
  let lo = 0;
  let hi = r.count - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (r.starts[mid] <= offset) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best === -1) return -1;
  return offset <= r.starts[best] + r.lengths[best] ? best : -1;
}

/** { record, column, parsed } for a position, or null. `force` reads files over the size limit too. */
function locate(app, document, position, force) {
  const parsed = app.parsedOf(document, force === true);
  if (!parsed) return null;
  const offset = document.offsetAt(position);
  const i = recordAt(parsed, offset);
  if (i === -1) return null;
  const column = Math.min(P.RECORD_LENGTH, Math.max(1, offset - parsed.records.starts[i] + 1));
  return { parsed: parsed, record: i, column: column };
}

// ---- detection of ACH files saved with another extension ------------------------------------------

function createDetection(app) {
  const vscode = app.vscode;
  function consider(document) {
    if (!document || document.languageId !== 'plaintext' || !app.getSettings().detectPlainText) return;
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return;
    if (!document.lineCount) return;
    let first = document.lineAt(0).text;
    if (first.length > P.RECORD_LENGTH) first = first.slice(0, P.RECORD_LENGTH);
    if (P.looksLikeAch(first)) vscode.languages.setTextDocumentLanguage(document, 'ach').then(undefined, function () { /* the editor refused; keep the language */ });
  }
  vscode.workspace.textDocuments.forEach(consider);
  return [vscode.workspace.onDidOpenTextDocument(consider)];
}

// ---- problems -----------------------------------------------------------------------------------

function createDiagnostics(app) {
  const vscode = app.vscode;
  const collection = vscode.languages.createDiagnosticCollection('achAtlas');
  const timers = new Map();
  const summaries = new Map();
  const SEVERITY = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information };
  const listeners = [];
  // The editor removes a UTF-8 byte order mark from the text of a document and remembers it as the
  // encoding of the file, so the mark is looked for in the file itself (or in the encoding the editor
  // reports) when a file is opened or saved, and its warning is added to the problems of the text.
  const bomFlags = new Map();
  const BOM_MESSAGE = 'The file starts with a byte order mark. Bank systems usually expect plain ASCII text without it. Save the file with the encoding "UTF-8" (not "UTF-8 with BOM").';

  async function hasByteOrderMark(document) {
    if (typeof document.encoding === 'string' && document.encoding) return document.encoding === 'utf8bom';
    if (document.isUntitled || document.uri.scheme === 'untitled' || app.tooLarge(document)) return false;
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  }

  async function refreshEncoding(document) {
    if (!app.isAchDocument(document)) return;
    const key = document.uri.toString();
    let found = false;
    try { found = await hasByteOrderMark(document); } catch (e) { found = false; }
    if (!!bomFlags.get(key) === found) return;
    if (found) bomFlags.set(key, true); else bomFlags.delete(key);
    try { run(document, false); } catch (e) { /* closed meanwhile */ }
  }

  function run(document, force) {
    const key = document.uri.toString();
    if (!app.isAchDocument(document)) { collection.delete(document.uri); summaries.delete(key); return null; }
    if (!force && app.tooLarge(document)) {
      collection.delete(document.uri);
      const s = { skipped: 'size' };
      summaries.set(key, s);
      listeners.forEach(function (fn) { fn(document); });
      return s;
    }
    const parsed = app.parsedOf(document, true);
    const checked = app.validateParsed(parsed);
    let result = checked;
    if (bomFlags.get(key) && !checked.problems.some(function (p) { return p.code === 'ACH-BOM'; })) {
      result = Object.assign({}, checked, {
        problems: [{ code: 'ACH-BOM', severity: 'warning', start: 0, end: Math.min(1, app.lengthOf(document)), message: BOM_MESSAGE }].concat(checked.problems),
        counts: Object.assign({}, checked.counts, { warning: checked.counts.warning + 1 })
      });
    }
    const diags = result.problems.map(function (p) {
      const d = new vscode.Diagnostic(rangeOf(vscode, document, p.start, p.end), p.message, SEVERITY[p.severity]);
      d.code = vscode.Uri && typeof vscode.Uri.parse === 'function' ? { value: p.code, target: vscode.Uri.parse(config.repositoryUrl + '/blob/HEAD/docs/problems.md#' + p.code.toLowerCase()) } : p.code;
      d.source = config.productName;
      return d;
    });
    collection.set(document.uri, diags);
    const summary = { counts: result.counts, records: parsed.records.count, totals: result.totals, batches: parsed.structure.batches.length };
    summaries.set(key, summary);
    listeners.forEach(function (fn) { fn(document); });
    return summary;
  }

  function schedule(document) {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(function () {
      timers.delete(key);
      try { run(document, false); } catch (e) { /* the document was closed meanwhile */ }
    }, DEBOUNCE_MS));
  }

  const subs = [
    collection,
    vscode.workspace.onDidOpenTextDocument(function (d) { if (app.isAchDocument(d)) { schedule(d); refreshEncoding(d); } }),
    vscode.workspace.onDidSaveTextDocument(function (d) { if (app.isAchDocument(d)) { schedule(d); refreshEncoding(d); } }),
    vscode.workspace.onDidChangeTextDocument(function (e) {
      if (!app.isAchDocument(e.document)) return;
      if (app.getSettings().validateOnType && app.lengthOf(e.document) <= TYPING_LIMIT) schedule(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument(function (d) { collection.delete(d.uri); summaries.delete(d.uri.toString()); bomFlags.delete(d.uri.toString()); })
  ];
  if (vscode.workspace.onDidChangeConfiguration) {
    subs.push(vscode.workspace.onDidChangeConfiguration(function (e) {
      if (e.affectsConfiguration && e.affectsConfiguration('achAtlas')) vscode.workspace.textDocuments.forEach(function (d) { if (app.isAchDocument(d)) schedule(d); });
    }));
  }
  for (const d of vscode.workspace.textDocuments) if (app.isAchDocument(d)) { schedule(d); refreshEncoding(d); }
  return {
    run: run,
    refreshEncoding: refreshEncoding,
    hasByteOrderMark: hasByteOrderMark,
    summaryOf: function (document) { return summaries.get(document.uri.toString()) || null; },
    onDidUpdate: function (fn) { listeners.push(fn); },
    dispose: function () { for (const t of timers.values()) clearTimeout(t); subs.forEach(function (s) { s.dispose(); }); }
  };
}

// ---- hover, symbols, folding ----------------------------------------------------------------------

const SYMBOL_KIND = { 'file-header': 'File', batch: 'Module', entry: 'Field', addenda: 'Property', 'file-control': 'Number', filler: 'Null' };

function registerLanguageFeatures(app) {
  const vscode = app.vscode;
  const selector = [{ language: 'ach' }];
  const subs = [];
  subs.push(vscode.languages.registerHoverProvider(selector, {
    provideHover: function (document, position) {
      if (!app.getSettings().hoverEnabled || app.tooLarge(document)) return null;
      const at = locate(app, document, position);
      if (!at) return null;
      const d = D.describeAt(at.parsed, at.record, at.column);
      if (!d) return null;
      const md = new vscode.MarkdownString(D.hoverMarkdown(d));
      md.isTrusted = false;
      md.supportHtml = false;
      const start = at.parsed.records.starts[at.record];
      return new vscode.Hover(md, rangeOf(vscode, document, start + d.field.start - 1, start + Math.min(d.field.end, at.parsed.records.lengths[at.record])));
    }
  }));
  subs.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    provideDocumentSymbols: function (document) {
      if (app.tooLarge(document)) return [];
      const parsed = app.parsedOf(document);
      if (!parsed) return [];
      const toSymbol = function (n) {
        const range = rangeOf(vscode, document, n.start, n.end);
        let sel = rangeOf(vscode, document, n.selStart, n.selEnd);
        if (!range.contains(sel)) sel = new vscode.Range(range.start, range.start);
        const sym = new vscode.DocumentSymbol(n.name, n.detail, vscode.SymbolKind[SYMBOL_KIND[n.kind] || 'Object'], range, sel);
        sym.children = n.children.map(toSymbol);
        return sym;
      };
      return O.symbols(parsed).map(toSymbol);
    }
  }, { label: config.productName }));
  if (vscode.languages.registerFoldingRangeProvider) {
    subs.push(vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges: function (document) {
        if (app.tooLarge(document)) return [];
        const parsed = app.parsedOf(document);
        if (!parsed) return [];
        const r = parsed.records;
        return parsed.structure.batches.map(function (b) {
          const last = b.control !== -1 ? b.control : Math.max(b.header, b.end - 1);
          return new vscode.FoldingRange(document.positionAt(r.starts[b.header]).line, document.positionAt(r.starts[last]).line);
        }).filter(function (f) { return f.end > f.start; });
      }
    }));
  }
  return subs;
}

// ---- outline tree view --------------------------------------------------------------------------

const ICON = { 'file-header': 'file', batch: 'symbol-module', 'batch-header': 'symbol-namespace', 'batch-control': 'symbol-number', entry: 'symbol-field', page: 'list-unordered',
  addenda: 'note', 'file-control': 'symbol-number', filler: 'circle-slash', stray: 'warning', record: 'warning' };

function createOutlineTree(app) {
  const vscode = app.vscode;
  const emitter = new vscode.EventEmitter();
  let roots = [];
  let current = null;
  let timer = null;

  function refresh() {
    const editor = vscode.window.activeTextEditor;
    const doc = editor ? editor.document : null;
    if (!doc || !app.isAchDocument(doc) || app.tooLarge(doc)) { roots = []; current = null; emitter.fire(undefined); return; }
    const parsed = app.parsedOf(doc);
    current = parsed ? { document: doc, parsed: parsed } : null;
    roots = parsed ? O.rootNodes(parsed) : [];
    emitter.fire(undefined);
  }
  function later() { clearTimeout(timer); timer = setTimeout(function () { try { refresh(); } catch (e) { /* closed meanwhile */ } }, 300); }

  const provider = {
    onDidChangeTreeData: emitter.event,
    getChildren: function (n) { if (!n) return roots; return current ? O.childrenOf(current.parsed, n) : []; },
    getTreeItem: function (n) {
      const item = new vscode.TreeItem(n.label, n.expandable ? (n.kind === 'batch' && roots.filter(function (x) { return x.kind === 'batch'; }).length <= 3 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
      item.description = n.detail;
      item.iconPath = new vscode.ThemeIcon(ICON[n.kind] || 'circle-outline');
      item.contextValue = 'achAtlas.' + n.kind;
      if (current && typeof n.record === 'number') item.command = { command: 'achAtlas.revealRecord', title: 'Reveal', arguments: [current.document.uri.toString(), n.record] };
      return item;
    }
  };
  const view = vscode.window.createTreeView('achAtlas.outline', { treeDataProvider: provider, showCollapseAll: true });
  const subs = [view, emitter, vscode.window.onDidChangeActiveTextEditor(later),
    vscode.workspace.onDidChangeTextDocument(function (e) { if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) later(); })];
  later();
  return { refresh: refresh, dispose: function () { clearTimeout(timer); subs.forEach(function (s) { s.dispose(); }); } };
}

// ---- status bar: field at the cursor, file totals -------------------------------------------------

function createStatus(app) {
  const vscode = app.vscode;
  const field = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  field.name = config.productName + ' field';
  field.command = 'achAtlas.copyPath';
  const totals = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  totals.name = config.productName + ' totals';
  totals.command = 'achAtlas.showTotals';
  let timer = null;

  function update() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !app.isAchDocument(editor.document)) { field.hide(); totals.hide(); return; }
    const doc = editor.document;
    if (app.tooLarge(doc)) {
      field.hide();
      const sum = app.diagnostics ? app.diagnostics.summaryOf(doc) : null;
      if (sum && sum.counts) totalsText(sum);
      else {
        totals.text = '$(list-ordered) ACH: file over the size limit';
        totals.tooltip = 'Larger than the achAtlas.maxFileSizeMB setting. Run "' + config.productName + ': Check Current File" to check it on demand.';
      }
      totals.show();
      return;
    }
    const at = locate(app, doc, editor.selection.active);
    if (at) {
      const path = D.pathAt(at.parsed, at.record, at.column);
      field.text = '$(symbol-field) ' + path;
      field.tooltip = path + '\nClick to copy the path.';
      field.show();
    } else field.hide();
    const sum = app.diagnostics ? app.diagnostics.summaryOf(doc) : null;
    if (sum && sum.counts) { totalsText(sum); totals.show(); } else totals.hide();
  }
  function totalsText(sum) {
    const t = sum.totals;
    totals.text = '$(list-ordered) ' + sum.batches + ' batch' + (sum.batches === 1 ? '' : 'es') + ' · ' + t.entries + ' entr' + (t.entries === 1 ? 'y' : 'ies') + ' · Dr ' + V.formatCents(t.debit) + ' · Cr ' + V.formatCents(t.credit) +
      (sum.counts.error ? ' · $(error) ' + sum.counts.error : '') + (sum.counts.warning ? ' · $(warning) ' + sum.counts.warning : '');
    totals.tooltip = 'Totals computed from the entries. Click for details.';
  }
  function later() { clearTimeout(timer); timer = setTimeout(function () { try { update(); } catch (e) { /* closed meanwhile */ } }, 150); }
  if (app.diagnostics) app.diagnostics.onDidUpdate(later);
  const subs = [field, totals, vscode.window.onDidChangeTextEditorSelection(later), vscode.window.onDidChangeActiveTextEditor(later)];
  update();
  return { update: update, dispose: function () { clearTimeout(timer); subs.forEach(function (s) { s.dispose(); }); } };
}

module.exports = { createDetection: createDetection, createDiagnostics: createDiagnostics, registerLanguageFeatures: registerLanguageFeatures, createOutlineTree: createOutlineTree, createStatus: createStatus, recordAt: recordAt, locate: locate, rangeOf: rangeOf };
