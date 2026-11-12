'use strict';
// ACH Atlas entry point. Builds the shared `app` object and installs every part of the extension;
// a failure in one part does not take the others down.

const vscode = require('vscode');
const os = require('node:os');
const P = require('./ach/parse');
const { validate } = require('./ach/validate');
const { createLicence } = require('./licence/licence');
const providers = require('./providers');
const { registerCommands } = require('./commands');
const { registerProCommands } = require('./procommands');
const { DEFAULTS } = require('./settings');

function numberSetting(value, fallback, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function activate(context) {
  let output = null;
  function log(text) {
    if (!output) output = vscode.window.createOutputChannel('ACH Atlas');
    output.appendLine(text);
  }

  let settingsCache = null;
  function getSettings() {
    if (settingsCache) return settingsCache;
    const c = vscode.workspace.getConfiguration('achAtlas');
    settingsCache = {
      maxFileSizeMB: numberSetting(c.get('maxFileSizeMB', DEFAULTS.maxFileSizeMB), DEFAULTS.maxFileSizeMB, 0.1, 50),
      maxProblems: Math.floor(numberSetting(c.get('maxProblems', DEFAULTS.maxProblems), DEFAULTS.maxProblems, 1, 20000)),
      validateOnType: c.get('validateOnType', true) !== false,
      hoverEnabled: c.get('hover.enabled', true) !== false,
      detectPlainText: c.get('detectPlainText', true) !== false,
      checks: { effectiveDate: c.get('checks.effectiveDate', true) !== false, blocking: c.get('checks.blocking', true) !== false },
      reconcileInclude: String(c.get('reconcile.include', DEFAULTS['reconcile.include']) || DEFAULTS['reconcile.include']),
      reconcileMaxFiles: Math.floor(numberSetting(c.get('reconcile.maxFiles', DEFAULTS['reconcile.maxFiles']), DEFAULTS['reconcile.maxFiles'], 1, 20000)),
      neutraliseFormulas: c.get('export.neutraliseFormulas', true) !== false
    };
    return settingsCache;
  }

  // The licence server environment is the live one, always. No setting, command, environment
  // variable or editor mode changes it (a development host of the extension included).
  const licence = createLicence({ secrets: context.secrets, globalState: context.globalState });
  licence.checkTrial().then(undefined, function () { /* read-only state */ });

  const parseCache = new WeakMap();
  const validationCache = new WeakMap();
  const app = {
    vscode: vscode,
    context: context,
    licence: licence,
    getSettings: getSettings,
    defaults: DEFAULTS,
    diagnostics: null,
    tree: null,
    status: null,
    extensionVersion: (context.extension && context.extension.packageJSON && context.extension.packageJSON.version) || require('../package.json').version,
    osRelease: function () { try { return os.release(); } catch (e) { return ''; } },
    isAchDocument: function (document) { return !!document && document.languageId === 'ach'; },
    // Length of a document without copying its text.
    lengthOf: function (document) {
      if (!document.lineCount) return 0;
      try { return document.offsetAt(document.lineAt(document.lineCount - 1).range.end); } catch (e) { return document.getText().length; }
    },
    tooLarge: function (document) { return app.lengthOf(document) > getSettings().maxFileSizeMB * 1024 * 1024; },
    // Parsed records of a document (cached per version); null for files over the size limit
    // unless `force` is set.
    parsedOf: function (document, force) {
      if (!force && app.tooLarge(document)) return null;
      const hit = parseCache.get(document);
      if (hit && hit.version === document.version) return hit.parsed;
      const parsed = P.parseAch(document.getText());
      parseCache.set(document, { version: document.version, parsed: parsed });
      return parsed;
    },
    // Check result of a parsed file (cached per parse result and settings).
    validateParsed: function (parsed) {
      const s = getSettings();
      const key = s.maxProblems + '|' + s.checks.effectiveDate + '|' + s.checks.blocking;
      const hit = validationCache.get(parsed);
      if (hit && hit.key === key) return hit.result;
      const result = validate(parsed, { maxProblems: s.maxProblems, checks: s.checks });
      validationCache.set(parsed, { key: key, result: result });
      return result;
    },
    settingsForReport: function () {
      const c = vscode.workspace.getConfiguration('achAtlas');
      const out = {};
      for (const k of Object.keys(DEFAULTS)) out[k] = c.get(k, DEFAULTS[k]);
      return out;
    }
  };

  const subscriptions = context.subscriptions;
  subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (event) {
    if (event.affectsConfiguration('achAtlas')) settingsCache = null;
  }));

  function install(name, fn) {
    try {
      const result = fn();
      if (Array.isArray(result)) result.forEach(function (d) { subscriptions.push(d); });
      else if (result && typeof result.dispose === 'function') subscriptions.push(result);
      return result;
    } catch (err) {
      log('Could not start ' + name + ': ' + (err && err.message ? err.message : err));
      return null;
    }
  }

  install('commands', function () { return registerCommands(app); });
  install('Pro commands', function () { return registerProCommands(app); });
  install('file detection', function () { return providers.createDetection(app); });
  app.diagnostics = install('problems', function () { return providers.createDiagnostics(app); });
  install('language features', function () { return providers.registerLanguageFeatures(app); });
  app.tree = install('outline', function () { return providers.createOutlineTree(app); });
  app.status = install('status bar', function () { return providers.createStatus(app); });
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate, DEFAULTS: DEFAULTS };
