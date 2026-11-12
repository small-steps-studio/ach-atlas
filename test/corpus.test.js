'use strict';
// The corpus: original ACH files across SEC codes and edge cases, each with the problem codes it
// must produce (written down when the file was made, not taken from the extension).
const test = require('node:test');
const assert = require('node:assert/strict');
const { corpusFiles, codesOf } = require('./helpers/load');
const { CODES } = require('../src/ach/validate');
const P = require('../src/ach/parse');
const { validate } = require('../src/ach/validate');

const files = corpusFiles();

test('the corpus has at least 60 files, valid and invalid', () => {
  assert.ok(files.length >= 60, String(files.length));
  const valid = files.filter((f) => !f.expect.errors.length && !f.expect.warnings.length);
  assert.ok(valid.length >= 20, 'valid files: ' + valid.length);
  assert.ok(files.length - valid.length >= 40);
});

for (const f of files) {
  test('corpus ' + f.name, () => {
    assert.deepEqual(codesOf(f.text), { errors: f.expect.errors.slice().sort(), warnings: f.expect.warnings.slice().sort(), notes: f.expect.notes.slice().sort() });
  });
}

test('every problem code except the list cut-off is produced by at least one corpus file', () => {
  const seen = new Set();
  for (const f of files) for (const k of ['errors', 'warnings', 'notes']) for (const c of f.expect[k]) seen.add(c);
  const missing = Object.keys(CODES).filter((c) => !seen.has(c) && c !== 'ACH-TOO-MANY-PROBLEMS');
  assert.deepEqual(missing, []);
});

test('problem ranges lie inside the text and inside their record', () => {
  for (const f of files) {
    const p = P.parseAch(f.text);
    for (const x of validate(p).problems) {
      assert.ok(x.start >= 0 && x.end >= x.start && x.end <= f.text.length, f.name + ' ' + x.code);
      if (x.record >= 0) {
        const s = p.records.starts[x.record];
        assert.ok(x.start >= s && x.end <= s + p.records.lengths[x.record], f.name + ' ' + x.code + ' outside its record');
      }
    }
  }
});

test('the check settings switch their checks off', () => {
  const byName = (n) => files.find((f) => f.name === n).text;
  assert.deepEqual(codesOf(byName('e16-no-filler.ach'), { checks: { blocking: false } }).warnings, []);
  assert.deepEqual(codesOf(byName('e37-effective-past.ach'), { checks: { effectiveDate: false } }).warnings, []);
  assert.deepEqual(codesOf(byName('v23-weekend.ach'), { checks: { effectiveDate: false } }).notes, []);
  assert.deepEqual(codesOf(byName('e36-effective-invalid.ach'), { checks: { effectiveDate: false } }).errors, ['ACH-EFFECTIVE-DATE']);
});

test('the problem list is cut at maxProblems and says how many more were found', () => {
  const text = files.find((f) => f.name === 'v19-hash-overflow.ach').text.replace(/ALMA ASHGROVE|HASH \d+/g, (m) => ' '.repeat(m.length));
  const res = validate(P.parseAch(text), { maxProblems: 10 });
  assert.equal(res.problems.length, 11);
  assert.equal(res.problems[10].code, 'ACH-TOO-MANY-PROBLEMS');
  assert.equal(res.counts.warning, 120);
  assert.equal(res.dropped, 110);
});
