'use strict';
// A stand-in for the editor API, large enough to activate the extension and drive its commands
// and providers in unit tests. It records what the extension registers, shows, opens and writes.

const Module = require('node:module');

class LineIndex {
  constructor(text) {
    this.text = text;
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) starts.push(i + 1);
      else if (c === 13) { if (text.charCodeAt(i + 1) === 10) { starts.push(i + 2); i++; } else starts.push(i + 1); }
    }
    this.starts = starts;
  }
  positionAt(offset) {
    const o = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0; let hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= o) lo = mid; else hi = mid - 1; }
    return { line: lo, character: o - this.starts[lo] };
  }
  offsetAt(line, character) {
    if (line < 0) return 0;
    if (line >= this.starts.length) return this.text.length;
    return Math.min(this.text.length, this.starts[line] + Math.max(0, character));
  }
  lineText(line) {
    const s = this.starts[line];
    const e = line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length;
    return this.text.slice(s, e).replace(/\r?\n$|\r$/, '');
  }
}

class Uri {
  constructor(scheme, path, raw) { this.scheme = scheme; this.path = path; this.raw = raw; this.fsPath = path; }
  toString() { return this.raw; }
  with(change) { return Uri.parse(this.scheme + '://' + (change.path !== undefined ? change.path : this.path)); }
  static parse(text) {
    const m = /^([a-zA-Z][\w+.-]*):(.*)$/.exec(text);
    const scheme = m ? m[1] : 'file';
    let rest = m ? m[2] : text;
    rest = rest.replace(/^\/\//, '');
    const q = rest.indexOf('?');
    const p = q === -1 ? rest : rest.slice(0, q);
    return new Uri(scheme, p.startsWith('/') || scheme === 'untitled' ? p : '/' + p, text);
  }
  static file(p) { return Uri.parse('file:///' + p.replace(/\\/g, '/').replace(/^\//, '')); }
  static joinPath(base, ...names) { return Uri.parse(base.scheme + '://' + base.path.replace(/\/$/, '') + '/' + names.join('/')); }
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
  contains(r) { const le = (x, y) => x.line < y.line || (x.line === y.line && x.character <= y.character); return le(this.start, r.start) && le(r.end, this.end); }
}
class Selection extends Range { get active() { return this.end; } }
class EventEmitter { constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; } fire(v) { this.listeners.forEach((f) => f(v)); } dispose() {} }

function makeDocument(uriText, text, languageId) {
  let li = new LineIndex(text);
  const doc = {
    uri: Uri.parse(uriText), languageId: languageId || 'ach', version: 1,
    getText: () => li.text,
    positionAt: (o) => { const p = li.positionAt(o); return new Position(p.line, p.character); },
    offsetAt: (p) => li.offsetAt(p.line, p.character),
    get lineCount() { return li.starts.length; },
    lineAt: (n) => { const t = li.lineText(n); return { text: t, range: { end: new Position(n, t.length) } }; },
    setText: (t) => { li = new LineIndex(t); doc.version++; }
  };
  return doc;
}

function createMock(options) {
  const o = options || {};
  const disposable = { dispose() {} };
  const state = {
    commands: new Map(), executed: [], infoMessages: [], warningMessages: [], errorMessages: [], opened: [], openedDocs: [], clipboard: null,
    inputAnswers: (o.inputAnswers || []).slice(), quickPickAnswers: (o.quickPickAnswers || []).slice(), buttonAnswers: (o.buttonAnswers || []).slice(),
    dialogAnswers: (o.dialogAnswers || []).slice(), saveAnswers: (o.saveAnswers || []).slice(),
    config: Object.assign({}, o.config || {}), documents: [], diagnostics: new Map(), providers: {}, trees: {}, statusItems: [], written: new Map(),
    files: new Map(Object.entries(o.files || {})), contentProviders: {}, languageChanges: [], edits: 0, inputOptions: []
  };
  for (const [uri, text] of state.files) state.documents.push(makeDocument(uri, text, /\.(ach|nacha)$/.test(uri) ? 'ach' : 'plaintext'));
  function editorFor(doc) {
    return {
      document: doc, selection: new Selection(0, 0, 0, 0), revealRange() {},
      edit: async (cb) => { let text = doc.getText(); cb({ insert: (pos, value) => { const off = doc.offsetAt(pos); text = text.slice(0, off) + value + text.slice(off); } }); doc.setText(text); return true; }
    };
  }
  state.activeTextEditor = o.active ? editorFor(state.documents.find((d) => d.uri.toString() === o.active)) : undefined;
  const nextButton = () => state.buttonAnswers.shift();
  const vscode = {
    Uri: Uri, Position: Position, Range: Range, Selection: Selection, EventEmitter: EventEmitter,
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    MarkdownString: class { constructor(v) { this.value = v; } },
    Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DocumentSymbol: class { constructor(name, detail, kind, range, sel) { Object.assign(this, { name, detail, kind, range, selectionRange: sel, children: [] }); } },
    SymbolKind: new Proxy({}, { get: (t, k) => String(k) }),
    FoldingRange: class { constructor(start, end) { this.start = start; this.end = end; } },
    TreeItem: class { constructor(label, collapsible) { this.label = label; this.collapsibleState = collapsible; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    WorkspaceEdit: class { constructor() { this.replacements = []; } replace(uri, range, text) { this.replacements.push({ uri: uri, range: range, text: text }); } },
    version: '1.99.0',
    env: {
      appName: 'Visual Studio Code',
      clipboard: { writeText: async (t) => { state.clipboard = t; } },
      openExternal: async (uri) => { state.opened.push(uri.toString()); return true; }
    },
    commands: {
      registerCommand: (id, fn) => { state.commands.set(id, fn); return disposable; },
      executeCommand: async (id, ...args) => { state.executed.push({ id: id, args: args }); const fn = state.commands.get(id); if (!fn) return undefined; return fn(...args); }
    },
    languages: {
      createDiagnosticCollection: () => ({ set: (uri, d) => state.diagnostics.set(uri.toString(), d), delete: (uri) => state.diagnostics.delete(uri.toString()), dispose() {} }),
      registerHoverProvider: (s, p) => { state.providers.hover = p; return disposable; },
      registerDocumentSymbolProvider: (s, p) => { state.providers.symbols = p; return disposable; },
      registerFoldingRangeProvider: (s, p) => { state.providers.folding = p; return disposable; },
      setTextDocumentLanguage: async (doc, lang) => { state.languageChanges.push(lang); doc.languageId = lang; return doc; }
    },
    window: {
      get activeTextEditor() { return state.activeTextEditor; },
      set activeTextEditor(v) { state.activeTextEditor = v; },
      showInformationMessage: async (text, ...buttons) => { state.infoMessages.push({ text, buttons }); return nextButton(); },
      showWarningMessage: async (text, ...rest) => { state.warningMessages.push({ text, rest }); return nextButton(); },
      showErrorMessage: async (text, ...buttons) => { state.errorMessages.push({ text, buttons }); return nextButton(); },
      showInputBox: async (opts) => { state.inputOptions.push(opts); const a = state.inputAnswers.shift(); if (opts && opts.validateInput && a !== undefined) state.lastValidation = opts.validateInput(a); return a; },
      showQuickPick: async (items, opts) => {
        const want = state.quickPickAnswers.shift();
        const list = await items;
        if (want === undefined) return undefined;
        if (opts && opts.canPickMany) return Array.isArray(want) ? want.map((w) => (typeof w === 'function' ? list.find(w) : list[w])) : [];
        return typeof want === 'function' ? list.find(want) : list[want];
      },
      showOpenDialog: async () => state.dialogAnswers.shift(),
      showSaveDialog: async () => state.saveAnswers.shift(),
      showTextDocument: async (doc) => { state.activeTextEditor = editorFor(doc); return state.activeTextEditor; },
      createTreeView: (id, opts) => { state.trees[id] = opts.treeDataProvider; return disposable; },
      createStatusBarItem: () => { const item = { text: '', show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} }; state.statusItems.push(item); return item; },
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      setStatusBarMessage: () => disposable,
      withProgress: async (opts, fn) => fn({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable }),
      onDidChangeActiveTextEditor: () => disposable,
      onDidChangeTextEditorSelection: () => disposable
    },
    workspace: {
      get workspaceFolders() { return o.folders || undefined; },
      get textDocuments() { return state.documents; },
      getConfiguration: (section) => ({ get: (key, fallback) => { const k = section ? section + '.' + key : key; return k in state.config ? state.config[k] : fallback; } }),
      onDidChangeConfiguration: () => disposable, onDidOpenTextDocument: () => disposable, onDidSaveTextDocument: () => disposable,
      onDidChangeTextDocument: () => disposable, onDidCloseTextDocument: () => disposable,
      registerTextDocumentContentProvider: (scheme, p) => { state.contentProviders[scheme] = p; return disposable; },
      openTextDocument: async (arg) => {
        if (arg && arg.content !== undefined) { const d = makeDocument('untitled:Untitled-' + (state.openedDocs.length + 1), arg.content, arg.language); state.openedDocs.push(d); return d; }
        const key = arg.toString();
        const known = state.documents.find((d) => d.uri.toString() === key) || state.openedDocs.find((d) => d.uri.toString() === key);
        if (known) return known;
        const d = makeDocument(key, state.written.get(key) || state.files.get(key) || '', 'plaintext');
        if (key.startsWith('untitled:')) state.openedDocs.push(d);
        return d;
      },
      asRelativePath: (u) => String(u.path || u).replace(/^.*\//, ''),
      findFiles: async (pattern) => {
        const base = pattern && pattern.base ? pattern.base.path.replace(/\/$/, '') + '/' : '';
        return Array.from(state.files.keys()).map((k) => Uri.parse(k)).filter((u) => u.path.startsWith(base) && /\.(ach|nacha|txt|dat)$/.test(u.path));
      },
      applyEdit: async (edit) => {
        for (const r of edit.replacements) {
          const doc = state.documents.concat(state.openedDocs).find((d) => d.uri.toString() === r.uri.toString());
          const text = doc.getText();
          const a = doc.offsetAt(r.range.start);
          const b = doc.offsetAt(r.range.end);
          doc.setText(text.slice(0, a) + r.text + text.slice(b));
          state.edits++;
        }
        return true;
      },
      fs: {
        stat: async (uri) => { const k = uri.toString(); if (state.files.has(k) || state.written.has(k)) return { size: 1, mtime: 1 }; throw new Error('not found'); },
        readFile: async (uri) => { const k = uri.toString(); if (!state.files.has(k)) throw new Error('not found'); return Buffer.from(state.files.get(k), 'utf8'); },
        writeFile: async (uri, data) => { state.written.set(uri.toString(), Buffer.from(data).toString('utf8')); },
        createDirectory: async () => {}
      }
    }
  };
  return { vscode: vscode, state: state };
}

function install(mock) {
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'vscode') return mock;
    return original.apply(this, arguments);
  };
  return function uninstall() { Module._load = original; };
}

function makeContext(pkg, extensionMode) {
  const secrets = new Map();
  const global = new Map();
  return {
    subscriptions: [],
    extension: { packageJSON: pkg },
    extensionMode: extensionMode || 1,
    secretsMap: secrets, globalMap: global,
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { if (v === undefined) global.delete(k); else global.set(k, v); } }
  };
}

module.exports = { createMock: createMock, install: install, makeContext: makeContext, Uri: Uri, makeDocument: makeDocument, LineIndex: LineIndex };
