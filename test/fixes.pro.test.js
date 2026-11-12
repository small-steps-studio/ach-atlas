'use strict';
// Regression tests for defects found in the independent review of the Pro tools and the readers:
// Compare says "No differences" for files that differ, ADV batches in Split / Merge / Anonymise,
// entry layouts of SEC codes without a detailed check, slow outline and anonymise, the formula
// setting, split file ID modifiers, return and change codes, malformed routing values.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const P = require('../src/ach/parse');
const L = require('../src/ach/layout');
const C = require('../src/ach/codes');
const D = require('../src/ach/describe');
const O = require('../src/ach/outline');
const W = require('../src/ach/write');
const Cmp = require('../src/pro/compare');
const S = require('../src/pro/splitmerge');
const E = require('../src/pro/export');
const R = require('../src/pro/reconcile');
const A = require('../src/pro/anonymise');
const G = require('../src/pro/generate');
const U = require('../src/util');
const samples = require('../src/samples');
const { codeCounts } = require('./helpers/load');

const valid = samples.sampleFor('valid').text;
const sampleLines = () => valid.split('\n').slice(0, 20);
const join = (lines) => lines.join('\n') + '\n';

// ---- defect 1: Compare must compare the whole file ------------------------------------------------

const MUTATIONS = {
  'batch control entry hash': (l) => { l[6] = W.setField(l[6], 11, '0000000001'); return l; },
  'file control total credit': (l) => { l[12] = W.setField(l[12], 44, '000000000001'); return l; },
  'file control deleted': (l) => { l.splice(12, 1); return l; },
  'all filler records removed': (l) => l.slice(0, 13),
  'an entry placed after the file control': (l) => { l.splice(13, 0, l[2]); return l; },
  'a second file header after the first': (l) => { l.splice(1, 0, l[0]); return l; },
  'reserved field of a batch control': (l) => { l[6] = W.setField(l[6], 74, 'ZZZZZZ'); return l; }
};

for (const [name, mutate] of Object.entries(MUTATIONS)) {
  test('compare: "' + name + '" is a difference, never "No differences"', () => {
    const changed = join(mutate(sampleLines()));
    for (const [a, b] of [[valid, changed], [changed, valid]]) {
      const res = Cmp.compare(a, b);
      assert.equal(res.identical, false, name);
      const md = Cmp.toMarkdown(res, 'ACH comparison');
      assert.ok(!/No differences/.test(md), name + ': the report must not say "No differences"');
      assert.ok(!/no differences/.test(Cmp.summaryText(res)), name + ': the message must not say "no differences"');
      assert.ok(/\.$/.test(Cmp.summaryText(res)));
      assert.ok(Cmp.toCsv(res).split('\r\n').filter(Boolean).length >= 2, name + ': the CSV lists the difference');
    }
  });
}

test('compare: each difference is named where it is', () => {
  const res = (m) => Cmp.compare(valid, join(MUTATIONS[m](sampleLines())));
  const hash = res('batch control entry hash');
  assert.deepEqual(hash.batches[0].control, [{ field: 'Entry hash', a: '0174435808', b: '0000000001' }]);
  assert.equal(hash.batches[0].status, 'changed');
  assert.equal(hash.counts.batchesChanged, 1);
  assert.match(Cmp.toMarkdown(hash), /Batch control field \| First \| Second[\s\S]*Entry hash \| 0174435808 \| 0000000001/);
  assert.deepEqual(res('file control total credit').structure.fileControl, [{ field: 'Total credit entry dollar amount in file', a: '4,966.25', b: '0.01' }]);
  assert.deepEqual(res('file control deleted').structure.fileControl, [{ field: 'File control record', a: 'present', b: 'missing' }]);
  const filler = res('all filler records removed');
  assert.deepEqual([filler.structure.filler.a, filler.structure.filler.b], [7, 0]);
  assert.match(Cmp.toMarkdown(filler), /## Filler records[\s\S]*7 in the first file, 0 in the second/);
  const late = res('an entry placed after the file control');
  assert.equal(late.structure.stray.added.length, 1);
  assert.match(Cmp.toMarkdown(late), /## Records out of place/);
  const header = res('a second file header after the first');
  assert.equal(header.structure.stray.added.length, 1);
  assert.deepEqual(res('reserved field of a batch control').batches[0].control.map((d) => d.field), ['Reserved']);
  assert.match(Cmp.summaryText(res('file control deleted')), /also different: the file control/);
});

test('compare: unknown records and addenda without an entry inside a batch are compared too', () => {
  const unknown = sampleLines();
  unknown.splice(3, 0, '3' + 'UNKNOWN RECORD'.padEnd(93));
  const res = Cmp.compare(valid, join(unknown));
  assert.equal(res.identical, false);
  assert.deepEqual([res.structure.other.added.length, res.structure.other.removed.length], [1, 0]);
  const orphan = sampleLines();
  orphan.splice(2, 0, orphan[4]);
  assert.equal(Cmp.compare(valid, join(orphan)).identical, false);
  assert.match(Cmp.toMarkdown(Cmp.compare(join(unknown), valid)), /## Other records/);
});

test('compare: a different order of entries or of batches is a difference', () => {
  const swapped = sampleLines();
  [swapped[2], swapped[5]] = [swapped[5], swapped[2]];
  const res = Cmp.compare(valid, join(swapped));
  assert.equal(res.identical, false);
  assert.equal(res.batches[0].reordered, true);
  assert.match(Cmp.toMarkdown(res), /entries of this batch appear in a different order/);
  const l = sampleLines();
  const reversed = join([l[0]].concat(l.slice(7, 12), l.slice(1, 7), l.slice(12)));
  const res2 = Cmp.compare(valid, reversed);
  assert.equal(res2.structure.batchOrder, true);
  assert.equal(res2.identical, false);
  assert.match(Cmp.toMarkdown(res2), /## Batch order/);
  assert.match(Cmp.summaryText(res2), /the order of the batches/);
});

test('compare: files that are the same still compare as the same', () => {
  assert.equal(Cmp.compare(valid, valid).identical, true);
  assert.equal(Cmp.compare(valid, valid.replace(/\n/g, '\r\n')).identical, true, 'CRLF against LF');
  assert.equal(Cmp.compare(valid, valid.replace(/\n/g, '')).identical, true, 'wrapped against unwrapped');
  assert.match(Cmp.summaryText(Cmp.compare(valid, valid)), /^no differences/);
  const g = G.generate({ sec: 'PPD', direction: 'mixed', count: 12, batches: 3, min: 1n, max: 100000n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, seed: 11 }).text;
  const renumbered = g.replace(/^(5.{86})(\d{7})$/gm, (m, a, n) => a + String(Number(n) + 40).padStart(7, '0')).replace(/^(8.{86})(\d{7})$/gm, (m, a, n) => a + String(Number(n) + 40).padStart(7, '0'));
  assert.equal(Cmp.compare(g, renumbered).identical, false, 'batch numbers differ');
  assert.equal(Cmp.compare(g, renumbered, { ignoreTrace: true }).identical, true, 'ignoring trace and batch numbers, headers and controls');
});

test('compare: the CSV report lists controls, filler and records out of place', () => {
  const res = Cmp.compare(valid, join(MUTATIONS['file control total credit'](MUTATIONS['batch control entry hash'](sampleLines()))));
  const csv = Cmp.toCsv(res);
  assert.match(csv, /batch control,1,1,,,Entry hash,0174435808,0000000001/);
  assert.match(csv, /file control,,,,,Total credit entry dollar amount in file,"4,966\.25",0\.01/);
});

// ---- defect 2: ADV batches ------------------------------------------------------------------------------

function withAdvice() {
  const l = sampleLines();
  const header = '5' + '280' + W.text('HARBOR LANE CO', 16) + W.text('', 20) + '1520749386' + 'ADV' + W.text('ADVICE', 10) + W.text('', 6) + '261113' + '   ' + '1' + '59012340' + '0000003';
  const entry = '6' + '81' + '58123456' + '0' + W.text('ACCT 00112233', 15) + '000000123456' + W.text('ADVICE 12345 1', 15) + W.text('JORDAN ELMWOOD', 22) + '  ' + '0' + '012345670000001';
  const control = '8' + '280' + '000001' + '0058123456' + W.num(0, 20) + W.num(123456, 20) + W.text('', 19) + '01234567' + '0000003';
  assert.deepEqual([header.length, entry.length, control.length], [94, 94, 94]);
  l.splice(12, 0, header, entry, control);
  return join(l);
}

test('split and merge refuse automated accounting advice batches and write nothing', () => {
  const text = withAdvice();
  const sp = S.split(text, 'advice');
  assert.equal(sp.ok, false);
  assert.equal(sp.code, 'SPLIT-ADVICE-BATCH');
  assert.match(sp.reason, /batch 3 is an automated accounting advice batch, which this command does not rebuild\. Nothing was written\./);
  const mg = S.merge([{ name: 'a.ach', text: valid }, { name: 'b.ach', text: text }]);
  assert.equal(mg.ok, false);
  assert.equal(mg.code, 'SPLIT-ADVICE-BATCH');
  assert.match(mg.reason, /^b\.ach cannot be merged because batch 3 is an automated accounting advice batch/);
});

test('anonymise: an advice entry keeps its amount and its totals; account, name and routing are replaced', () => {
  const text = withAdvice();
  const out = A.createAnonymiser({ seed: 9, amounts: 'replace' }).anonymise(text);
  const before = text.split('\n');
  const after = out.text.split('\n');
  assert.equal(after.length, before.length);
  const [be, ae] = [before[13], after[13]];
  assert.equal(ae.slice(27, 39), '000000123456', 'amount (positions 28-39) is untouched');
  assert.notEqual(ae.slice(12, 27), be.slice(12, 27), 'account number replaced');
  assert.notEqual(ae.slice(54, 76), be.slice(54, 76), 'name replaced');
  assert.match(ae.slice(54, 76), /^PERSON \d{6}\s*$/);
  assert.equal(ae.slice(39, 54), be.slice(39, 54), 'advice routing number, file id and operator data are kept');
  assert.equal(ae.length, 94);
  const bc = before[14];
  const ac = after[14];
  assert.equal(ac.slice(20, 60), bc.slice(20, 60), 'the 20-digit debit and credit totals of the advice control are untouched');
  assert.equal(ac.slice(0, 10), bc.slice(0, 10));
  assert.equal(ac.slice(10, 20), '00' + ae.slice(3, 11), 'the entry hash follows the replaced routing number');
  assert.deepEqual(codeCounts(out.text), codeCounts(text), 'the same problems');
  assert.notEqual(after[1], before[1], 'the other batches are anonymised as before');
});

// ---- defect 3: entry layouts of SEC codes without a detailed check ----------------------------------------

function field(layout, start) { return L.fieldAt(layout, start); }

test('entry layouts: TRX and ATX carry the count of addenda records, CIE and MTE a name first, SHR a card account number, TEL a payment type code', () => {
  for (const sec of ['TRX', 'ATX']) {
    const lay = L.entryLayout(sec);
    assert.equal(field(lay, 55).name, 'Number of addenda records', sec);
    assert.equal(field(lay, 59).name, 'Receiving company name or ID number', sec);
    assert.equal(field(lay, 55).end, 58);
  }
  assert.equal(field(L.entryLayout('ATX'), 40).name, 'Original entry trace number');
  assert.equal(field(L.entryLayout('ACK'), 40).name, 'Original entry trace number');
  for (const sec of ['CIE', 'MTE']) {
    assert.equal(field(L.entryLayout(sec), 40).name, 'Individual name', sec);
    assert.equal(field(L.entryLayout(sec), 55).name, 'Individual identification number', sec);
  }
  assert.equal(field(L.entryLayout('SHR'), 55).name, 'Card account number');
  assert.equal(field(L.entryLayout('SHR'), 40).name, 'Card expiration date and document reference');
  assert.equal(field(L.entryLayout('TEL'), 77).name, 'Payment type code');
  assert.equal(field(L.entryLayout('PPD'), 77).name, 'Discretionary data');
  for (const sec of ['TRX', 'ATX', 'ACK', 'CIE', 'MTE', 'SHR', 'TEL']) {
    let covered = 0;
    for (const f of L.entryLayout(sec).fields) { assert.equal(f.start, covered + 1, sec); covered = f.end; }
    assert.equal(covered, 94, sec);
  }
});

test('hover: a card account number is not called a receiver name', () => {
  const l = sampleLines();
  l[7] = W.setField(l[7], 51, 'SHR');
  const parsed = P.parseAch(join(l));
  const d = D.describeAt(parsed, 8, 60);
  assert.equal(d.field.name, 'Card account number');
  assert.match(D.hoverMarkdown(d), /Entry detail \\\(SHR\\\): Card account number/);
  assert.ok(!/Receiver name/.test(D.hoverMarkdown(d)));
});

test('anonymise: TRX and ATX entries keep their count of addenda records', () => {
  for (const sec of ['TRX', 'ATX']) {
    const l = sampleLines();
    l[7] = W.setField(l[7], 51, sec);
    l[8] = W.setField(W.setField(l[8], 55, '0001'), 59, W.text('GREYSTONE MILLWORK', 16));
    l[10] = W.setField(W.setField(l[10], 55, '0000'), 59, W.text('PINECREST DENTAL', 16));
    const out = A.createAnonymiser({ seed: 4, amounts: 'keep' }).anonymise(join(l)).text.split('\n');
    assert.equal(out[8].slice(54, 58), '0001', sec);
    assert.equal(out[10].slice(54, 58), '0000', sec);
    assert.match(out[8].slice(58, 74), /^COMPANY \d{4}\s*$/, sec);
    assert.ok(!out.join('\n').includes('GREYSTONE'), sec);
  }
});

// ---- defect 8: slow outline and anonymise -------------------------------------------------------------------

test('outline: 60,000 batches without a batch control are listed at once', () => {
  const header = '101 590123400' + '1520749386' + '2611120915A094101' + 'RIVERSTONE TEST BANK   ' + 'HARBOR LANE CO         ' + '        ';
  const batchHeader = '5220' + 'HARBOR LANE CO'.padEnd(16) + ''.padEnd(20) + '1520749386' + 'PPD' + 'PAYROLL'.padEnd(10) + ''.padEnd(6) + '261113' + '   1' + '59012340' + '0000001';
  const parsed = P.parseAch(header + '\n' + new Array(60000).fill(batchHeader).join('\n') + '\n');
  let t = Date.now();
  const roots = O.rootNodes(parsed);
  const rootMs = Date.now() - t;
  t = Date.now();
  const symbols = O.symbols(parsed);
  const symbolMs = Date.now() - t;
  assert.equal(parsed.structure.batches.length, 60000);
  assert.equal(roots.filter((n) => n.kind === 'batch').length, 60000);
  assert.equal(roots.some((n) => n.kind === 'stray'), false, 'a batch header without a control is not a stray record');
  assert.equal(symbols.length, 60001);
  assert.ok(rootMs < 2500 && symbolMs < 2500, 'root nodes ' + rootMs + ' ms, symbols ' + symbolMs + ' ms');
});

test('anonymise: a file of about 47 MB with distinct values runs within a 400 MB heap', { timeout: 300000 }, () => {
  const helper = path.join(__dirname, 'helpers', 'anonymise-large.js');
  const r = cp.spawnSync(process.execPath, ['--max-old-space-size=400', helper, path.join(__dirname, '..')], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
  assert.equal(r.status, 0, 'the child did not finish: ' + (r.stderr || '').slice(0, 300));
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.sameLength, true);
  assert.ok(out.megabytes >= 45, out.megabytes + ' MB');
  assert.ok(out.ms < 60000, out.ms + ' ms');
});

test('anonymise: the same value gets the same replacement everywhere, a different seed another one', () => {
  const run = (seed) => A.createAnonymiser({ seed: seed, amounts: 'keep' }).anonymise(valid).text;
  assert.equal(run(5), run(5), 'the same seed gives the same copy');
  assert.notEqual(run(5), run(6));
  const out = run(5).split('\n');
  const first = valid.split('\n');
  assert.equal(out[2].slice(12, 29), out[2].slice(12, 29));
  // The account number 120044871 appears once; the identification EMP0001 stays one replacement in every record that holds it.
  const ids = new Set();
  for (let i = 0; i < first.length; i++) if (first[i].slice(39, 54) === 'EMP0001        ') ids.add(out[i].slice(39, 54));
  assert.equal(ids.size, 1);
  assert.notEqual(Array.from(ids)[0], 'EMP0001        ');
});

// ---- defect 9: the formula setting -----------------------------------------------------------------------------

test('CSV: formula cells get an apostrophe by default and the setting switches it off', () => {
  const hostile = valid.replace('ALMA ASHGROVE         ', '=1+1                  ').replace('BORIS FERNHALL ', '@SUM(A1:A2)    ');
  const parsed = P.parseAch(hostile);
  const on = E.toCsv(parsed);
  const off = E.toCsv(parsed, { neutraliseFormulas: false });
  assert.ok(on.includes(",'=1+1,") && on.includes(",'@SUM(A1:A2),"), 'protected by default');
  assert.ok(off.includes(',=1+1,') && off.includes(',@SUM(A1:A2),'), 'raw when switched off');
  assert.equal(E.toCsv(parsed, { neutraliseFormulas: true }), on);
  assert.equal(U.csvCell('=A1', { neutraliseFormulas: false }), '=A1');
  assert.equal(U.csvCell('=A1'), '\'=A1');
  assert.equal(U.csvCell('-5,5', { neutraliseFormulas: false }), '"-5,5"', 'CSV quoting stays when the protection is off');
  assert.equal(U.csvRow(['+1', 'x'], { neutraliseFormulas: false }), '+1,x\r\n');
  // Comparison and reconciliation reports follow the same option.
  const cmp = Cmp.compare(valid, hostile);
  assert.ok(Cmp.toCsv(cmp).includes(",'=1+1"));
  assert.ok(Cmp.toCsv(cmp, { neutraliseFormulas: false }).includes(',=1+1'));
  const rec = R.createReconciler({});
  rec.add('=evil.ach', hostile);
  assert.ok(R.toCsv(rec.result()).includes(",'=evil.ach,"));
  assert.ok(R.toCsv(rec.result(), { neutraliseFormulas: false }).includes(',=evil.ach,'));
});

// ---- defect 10: split gives every file its own file ID modifier -------------------------------------------------

test('split: every file has its own file ID modifier; the first keeps the source modifier', () => {
  const src = G.generate({ sec: 'PPD', direction: 'mixed', count: 40, batches: 4, min: 1n, max: 100000n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, seed: 3 }).text;
  const sp = S.split(src, 'day');
  assert.equal(sp.ok, true);
  const mods = sp.files.map((f) => f.text.charAt(33));
  assert.deepEqual(mods, ['A', 'B', 'C', 'D']);
  assert.equal(new Set(sp.files.map((f) => f.text.slice(0, 94))).size, 4, 'no two file headers are identical');
  assert.match(sp.notes[0], /own file ID modifier/);
  const own = src.replace(/^(.{33})A/, '$1C');
  assert.deepEqual(S.split(own, 'day').files.map((f) => f.text.charAt(33)), ['C', 'A', 'B', 'D']);
  // Merge of the split files in order gives the source file back.
  const merged = S.merge(sp.files.map((f) => ({ name: f.name, text: f.text })));
  assert.equal(merged.ok, true);
  assert.equal(merged.text, src);
});

test('split: more than 36 batches are refused with the reason', () => {
  const src = G.generate({ sec: 'PPD', direction: 'credit', count: 37, batches: 37, min: 1n, max: 1000n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, seed: 2 });
  assert.equal(src.ok, true, src.reason);
  const sp = S.split(src.text, 'many');
  assert.equal(sp.ok, false);
  assert.equal(sp.code, 'SPLIT-TOO-MANY');
  assert.match(sp.reason, /at most 36 files/);
  assert.deepEqual(S.modifiersFor('', 36).length, 36);
  assert.equal(new Set(S.modifiersFor('7', 36)).size, 36);
});

// ---- defect 11: return and change codes ----------------------------------------------------------------------------

test('return and change codes: the codes in daily use are explained', () => {
  for (const c of ['R01', 'R11', 'R17', 'R31', 'R33', 'R61', 'R62', 'R67', 'R68', 'R69', 'R70', 'R71', 'R72', 'R73', 'R74', 'R75', 'R76', 'R77', 'R80', 'R85']) assert.ok(C.RETURN_CODES[c] && C.RETURN_CODES[c].length > 10, c);
  for (const c of ['C01', 'C08', 'C13', 'C14', 'C61', 'C69']) assert.ok(C.CHANGE_CODES[c] && C.CHANGE_CODES[c].length > 10, c);
  const l = sampleLines();
  const rec = '7' + '99' + 'R11' + '590123400000001' + W.text('', 6) + '58123456' + W.text('', 44) + '590123400000001';
  l.splice(3, 0, rec);
  const parsed = P.parseAch(join(l));
  const d = D.describeAt(parsed, 3, 5);
  assert.equal(d.field.name, 'Return reason code');
  assert.match(d.meaning, /^R11: the receiver says the debit does not match the terms of the authorisation/);
  assert.match(D.describeAt(parsed, 3, 5).meaning, /R11/);
});

// ---- defect 14: malformed routing values are replaced too ---------------------------------------------------------------

test('anonymise: routing fields that are not eight digits are replaced, keeping their shape and their problem', () => {
  const l = sampleLines();
  l[2] = W.setField(l[2], 4, '5812345 ');
  l[1] = W.setField(l[1], 80, '5901234X');
  const text = join(l);
  const out = A.createAnonymiser({ seed: 21, amounts: 'keep' }).anonymise(text);
  const after = out.text.split('\n');
  assert.notEqual(after[2].slice(3, 11), '5812345 ');
  assert.match(after[2].slice(3, 11), /^[0-9]{7} $/);
  assert.notEqual(after[1].slice(79, 87), '5901234X');
  assert.match(after[1].slice(79, 87), /^[0-9]{7}[A-Z]$/);
  assert.deepEqual(codeCounts(out.text), codeCounts(text));
  assert.ok(!out.text.includes('5812345 ') && !out.text.includes('5901234X'));
});
