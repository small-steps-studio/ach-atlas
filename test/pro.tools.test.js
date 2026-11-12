'use strict';
// Recompute Control Records, Compare, Split and Merge, Export, Reconciliation report.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const V = require('../src/ach/values');
const F = require('../src/pro/fixup');
const Cmp = require('../src/pro/compare');
const S = require('../src/pro/splitmerge');
const E = require('../src/pro/export');
const R = require('../src/pro/reconcile');
const G = require('../src/pro/generate');
const samples = require('../src/samples');
const { corpusFiles, codesOf } = require('./helpers/load');

const NONE = { errors: [], warnings: [], notes: [] };
const valid = samples.sampleFor('valid').text;
const CONTROL_CODES = ['ACH-BATCH-COUNT', 'ACH-BATCH-HASH', 'ACH-BATCH-DEBITS', 'ACH-BATCH-CREDITS', 'ACH-FILE-BATCH-COUNT', 'ACH-FILE-BLOCK-COUNT', 'ACH-FILE-ENTRY-COUNT', 'ACH-FILE-HASH',
  'ACH-FILE-DEBITS', 'ACH-FILE-CREDITS', 'ACH-BLOCKING', 'ACH-RECORD-LENGTH', 'ACH-BATCH-CONTROL-MISSING', 'ACH-FILE-CONTROL-MISSING', 'ACH-SERVICE-CLASS-MISMATCH', 'ACH-COMPANY-ID-MISMATCH',
  'ACH-ODFI-MISMATCH', 'ACH-BATCH-NUMBER-MISMATCH', 'ACH-RESERVED', 'ACH-BLANK-LINE'];
function gen(o) { return G.generate(Object.assign({ sec: 'PPD', direction: 'mixed', count: 40, batches: 3, min: 1n, max: 100000n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, seed: 1 }, o || {})).text; }

test('fix-up: the sample with problems loses its control problems and keeps the others', () => {
  const res = F.fixUp(samples.sampleFor('problems').text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.changes, ['1 record padded with spaces to 94 characters.', 'Batch 2 control: entry hash 0114543535 to 0114543534.']);
  assert.deepEqual(codesOf(res.text).errors, ['ACH-EFFECTIVE-DATE', 'ACH-RDFI-CHECK-DIGIT']);
});

test('fix-up: a correct file is left exactly as it is', () => {
  const res = F.fixUp(valid);
  assert.deepEqual([res.ok, res.changed, res.changes], [true, false, []]);
  assert.equal(res.text, valid);
});

test('fix-up then check: no control, count, hash, total or filler problem remains in any corpus file it accepts', () => {
  let accepted = 0;
  let refused = 0;
  for (const f of corpusFiles()) {
    const res = F.fixUp(f.text);
    if (!res.ok) { refused++; assert.ok(res.reason.length > 20); continue; }
    accepted++;
    const after = codesOf(res.text);
    for (const c of CONTROL_CODES) {
      assert.ok(after.errors.indexOf(c) === -1 && after.warnings.indexOf(c) === -1, f.name + ': ' + c + ' remains');
    }
    const again = F.fixUp(res.text);
    assert.equal(again.changed, false, f.name + ': the fix-up is not idempotent');
  }
  assert.ok(accepted >= 90, 'accepted ' + accepted);
  assert.ok(refused >= 4, 'refused ' + refused);
});

test('fix-up: refusals name the reason and change nothing', () => {
  const byName = (n) => corpusFiles().find((f) => f.name === n).text;
  assert.match(F.fixUp(byName('e02-long-entry.ach')).reason, /more than 94/);
  assert.match(F.fixUp(byName('e03-unknown-type.ach')).reason, /unknown record type/);
  assert.match(F.fixUp(byName('e09-entry-outside.ach')).reason, /out of order/);
  assert.match(F.fixUp(byName('e06-no-header.ach')).reason, /file header/);
  assert.match(F.fixUp(byName('e78-adv.ach')).reason, /automated accounting advice/);
  assert.match(F.fixUp('').reason, /no records/);
  const big = valid.split('\n');
  big[2] = big[2].slice(0, 29) + '9999999999' + big[2].slice(39);
  const lines = [big[0], big[1]];
  for (let k = 0; k < 120; k++) lines.push(big[2]);
  lines.push(big[6]);
  const res = F.fixUp(lines.join('\n'));
  assert.equal(res.ok, false);
  assert.match(res.reason, /does not fit into 12 digits/);
});

test('fix-up: missing controls are added, filler completed, line breaks and the final break kept', () => {
  const crlf = valid.replace(/\n/g, '\r\n');
  const lines = crlf.split('\r\n');
  const cut = lines.filter((l, k) => k !== 6 && k !== 12 && l !== '9'.repeat(94));
  const res = F.fixUp(cut.join('\r\n'));
  assert.equal(res.ok, true);
  assert.deepEqual(res.changes, ['Batch 1: batch control added.', 'File control added.', 'Filler records: 0 to 7.']);
  assert.equal(res.text, crlf);
  assert.deepEqual(codesOf(res.text), NONE);
  const noFiller = F.fixUp(valid, { filler: false });
  assert.equal(P.parseAch(noFiller.text).records.count, 13);
});

test('compare: identical files, and the same file with ignored trace numbers and dates', () => {
  assert.equal(Cmp.compare(valid, valid).identical, true);
  const g1 = gen({ seed: 4 });
  const renumbered = g1.replace(/^(6.{78})590123400(\d{6})$/gm, (m, a, s) => a + '590123400' + String(Number(s) + 500).padStart(6, '0'));
  assert.equal(Cmp.compare(g1, renumbered).identical, false);
  const ignored = Cmp.compare(g1, renumbered, { ignoreTrace: true });
  assert.equal(ignored.identical, true, JSON.stringify(ignored.counts));
  const redated = g1.replace(/^(1.{22})261112/m, '$1261115').replace(/^(5.{68})261113/gm, '$1261116');
  assert.equal(Cmp.compare(g1, redated).identical, false);
  assert.equal(Cmp.compare(g1, redated, { ignoreDates: true }).identical, true);
});

test('compare: added, removed and changed entries with their fields and totals', () => {
  const a = valid;
  const lines = a.split('\n');
  lines[2] = lines[2].slice(0, 29) + '0000184251' + lines[2].slice(39);
  lines.splice(5, 1);
  lines.splice(10, 0, '627564200786' + 'NEW ACCOUNT'.padEnd(17) + '0000000500' + 'INV-2026-200'.padEnd(15) + 'OLD MILL BAKERY'.padEnd(22) + '  0' + '590123400000009');
  const b = F.fixUp(lines.join('\n')).text;
  const res = Cmp.compare(a, b, { labels: { a: 'monday.ach', b: 'tuesday.ach' } });
  assert.deepEqual(res.counts, { batchesAdded: 0, batchesRemoved: 0, batchesChanged: 2, entriesAdded: 1, entriesRemoved: 1, entriesChanged: 1 });
  const b1 = res.batches[0];
  assert.equal(b1.removed[0].name, 'CELIA DUNMORE');
  assert.deepEqual(b1.changed[0].diffs, [{ field: 'Amount', a: '1,842.50', b: '1,842.51' }]);
  assert.equal(res.batches[1].added[0].amount, '5.00');
  assert.equal(res.b.credit - res.a.credit, 1n - 97300n);
  const md = Cmp.toMarkdown(res, 'ACH comparison');
  assert.match(md, /\| Credits \| 4,966\.25 \| 3,993\.26 \| -972\.99 \|/);
  assert.match(md, /\| changed \| 590123400000001 \| ALMA ASHGROVE \| 1,842\.51 \| Amount: 1,842\.50 to 1,842\.51 \|/);
  const csv = Cmp.toCsv(res);
  assert.match(csv, /entry removed,1,1,590123400000003,CELIA DUNMORE,amount,973\.00,/);
  assert.match(csv, /entry added,2,2,590123400000009,OLD MILL BAKERY,amount,,5\.00/);
});

test('compare: batches that exist in only one file', () => {
  const two = gen({ batches: 2, count: 10, seed: 9 });
  const p = P.parseAch(two);
  const r = p.records;
  const b2 = p.structure.batches[1];
  const keep = [];
  for (let i = 0; i < r.count; i++) if (i < b2.header || i > b2.control) keep.push(P.recordText(r, i));
  const one = F.fixUp(keep.join('\n')).text;
  const res = Cmp.compare(two, one);
  assert.equal(res.counts.batchesRemoved, 1);
  assert.equal(res.counts.entriesRemoved, 5);
  const back = Cmp.compare(one, two);
  assert.equal(back.counts.batchesAdded, 1);
});

test('compare: 18-digit-like values are compared as text, never as numbers', () => {
  const lines = valid.split('\n');
  const changed = lines.slice();
  changed[2] = changed[2].slice(0, 12) + '44100277190000001' + changed[2].slice(29);
  const same = lines.slice();
  same[2] = same[2].slice(0, 12) + '44100277190000001' + same[2].slice(29);
  const other = lines.slice();
  other[2] = other[2].slice(0, 12) + '44100277190000002' + other[2].slice(29);
  assert.equal(Cmp.compare(same.join('\n'), changed.join('\n')).identical, true);
  const res = Cmp.compare(same.join('\n'), other.join('\n'));
  assert.deepEqual(res.batches[0].changed[0].diffs, [{ field: 'DFI account number', a: '44100277190000001', b: '44100277190000002' }]);
});

test('split: one valid file per batch; merge: back to the same batches and totals', () => {
  const src = gen({ batches: 4, count: 30, seed: 3, sec: 'CCD', addenda: true });
  const sp = S.split(src, 'payments day 1');
  assert.equal(sp.ok, true);
  assert.deepEqual(sp.files.map((f) => f.name), ['payments-day-1-batch-0000001.ach', 'payments-day-1-batch-0000002.ach', 'payments-day-1-batch-0000003.ach', 'payments-day-1-batch-0000004.ach']);
  for (const f of sp.files) assert.deepEqual(codesOf(f.text), NONE, f.name);
  assert.deepEqual(sp.files.map((f) => f.entries), [8, 8, 7, 7]);
  const merged = S.merge(sp.files.map((f) => ({ name: f.name, text: f.text })));
  assert.equal(merged.ok, true);
  assert.deepEqual(codesOf(merged.text), NONE);
  assert.equal(merged.text, src, 'merging the split parts gives the original file back');
});

test('merge: renumbers batches, notes duplicate trace numbers, refuses other destinations and broken files', () => {
  const a = gen({ seed: 1, count: 6, batches: 2 });
  const res = S.merge([{ name: 'a.ach', text: a }, { name: 'b.ach', text: a }]);
  assert.equal(res.ok, true);
  assert.equal(res.batches, 4);
  assert.match(res.notes.join(' '), /6 trace numbers appear in more than one/);
  const p = P.parseAch(res.text);
  assert.deepEqual(p.structure.batches.map((b) => P.fieldOf(p.records, b.header, 88, 7)), ['0000001', '0000002', '0000003', '0000004']);
  assert.deepEqual(codesOf(res.text).errors, ['ACH-TRACE-DUPLICATE']);
  const other = G.generate({ sec: 'PPD', direction: 'credit', count: 3, batches: 1, min: 1n, max: 9n, effectiveDate: '261113', destination: '573000126', seed: 2 }).text;
  assert.match(S.merge([{ name: 'a.ach', text: a }, { name: 'c.ach', text: other }]).reason, /different|same destination/);
  assert.match(S.merge([{ name: 'a.ach', text: a }]).reason, /at least two/);
  const short = corpusFiles().find((f) => f.name === 'e01-short-header.ach').text;
  assert.match(S.merge([{ name: 'a.ach', text: a }, { name: 's.ach', text: short }]).reason, /94 characters/);
  assert.match(S.split(short, 'x').reason, /94 characters/);
  assert.match(S.split(corpusFiles().find((f) => f.name === 'e09-entry-outside.ach').text, 'x').reason, /out of order/);
});

test('export CSV: one row per entry, exact amounts, formula neutralisation and quoting', () => {
  const lines = valid.split('\n');
  lines[2] = lines[2].slice(0, 54) + '=HYPERLINK("X"),A'.padEnd(22) + lines[2].slice(76);
  const csv = E.toCsv(P.parseAch(lines.join('\n')));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 6);
  assert.equal(rows[0], E.COLUMNS.join(','));
  assert.match(rows[1], /^1,0000001,HARBOR LANE CO,1520749386,PPD,2026-11-13,1,22,credit,live,checking account,581234560,4410027719,1842\.50,184250,EMP0001,"'=HYPERLINK\(""X""\),A",,0,,590123400000001$/);
  assert.match(rows[2], /,2150\.75,215075,EMP0002,BORIS FERNHALL,,1,SALARY NOVEMBER PART 1,590123400000002$/);
  assert.match(rows[4], /,27,debit,live,checking account,564200786,77120045,12500\.00,1250000,/);
});

test('export JSON: batches with entries, amounts as strings, totals', () => {
  const data = JSON.parse(E.toJson(P.parseAch(valid)));
  assert.equal(data.file.immediate_destination, '590123400');
  assert.equal(data.file.creation_date, '2026-11-12');
  assert.equal(data.batches.length, 2);
  assert.equal(data.batches[0].entries.length, 3);
  assert.equal(data.batches[0].entries[0].amount, '1842.50');
  assert.equal(typeof data.batches[0].entries[0].amount_cents, 'string');
  assert.deepEqual(data.totals, { batches: 2, entries: 5, debits: '15620.40', credits: '4966.25' });
  const empty = JSON.parse(E.toJson(P.parseAch(corpusFiles().find((f) => f.name === 'e45-empty-batch.ach').text)));
  assert.equal(empty.batches.length, 2, 'a batch without entries is listed too');
});

test('reconciliation: totals by file, day and SEC code; anomalies; skipped files', () => {
  const day1 = gen({ seed: 21, count: 12, batches: 2 });
  const day2 = gen({ seed: 22, count: 8, batches: 1, effectiveDate: '261116' });
  const res = R.reconcile([
    { name: 'day1.ach', text: day1 }, { name: 'copy-of-day1.ach', text: day1 }, { name: 'day2.ach', text: day2 },
    { name: 'problems.ach', text: samples.sampleFor('problems').text }, { name: 'notes.txt', text: 'not an ACH file' }
  ]);
  assert.equal(res.totals.files, 4);
  assert.deepEqual(res.skipped, [{ name: 'notes.txt', reason: 'does not start with an ACH file header' }]);
  assert.deepEqual(res.days.map((d) => d.date), ['2026-11-13', '2026-11-16', '261131'], 'an invalid date is listed as written');
  const kinds = res.anomalies.map((a) => a.kind);
  assert.ok(kinds.indexOf('duplicate-batch') !== -1);
  assert.ok(kinds.indexOf('duplicate-trace') !== -1);
  assert.ok(kinds.indexOf('problems') !== -1);
  const sum = res.files.reduce((a, f) => a + f.debit + f.credit, 0n);
  assert.equal(sum, res.totals.debit + res.totals.credit);
  const html = R.toHtml(res, 'Report <b>1</b>');
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('Report &lt;b&gt;1&lt;/b&gt;'));
  assert.match(html, /Content-Security-Policy/);
  const csv = R.toCsv(res);
  assert.match(csv, /^Section,File,/);
  assert.match(csv, /\r\ntotal,,,,,,,7,37,/);
});

test('reconciliation: returns and notifications of change are listed', () => {
  const files = corpusFiles().filter((f) => f.name === 'v11-returns.ach' || f.name === 'v12-cor.ach').map((f) => ({ name: f.name, text: f.text }));
  const res = R.reconcile(files);
  assert.deepEqual(res.anomalies.map((a) => a.kind).sort(), ['changes', 'returns']);
  assert.equal(res.batches.find((b) => b.file === 'v11-returns.ach').returns, 2);
});

test('values written by the Pro tools use exact decimals for large totals', () => {
  const big = corpusFiles().find((f) => f.name === 'v18-large-amounts.ach').text;
  const data = JSON.parse(E.toJson(P.parseAch(big)));
  // 99,999,999.98 + 99,999,999.97 + 99,999,999.96 = 299,999,999.91
  assert.equal(data.totals.credits, '299999999.91');
  assert.equal(V.formatCents(29999999991n), '299,999,999.91');
});
