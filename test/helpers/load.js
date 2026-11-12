'use strict';
// Shared helpers of the test suite: the corpus, the check result as sorted code lists, and a
// small independent record writer for hand-made test files.

const fs = require('node:fs');
const path = require('node:path');
const P = require('../../src/ach/parse');
const { validate } = require('../../src/ach/validate');

const CORPUS = path.join(__dirname, '..', 'fixtures', 'corpus');

function corpusFiles() {
  const expectations = JSON.parse(fs.readFileSync(path.join(CORPUS, 'expectations.json'), 'utf8'));
  return Object.keys(expectations).sort().map(function (name) {
    return { name: name, text: fs.readFileSync(path.join(CORPUS, name), 'utf8'), expect: expectations[name] };
  });
}

/** { errors, warnings, notes } as sorted lists of distinct codes. */
function codesOf(text, options) {
  const v = validate(P.parseAch(text), options || {});
  const out = { errors: [], warnings: [], notes: [] };
  for (const p of v.problems) {
    const k = p.severity === 'error' ? 'errors' : p.severity === 'warning' ? 'warnings' : 'notes';
    if (out[k].indexOf(p.code) === -1) out[k].push(p.code);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/** Every code with its count, for comparisons that must match exactly. */
function codeCounts(text, options) {
  const v = validate(P.parseAch(text), options || {});
  const m = {};
  for (const p of v.problems) m[p.code] = (m[p.code] || 0) + 1;
  return m;
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

module.exports = { corpusFiles: corpusFiles, codesOf: codesOf, codeCounts: codeCounts, pad: pad, CORPUS: CORPUS };
