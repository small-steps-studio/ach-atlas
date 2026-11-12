'use strict';
// Create Test File and Anonymise: round trips through the checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const V = require('../src/ach/values');
const G = require('../src/pro/generate');
const A = require('../src/pro/anonymise');
const { corpusFiles, codesOf, codeCounts } = require('./helpers/load');
const samples = require('../src/samples');

const BASE = { min: 1n, max: 500000n, effectiveDate: '261113', created: { date: '261112', time: '0900' } };
const NONE = { errors: [], warnings: [], notes: [] };

test('test files pass every check, for every SEC code, direction and many seeds', () => {
  let files = 0;
  for (const sec of G.SEC_OPTIONS) {
    for (const direction of sec === 'TEL' ? ['debit'] : ['credit', 'debit', 'mixed']) {
      for (const addenda of [false, true]) {
        for (let seed = 1; seed <= 6; seed++) {
          const count = 1 + ((seed * 37) % 60);
          const g = G.generate(Object.assign({}, BASE, { sec: sec, direction: direction, addenda: addenda, seed: seed, count: count, batches: 1 + (seed % Math.min(4, count)), lineBreak: seed % 2 ? '\n' : '\r\n' }));
          assert.equal(g.ok, true, g.reason);
          assert.deepEqual(codesOf(g.text), NONE, sec + ' ' + direction + ' seed ' + seed);
          files++;
        }
      }
    }
  }
  assert.ok(files >= 100);
});

test('test file totals match the summary and the file control (exact decimals)', () => {
  const g = G.generate(Object.assign({}, BASE, { sec: 'CCD', direction: 'mixed', count: 500, batches: 7, min: 1n, max: 9999999999n / 1000n, seed: 99 }));
  const p = P.parseAch(g.text);
  const r = p.records;
  const fc = r.count - 1 - p.structure.fillerCount;
  assert.equal(P.fieldOf(r, fc, 32, 12), V.zeroPad(g.summary.debit, 12));
  assert.equal(P.fieldOf(r, fc, 44, 12), V.zeroPad(g.summary.credit, 12));
  assert.equal(p.structure.batches.length, 7);
  assert.equal((r.count) % 10, 0);
});

test('test files: same seed same file, other seed other file; invented routing numbers', () => {
  const a = G.generate(Object.assign({}, BASE, { sec: 'PPD', direction: 'credit', count: 20, batches: 1, seed: 5 }));
  const b = G.generate(Object.assign({}, BASE, { sec: 'PPD', direction: 'credit', count: 20, batches: 1, seed: 5 }));
  const c = G.generate(Object.assign({}, BASE, { sec: 'PPD', direction: 'credit', count: 20, batches: 1, seed: 6 }));
  assert.equal(a.text, b.text);
  assert.notEqual(a.text, c.text);
  const p = P.parseAch(a.text);
  for (const e of P.entriesOf(p.records, p.structure.batches[0])) {
    const routing = P.fieldOf(p.records, e, 4, 9);
    assert.match(routing, /^5[0-9]{8}$/);
    assert.equal(V.validRouting(routing), true);
  }
});

test('Create Test File options are checked with clear reasons', () => {
  const bad = [
    [{ sec: 'IAT' }, /SEC codes/], [{ sec: 'TEL', direction: 'credit' }, /TEL entries are debits only/], [{ count: 0 }, /1 to 100,000/], [{ count: 100001 }, /1 to 100,000/],
    [{ batches: 51 }, /batches/], [{ batches: 30, count: 10 }, /batches/], [{ min: 0n }, /0\.01/], [{ min: 500n, max: 100n }, /smaller first/],
    [{ max: 10000000000n }, /99,999,999\.99/], [{ count: 100000, max: 99999999n }, /exceed/], [{ effectiveDate: '261131' }, /valid date/],
    [{ odfi: '590123401' }, /check digit/], [{ destination: '12345' }, /destination/]
  ];
  for (const [change, re] of bad) {
    const r = G.generate(Object.assign({ sec: 'PPD', direction: 'credit', count: 10, batches: 1 }, BASE, change));
    assert.equal(r.ok, false, JSON.stringify(change, (k, v) => typeof v === 'bigint' ? String(v) : v));
    assert.match(r.reason, re);
  }
});

test('anonymise then check: every valid corpus file stays free of problems', () => {
  for (const f of corpusFiles()) {
    if (f.expect.errors.length || f.expect.warnings.length) continue;
    for (const amounts of ['keep', 'replace']) {
      const res = A.createAnonymiser({ seed: 11, amounts: amounts }).anonymise(f.text);
      assert.deepEqual(codesOf(res.text), codesOf(f.text), f.name + ' (' + amounts + ')');
      assert.equal(res.text.length, f.text.length, f.name);
    }
  }
});

test('anonymise keeps exactly the problems of every corpus file', () => {
  for (const f of corpusFiles()) {
    const res = A.createAnonymiser({ seed: 3, amounts: 'replace' }).anonymise(f.text);
    assert.deepEqual(codeCounts(res.text), codeCounts(f.text), f.name);
  }
});

test('anonymise: no original name, account, identification, company or routing number survives', () => {
  const text = samples.sampleFor('valid').text;
  const res = A.createAnonymiser({ seed: 21 }).anonymise(text);
  for (const original of ['ALMA ASHGROVE', 'BORIS FERNHALL', 'CELIA DUNMORE', 'GREYSTONE MILLWORK', 'PINECREST DENTAL', 'HARBOR LANE CO', 'RIVERSTONE TEST BANK', '4410027719', '9001834', '120044871',
    '77120045', '300218', 'EMP0001', 'INV-2026-114', '1520749386', '59012340', '58123456', '57300012', '56420078', 'SALARY NOVEMBER', 'INVOICE 2026-114']) {
    assert.ok(!res.text.includes(original), original + ' survived');
  }
  assert.ok(res.changed > 0);
  assert.equal(res.counts.amounts, 0);
  assert.ok(res.text.includes('0000184250'), 'amounts are kept by default');
  assert.ok(res.text.includes('PAYROLL') && res.text.includes('261113'), 'descriptions and dates are kept');
});

test('anonymise: one mapping for every place a routing number or company id appears', () => {
  const res = A.createAnonymiser({ seed: 8 }).anonymise(samples.sampleFor('valid').text);
  const p = P.parseAch(res.text);
  const r = p.records;
  const odfi = P.fieldOf(r, 1, 80, 8);
  assert.equal(P.fieldOf(r, 0, 5, 8), odfi, 'immediate destination 590123400 and the ODFI are the same bank');
  assert.equal(P.fieldOf(r, 2, 80, 8), odfi, 'trace prefix');
  assert.equal(P.fieldOf(r, 6, 80, 8), odfi, 'batch control');
  assert.equal(P.fieldOf(r, 5, 4, 8), odfi, 'the on-us entry');
  assert.equal(P.fieldOf(r, 2, 4, 8), P.fieldOf(r, 10, 4, 8), 'RDFI 58123456 in two batches');
  const company = P.fieldOf(r, 1, 41, 10);
  assert.equal(P.fieldOf(r, 0, 14, 10), company, 'immediate origin = company identification');
  assert.equal(P.fieldOf(r, 6, 45, 10), company);
  assert.equal(P.fieldOf(r, 7, 41, 10), company);
  assert.equal(P.fieldOf(r, 2, 55, 22).trim(), 'PERSON 000001');
  assert.equal(P.fieldOf(r, 8, 55, 22).trim(), 'COMPANY 0002');
});

test('anonymise: the same value is replaced the same way across files of one run', () => {
  const an = A.createAnonymiser({ seed: 4 });
  const one = P.parseAch(an.anonymise(samples.sampleFor('valid').text).text);
  const two = P.parseAch(an.anonymise(samples.sampleFor('problems').text).text);
  assert.equal(P.fieldOf(one.records, 1, 80, 8), P.fieldOf(two.records, 1, 80, 8));
  assert.equal(P.fieldOf(one.records, 3, 13, 17), P.fieldOf(two.records, 3, 13, 17));
  const other = P.parseAch(A.createAnonymiser({ seed: 5 }).anonymise(samples.sampleFor('valid').text).text);
  assert.notEqual(P.fieldOf(one.records, 1, 80, 8), P.fieldOf(other.records, 1, 80, 8));
});

test('anonymise: a wrong check digit stays wrong, returns keep their mapped trace numbers', () => {
  const res = A.createAnonymiser({ seed: 6 }).anonymise(samples.sampleFor('problems').text);
  assert.deepEqual(codesOf(res.text).errors, ['ACH-BATCH-HASH', 'ACH-EFFECTIVE-DATE', 'ACH-RDFI-CHECK-DIGIT', 'ACH-RECORD-LENGTH']);
  const ret = corpusFiles().find((f) => f.name === 'v11-returns.ach');
  const out = P.parseAch(A.createAnonymiser({ seed: 6 }).anonymise(ret.text).text);
  const add = out.records;
  const entryRdfi = P.fieldOf(add, 2, 4, 8);
  assert.equal(P.fieldOf(add, 3, 7, 8), entryRdfi, 'original trace in the return names the original ODFI, now mapped like the entry RDFI');
  assert.equal(P.fieldOf(add, 3, 28, 8), P.fieldOf(add, 1, 80, 8), 'original RDFI = the returning bank');
});

test('anonymise: replaced amounts keep their number of digits, zero stays zero, totals adjusted', () => {
  const g = G.generate(Object.assign({}, BASE, { sec: 'PPD', direction: 'mixed', count: 200, batches: 3, seed: 12 }));
  const res = A.createAnonymiser({ seed: 13, amounts: 'replace' }).anonymise(g.text);
  assert.deepEqual(codesOf(res.text), NONE);
  assert.equal(res.counts.amounts, 200);
  const pa = P.parseAch(g.text);
  const pb = P.parseAch(res.text);
  for (const k of [2, 50, 120]) assert.equal(String(V.cents(P.fieldOf(pa.records, k, 30, 10))).length, String(V.cents(P.fieldOf(pb.records, k, 30, 10))).length);
  const prenotes = corpusFiles().find((f) => f.name === 'v09-prenotes.ach');
  assert.equal(A.createAnonymiser({ seed: 1, amounts: 'replace' }).anonymise(prenotes.text).counts.amounts, 0);
});

test('anonymise: a file with nothing to replace reports zero changes', () => {
  const bare = '101' + ' '.repeat(20) + '2611120915A094101' + ' '.repeat(54) + '\n';
  const res = A.createAnonymiser({ seed: 1 }).anonymise(bare);
  assert.equal(res.changed, 0);
  assert.equal(res.text, bare);
  assert.equal(A.countsText(res.counts), 'nothing');
});

test('anonymise: lines that are not ACH records are masked too', () => {
  const res = A.createAnonymiser({ seed: 1 }).anonymise('hello Alma\nacct 123\n');
  assert.equal(res.changed, 2);
  assert.ok(!/Alma|123/.test(res.text));
  assert.match(res.text, /^h[a-z]{4} [A-Z][a-z]{3}\na[a-z]{3} [0-9]{3}\n$/);
});
