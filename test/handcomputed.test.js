'use strict';
// Control totals and entry hashes worked out by hand, compared with what the extension computes.
// The records are written out literally here, not built by the extension.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const T = require('../src/ach/totals');
const V = require('../src/ach/values');
const { validate } = require('../src/ach/validate');
const samples = require('../src/samples');
const { pad } = require('./helpers/load');

test('the sample file: totals and hashes worked out by hand', () => {
  // Batch 1 (PPD, credits): RDFIs 58123456 + 57300012 + 59012340 = 174,435,808;
  // credits 1,842.50 + 2,150.75 + 973.00 = 4,966.25; 3 entries + 1 addenda = 4.
  // Batch 2 (CCD, debits): RDFIs 56420078 + 58123456 = 114,543,534;
  // debits 12,500.00 + 3,120.40 = 15,620.40; 2 entries + 1 addenda = 3.
  // File: hash 288,979,342; 13 records up to the file control = 2 blocks; 7 filler records.
  const text = samples.sampleFor('valid').text;
  const p = P.parseAch(text);
  const t = T.fileTotals(p);
  const b1 = t.batches[0].totals;
  const b2 = t.batches[1].totals;
  assert.deepEqual([b1.entries, b1.addenda, b1.hash, b1.debit, b1.credit], [3, 1, 174435808n, 0n, 496625n]);
  assert.deepEqual([b2.entries, b2.addenda, b2.hash, b2.debit, b2.credit], [2, 1, 114543534n, 1562040n, 0n]);
  assert.deepEqual([t.hash, t.debit, t.credit, t.recordsToControl, t.blocks], [288979342n, 1562040n, 496625n, 13, 2]);
  const lines = text.split('\n');
  assert.equal(lines[6], '82200000040174435808000000000000000000496625' + '1520749386' + pad('', 25) + '590123400000001');
  assert.equal(lines[11], '82250000030114543534000001562040000000000000' + '1520749386' + pad('', 25) + '590123400000002');
  assert.equal(lines[12], '9000002000002000000070288979342000001562040000000496625' + pad('', 39));
  assert.equal(lines.filter((l) => l === '9'.repeat(94)).length, 7);
  assert.equal(validate(p).problems.length, 0);
});

test('a hand-written CCD file with a hash that needs more than ten digits', () => {
  // Twelve entries with the RDFI 99999999 (check digit: 9*3+9*7+9*1+9*3+9*7+9*1+9*3+9*7 = 288, so 2).
  // Hash: 12 x 99,999,999 = 1,199,999,988, ten digits: 1199999988.
  // Twenty more with 98765432 (check digit: 27+56+7+18+35+4+9+14 = 170, so 0): 20 x 98,765,432 = 1,975,308,640.
  // Sum 3,175,308,628 per 32 entries; four batches of these: 12,701,234,512, rightmost ten digits 2701234512.
  const header = '101 590123400' + '1520749386' + '2611120915A094101' + pad('RIVERSTONE TEST BANK', 23) + pad('HARBOR LANE CO', 23) + pad('', 8);
  const records = [header];
  let traceNo = 0;
  for (let b = 1; b <= 4; b++) {
    records.push('5225' + pad('HARBOR LANE CO', 16) + pad('', 20) + '1520749386CCD' + pad('COLLECTION', 10) + pad('', 6) + '261113' + '   1' + '59012340' + '000000' + b);
    for (let k = 0; k < 32; k++) {
      traceNo++;
      const rdfi = k < 12 ? '999999992' : '987654320';
      records.push('627' + rdfi + pad('ACCT' + k, 17) + '0000000100' + pad('INV' + k, 15) + pad('CUSTOMER ' + k, 22) + '  0' + '59012340' + String(traceNo).padStart(7, '0'));
    }
    // 32 entries; hash 3175308628; debits 32 x 1.00 = 32.00.
    records.push('8225000032' + '3175308628' + '000000003200' + '000000000000' + '1520749386' + pad('', 25) + '59012340' + '000000' + b);
  }
  // 1 + 4 x 34 + 1 = 138 records up to the file control: 14 blocks; 2 filler records.
  records.push('9' + '000004' + '000014' + '00000128' + '2701234512' + '000000012800' + '000000000000' + pad('', 39));
  records.push('9'.repeat(94), '9'.repeat(94));
  const p = P.parseAch(records.join('\n') + '\n');
  const res = validate(p);
  assert.deepEqual(res.problems.map((x) => x.code + ': ' + x.message), []);
  assert.equal(res.totals.hash, 12701234512n);
  assert.equal(V.hashField(res.totals.hash), '2701234512');
  assert.equal(res.totals.debit, 12800n);
  assert.equal(res.totals.blocks, 14);
});

test('a hand-written file with every total off by one cent is reported field by field', () => {
  const lines = samples.sampleFor('valid').text.split('\n');
  lines[6] = lines[6].slice(0, 32) + '000000496626' + lines[6].slice(44);
  lines[12] = lines[12].slice(0, 31) + '000001562041' + lines[12].slice(43);
  const res = validate(P.parseAch(lines.join('\n')));
  assert.deepEqual(res.problems.map((x) => x.code), ['ACH-BATCH-CREDITS', 'ACH-FILE-DEBITS']);
  assert.match(res.problems[0].message, /4,966\.26 in credits; the credit entries add up to 4,966\.25/);
  assert.match(res.problems[1].message, /15,620\.41 in debits; the debit entries of the file add up to 15,620\.40/);
});
