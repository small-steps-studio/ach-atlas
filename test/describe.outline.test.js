'use strict';
// Hover descriptions, field paths, the outline tree and document symbols.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const D = require('../src/ach/describe');
const O = require('../src/ach/outline');
const samples = require('../src/samples');
const G = require('../src/pro/generate');

const valid = P.parseAch(samples.sampleFor('valid').text);
const broken = P.parseAch(samples.sampleFor('problems').text);

test('hover: amount with its cents, routing number with its check digit', () => {
  const amount = D.describeAt(valid, 2, 35);
  assert.equal(amount.field.name, 'Amount');
  assert.equal(amount.raw, '0000184250');
  assert.equal(amount.meaning, '1,842.50 (the last two digits are cents)');
  assert.equal(amount.path, 'Batch 1 > Entry 1 > Amount (30-39)');
  const rdfi = D.describeAt(valid, 2, 5);
  assert.equal(rdfi.meaning, 'routing number 581234560, check digit correct');
  const wrong = D.describeAt(broken, 2, 12);
  assert.equal(wrong.field.name, 'Check digit');
  assert.equal(wrong.meaning, 'wrong: for 58123456 the check digit is 0');
});

test('hover: dates, codes, indicator, SEC code, record type', () => {
  assert.equal(D.describeAt(valid, 1, 72).meaning, '2026-11-13, Friday');
  assert.equal(D.describeAt(broken, 7, 72).meaning, 'not a valid date (YYMMDD)');
  assert.equal(D.describeAt(valid, 2, 2).meaning, '22: checking account, credit');
  assert.equal(D.describeAt(valid, 3, 2).meaning, '32: savings account, credit');
  assert.equal(D.describeAt(valid, 1, 52).meaning, 'PPD: prearranged payment and deposit (consumer accounts)');
  assert.equal(D.describeAt(valid, 1, 3).meaning, '220: credits only');
  assert.equal(D.describeAt(valid, 3, 79).meaning, 'addenda follow (1 found)');
  assert.equal(D.describeAt(valid, 4, 2).meaning, '05: payment related information');
  assert.equal(D.describeAt(valid, 0, 1).meaning, 'File header');
  assert.equal(D.describeAt(valid, 0, 5).meaning, 'routing number 590123400, check digit correct');
  assert.equal(D.describeAt(valid, 0, 31).meaning, '09:15');
  assert.equal(D.describeAt(valid, 0, 36).meaning, 'correct (094)');
  assert.equal(D.describeAt(valid, 2, 85).meaning, 'bank 59012340, sequence 0000001');
  assert.equal(D.describeAt(valid, 8, 60).field.name, 'Receiving company name', 'CCD names the field for businesses');
});

test('hover: control fields carry the value computed from the entries', () => {
  assert.equal(D.describeAt(valid, 6, 15).computed, 'Computed from the entries: 0174435808 (matches)');
  assert.equal(D.describeAt(valid, 6, 40).computed, 'Computed from the entries: 4,966.25 (matches)');
  assert.equal(D.describeAt(broken, 11, 15).computed, 'Computed from the entries: 0114543534 (differs)');
  assert.equal(D.describeAt(valid, 12, 3).computed, 'Computed from the entries: 2 (matches)');
  assert.equal(D.describeAt(valid, 12, 10).computed, 'Computed from the entries: 2 (matches)', 'block count');
  assert.equal(D.describeAt(valid, 12, 25).computed, 'Computed from the entries: 0288979342 (matches)');
  assert.equal(D.describeAt(valid, 6, 48).computed, 'Batch header: 1520749386 (same)');
  assert.equal(D.describeAt(valid, 4, 90).computed, 'Entry trace number ends in 0000002 (same)');
});

test('hover markdown escapes the raw value and shows spaces', () => {
  const md = D.hoverMarkdown(D.describeAt(valid, 2, 60));
  assert.match(md, /^\*\*Entry detail: Individual name\*\*/);
  assert.match(md, /Positions 55-76 \(22 characters\)/);
  assert.match(md, /`ALMA·ASHGROVE·+`/);
  assert.ok(!/<|>(?!\\)/.test(md.replace(/\\>/g, '')), 'no raw angle brackets');
  const r = P.parseAch('6' + '2'.repeat(10) + '`<b>x</b>`'.padEnd(83, ' '));
  const d = D.describeAt(r, 0, 20);
  assert.ok(D.hoverMarkdown(d).includes('`` '), 'backticks in the value use a longer code fence');
});

test('paths: header, controls, addenda, filler', () => {
  assert.equal(D.pathAt(valid, 0, 5), 'File header > Immediate destination (4-13)');
  assert.equal(D.pathAt(valid, 4, 85), 'Batch 1 > Entry 2 > Addenda 1 > Addenda sequence number (84-87)');
  assert.equal(D.pathAt(valid, 6, 1), 'Batch 1 > Batch control > Record type code (1)');
  assert.equal(D.pathAt(valid, 7, 52), 'Batch 2 > Batch header > Standard Entry Class code (51-53)');
  assert.equal(D.pathAt(valid, 12, 40), 'File control > Total debit entry dollar amount in file (32-43)');
  assert.equal(D.pathAt(valid, 15, 40), 'Filler record 3');
});

test('outline: batches with totals, entries, addenda, controls and filler', () => {
  const roots = O.rootNodes(valid);
  assert.deepEqual(roots.map((n) => n.label), ['File header', 'Batch 1: PPD HARBOR LANE CO', 'Batch 2: CCD HARBOR LANE CO', 'File control', 'Filler']);
  assert.equal(roots[1].detail, '3 entries · credits 4,966.25 · 2026-11-13');
  const kids = O.childrenOf(valid, roots[1]);
  assert.deepEqual(kids.map((n) => n.label), ['Batch header', 'Entry 1: ALMA ASHGROVE', 'Entry 2: BORIS FERNHALL', 'Entry 3: CELIA DUNMORE', 'Batch control']);
  assert.equal(kids[2].detail, '32 credit 2,150.75 · 1 addenda');
  assert.deepEqual(O.childrenOf(valid, kids[2]).map((n) => n.label + ' ' + n.detail), ['Addenda 1 (05) SALARY NOVEMBER PART 1']);
  assert.equal(roots[4].detail, '7 records of nines');
  const list = O.batchList(valid);
  assert.equal(list[1].detail, '2 entries, 1 addenda · debits 15,620.40 · credits 0.00');
});

test('outline: a batch of 1,200 entries is listed in pages of 500', () => {
  const g = G.generate({ sec: 'PPD', direction: 'credit', count: 1200, batches: 1, min: 100n, max: 200n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, seed: 2 });
  const p = P.parseAch(g.text);
  const batch = O.rootNodes(p).find((n) => n.kind === 'batch');
  const kids = O.childrenOf(p, batch);
  assert.deepEqual(kids.map((n) => n.label), ['Batch header', 'Entries 1 to 500', 'Entries 501 to 1000', 'Entries 1001 to 1200', 'Batch control']);
  assert.equal(O.childrenOf(p, kids[3]).length, 200);
  assert.match(O.childrenOf(p, kids[3])[0].label, /^Entry 1001: /);
  assert.equal(O.symbols(p)[1].children.length, 1200, 'symbols list entries up to the limit');
  assert.equal(O.symbols(p, 1000)[1].children.length, 0, 'above the limit only batches');
});

test('symbols carry offsets inside the text', () => {
  const syms = O.symbols(valid);
  assert.deepEqual(syms.map((s) => s.kind), ['file-header', 'batch', 'batch', 'file-control', 'filler']);
  const text = valid.records.text;
  for (const s of syms) {
    assert.ok(s.start >= 0 && s.end <= text.length && s.selStart >= s.start && s.selEnd <= s.end);
    for (const c of s.children) assert.ok(c.start >= s.start && c.end <= s.end);
  }
  assert.equal(syms[1].children[1].children.length, 1);
});
