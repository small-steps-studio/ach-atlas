'use strict';
// Record layouts, reading records and the file structure.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/ach/layout');
const P = require('../src/ach/parse');
const C = require('../src/ach/codes');
const samples = require('../src/samples');

test('every layout covers positions 1 to 94 without gaps or overlaps', () => {
  for (const lay of L.ALL) {
    let next = 1;
    for (const f of lay.fields) {
      assert.equal(f.start, next, lay.name + ': ' + f.name);
      assert.equal(f.end, f.start + f.length - 1);
      assert.ok(f.note.length > 0, lay.name + ': ' + f.name + ' needs a note');
      next = f.end + 1;
    }
    assert.equal(next, 95, lay.name);
  }
});

test('known field positions (facts of the file layout)', () => {
  const at = (lay, name) => { const f = L.field(lay, name); return [f.start, f.end]; };
  assert.deepEqual(at(L.FILE_HEADER, 'Immediate destination'), [4, 13]);
  assert.deepEqual(at(L.FILE_HEADER, 'File creation date'), [24, 29]);
  assert.deepEqual(at(L.FILE_HEADER, 'Record size'), [35, 37]);
  assert.deepEqual(at(L.BATCH_HEADER, 'Standard Entry Class code'), [51, 53]);
  assert.deepEqual(at(L.BATCH_HEADER, 'Effective entry date'), [70, 75]);
  assert.deepEqual(at(L.BATCH_HEADER, 'Originating DFI identification'), [80, 87]);
  assert.deepEqual(at(L.ENTRY_PPD, 'Amount'), [30, 39]);
  assert.deepEqual(at(L.ENTRY_PPD, 'Trace number'), [80, 94]);
  assert.deepEqual(at(L.ENTRY_CTX, 'Number of addenda records'), [55, 58]);
  assert.deepEqual(at(L.ENTRY_IAT, 'Number of addenda records'), [13, 16]);
  assert.deepEqual(at(L.ADDENDA_05, 'Entry detail sequence number'), [88, 94]);
  assert.deepEqual(at(L.ADDENDA_99, 'Original entry trace number'), [7, 21]);
  assert.deepEqual(at(L.BATCH_CONTROL, 'Entry hash'), [11, 20]);
  assert.deepEqual(at(L.BATCH_CONTROL, 'Total credit entry dollar amount'), [33, 44]);
  assert.deepEqual(at(L.FILE_CONTROL, 'Block count'), [8, 13]);
  assert.deepEqual(at(L.FILE_CONTROL, 'Total credit entry dollar amount in file'), [44, 55]);
  assert.equal(L.entryLayout('CCD').fields[7].name, 'Receiving company name');
  assert.equal(L.entryLayout('WEB').fields[8].name, 'Payment type code');
  assert.equal(L.entryLayout('ARC'), L.ENTRY_OTHER);
  assert.equal(L.addendaLayout('17'), L.ADDENDA_IAT);
  assert.equal(L.addendaLayout('42'), L.ADDENDA_OTHER);
  assert.equal(L.fieldAt(L.ENTRY_PPD, 35).name, 'Amount');
  assert.equal(L.fieldAt(L.ENTRY_PPD, 95), null);
});

test('transaction codes: account type, direction and kind', () => {
  const t = C.transactionCode;
  assert.deepEqual([t('22').direction, t('22').kind, t('22').account], ['credit', 'live', 'checking account']);
  assert.deepEqual([t('27').direction, t('27').kind], ['debit', 'live']);
  assert.deepEqual([t('33').direction, t('33').kind, t('33').account], ['credit', 'prenote', 'savings account']);
  assert.deepEqual([t('38').direction, t('38').kind], ['debit', 'prenote']);
  assert.deepEqual([t('49').direction, t('49').kind, t('49').account], ['debit', 'zero', 'general ledger account']);
  assert.deepEqual([t('55').direction, t('55').kind, t('55').account], ['debit', 'live', 'loan account']);
  assert.deepEqual([t('21').direction, t('21').kind], ['credit', 'return']);
  assert.deepEqual([t('56').direction, t('56').kind], ['debit', 'return']);
  for (const bad of ['25', '35', '45', '57', '58', '59', '20', '61', '81', '12', '2', '222', 'AB', '']) assert.equal(t(bad).valid, false, bad);
  let valid = 0;
  for (let n = 10; n < 100; n++) if (t(String(n)).valid) valid++;
  assert.equal(valid, 30, '8 codes each for checking, savings and general ledger, 6 for loans');
});

test('records: line breaks LF, CRLF and CR, trailing break, blank lines, byte order mark', () => {
  const a = 'A'.repeat(94);
  const b = 'B'.repeat(94);
  for (const eol of ['\n', '\r\n', '\r']) {
    const r = P.readRecords(a + eol + b + eol);
    assert.equal(r.count, 2, JSON.stringify(eol));
    assert.equal(r.lineBreak, eol);
    assert.equal(r.trailingBreak, true);
    assert.equal(P.recordText(r, 1), b);
  }
  const noTrail = P.readRecords(a + '\n' + b);
  assert.equal(noTrail.trailingBreak, false);
  const blank = P.readRecords(a + '\n\n' + b + '\n');
  assert.equal(blank.count, 2);
  assert.deepEqual(blank.blankLines, [95]);
  const bom = P.readRecords('﻿' + a + '\n');
  assert.equal(bom.bom, true);
  assert.equal(bom.starts[0], 1);
  assert.equal(P.readRecords('').count, 0);
  assert.equal(P.readRecords('\n\n').count, 0);
});

test('records: a file without line breaks is read as 94-character records', () => {
  const text = 'A'.repeat(94) + 'B'.repeat(94) + 'C'.repeat(50);
  const r = P.readRecords(text);
  assert.equal(r.unwrapped, true);
  assert.equal(r.count, 3);
  assert.deepEqual(Array.from(r.lengths.subarray(0, 3)), [94, 94, 50]);
  const withBreak = P.readRecords('A'.repeat(188) + '\r\n');
  assert.equal(withBreak.unwrapped, true);
  assert.equal(withBreak.count, 2);
  assert.equal(P.readRecords('A'.repeat(94)).unwrapped, false);
});

test('fields of short records read as blanks', () => {
  const r = P.readRecords('6221234');
  assert.equal(P.fieldOf(r, 0, 2, 2), '22');
  assert.equal(P.fieldOf(r, 0, 4, 8), '1234    ');
  assert.equal(P.fieldOf(r, 0, 80, 15), ' '.repeat(15));
});

test('structure of the sample: header, two batches, controls, filler', () => {
  const p = P.parseAch(samples.sampleFor('valid').text);
  const s = p.structure;
  assert.equal(p.records.count, 20);
  assert.equal(s.header, 0);
  assert.equal(s.batches.length, 2);
  assert.deepEqual(s.batches.map((b) => [b.header, b.first, b.end, b.control, b.sec]), [[1, 2, 6, 6, 'PPD'], [7, 8, 11, 11, 'CCD']]);
  assert.equal(s.fileControl, 12);
  assert.deepEqual([s.fillerStart, s.fillerCount], [13, 7]);
  assert.deepEqual(Array.from(P.entriesOf(p.records, s.batches[0])), [2, 3, 5]);
  assert.deepEqual(P.addendaOf(p.records, 3, 6), [4]);
  assert.equal(P.batchOf(s, 4), s.batches[0]);
  assert.equal(P.batchOf(s, 9), s.batches[1]);
  assert.equal(P.batchOf(s, 0), null);
  assert.equal(P.batchOf(s, 15), null);
  assert.deepEqual([s.misplaced, s.afterControl, s.extraHeaders], [[], [], []]);
});

test('structure: records out of place are collected with a reason', () => {
  const h = '101' + ' '.repeat(91);
  const bh = '5220' + ' '.repeat(90);
  const e = '622' + ' '.repeat(91);
  const a = '705' + ' '.repeat(91);
  const bc = '8220' + ' '.repeat(90);
  const fc = '9' + ' '.repeat(93);
  const nines = '9'.repeat(94);
  const s = P.parseAch([e, h, bh, a, e, bh, e, bc, bc, nines, fc, h, nines].join('\n')).structure;
  assert.deepEqual(s.misplaced.map((m) => m.reason), ['entry-outside-batch', 'header-late', 'batch-without-control', 'control-without-batch', 'filler-before-control']);
  assert.deepEqual(s.afterControl, [11]);
  assert.equal(s.fillerCount, 1);
});

test('first-record detection of ACH files', () => {
  assert.equal(P.looksLikeAch(samples.sampleFor('valid').text), true);
  assert.equal(P.looksLikeAch('﻿' + samples.sampleFor('valid').text), true);
  assert.equal(P.looksLikeAch(samples.sampleFor('valid').text.replace(/\n/g, '')), true, 'unwrapped');
  for (const bad of ['', 'hello', '101 not an ach file at all', 'ISA*00*', '{"a":1}', '1'.repeat(94)]) assert.equal(P.looksLikeAch(bad), false, bad);
});
