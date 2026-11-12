'use strict';
// The default value of every setting (the manifest declares the same values; a test compares them).

const DEFAULTS = Object.freeze({
  maxFileSizeMB: 20, maxProblems: 1000, validateOnType: true, 'hover.enabled': true, detectPlainText: true,
  'checks.effectiveDate': true, 'checks.blocking': true, 'reconcile.include': '**/*.{ach,nacha,txt,dat}', 'reconcile.maxFiles': 2000, 'export.neutraliseFormulas': true
});

module.exports = { DEFAULTS: DEFAULTS };
