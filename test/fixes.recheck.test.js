'use strict';
// Regression tests for the three defects of the final re-check:
// R1  Compare said "No differences" for files that differ only in record length, characters after
//     position 94, empty lines, the byte order mark or the position of stray records.
// R2  An anonymised copy could be turned back (31-bit seed, replacement derived from the value alone,
//     different values with the same replacement).
// R3  A trial was lost when the clock was ahead at its start and was corrected later.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('../src/ach/parse');
const W = require('../src/ach/write');
const Cmp = require('../src/pro/compare');
const A = require('../src/pro/anonymise');
const samples = require('../src/samples');
const M = require('./helpers/vscode-mock');
const pkg = require('../package.json');
const { corpusFiles, codeCounts } = require('./helpers/load');

const CORPUS = path.join(__dirname, 'fixtures', 'corpus');
const read = (name) => fs.readFileSync(path.join(CORPUS, name), 'utf8');
const linesOf = (text) => text.replace(/\n$/, '').split('\n');
const join = (lines) => lines.join('\n') + '\n';

// ---- R1: Compare reports every difference of the text -------------------------------------------------

function mustDiffer(name, a, b, options) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const res = Cmp.compare(x, y, options);
    assert.equal(res.identical, false, name + ': must not be "No differences"');
    assert.ok(!/No differences/.test(Cmp.toMarkdown(res, 'ACH comparison')), name + ': the report must not say "No differences"');
    assert.ok(!/^no differences/.test(Cmp.summaryText(res)), name + ': the message must not say "no differences"');
    assert.ok(Cmp.toCsv(res).split('\r\n').filter(Boolean).length >= 2, name + ': the CSV lists the difference');
  }
}

test('compare R1: records without their trailing spaces are a difference, named by record and length', () => {
  const a = read('v08-five-batches.ach');
  const stripped = join(linesOf(a).map((l) => l.replace(/ +$/, '')));
  assert.notEqual(stripped, a);
  mustDiffer('every record without trailing spaces', a, stripped);
  const res = Cmp.compare(a, stripped);
  assert.ok(res.exact.records.length > 0);
  assert.ok(res.exact.records.every((d) => d.kind === 'spaces'));
  assert.match(res.exact.records[0].detail, /^94 characters in the first file, \d+ in the second \(trailing spaces\)$/);
  assert.match(Cmp.toMarkdown(res), /## Exact text[\s\S]*trailing spaces/);
  assert.match(Cmp.summaryText(res), /also different: record lengths/);
  // Only the file control.
  const lines = linesOf(a);
  const k = lines.findIndex((l) => l.charAt(0) === '9' && !/^9+$/.test(l));
  lines[k] = lines[k].replace(/ +$/, '');
  const one = Cmp.compare(a, join(lines));
  assert.equal(one.identical, false);
  assert.equal(one.exact.records.length, 1);
  assert.equal(one.exact.records[0].record, k + 1);
});

test('compare R1: characters after position 94 are a difference', () => {
  const a = read('v08-five-batches.ach');
  for (const first of ['1', '5', '6', '8', '9']) {
    const lines = linesOf(a);
    const k = lines.findIndex((l) => l.charAt(0) === first && !/^9{94}$/.test(l));
    lines[k] += 'X';
    mustDiffer('an extra character after record type ' + first, a, join(lines));
    const res = Cmp.compare(a, join(lines));
    assert.equal(res.exact.records.length, 1);
    assert.equal(res.exact.records[0].kind, 'extra');
    assert.equal(res.exact.records[0].record, k + 1);
    assert.match(res.exact.records[0].detail, /95 characters in the second|94 characters in the first file, 95/);
  }
});

test('compare R1: an empty line is a difference, with its position', () => {
  const a = read('v08-five-batches.ach');
  const lines = linesOf(a);
  lines.splice(3, 0, '');
  const b = join(lines);
  mustDiffer('an empty line after record 3', a, b);
  const res = Cmp.compare(a, b);
  assert.deepEqual(res.exact.blank, [{ after: 3, end: false, a: 0, b: 1 }]);
  assert.match(Cmp.toMarkdown(res), /Empty lines after record 3: 0 empty lines in the first file, 1 in the second/);
  assert.match(Cmp.summaryText(res), /empty lines/);
  // Two empty lines against one, at the start and at the end of the file.
  mustDiffer('empty lines at the start', a, '\n' + a);
  mustDiffer('empty line at the end', a, a + '\n');
  assert.deepEqual(Cmp.compare(a, a + '\n').exact.blank, [{ after: P.parseAch(a).records.count, end: true, a: 0, b: 1 }]);
  mustDiffer('one empty line against two', b, join(lines.slice(0, 3).concat(['', ''], lines.slice(4))));
});

test('compare R1: a byte order mark is a difference', () => {
  const a = read('v08-five-batches.ach');
  mustDiffer('byte order mark', a, '﻿' + a);
  const res = Cmp.compare(a, '﻿' + a);
  assert.deepEqual(res.exact.bom, { a: false, b: true });
  assert.match(Cmp.toMarkdown(res), /Byte order mark: only in the second file/);
  assert.match(Cmp.summaryText(res), /the byte order mark/);
  assert.match(Cmp.toCsv(res), /byte order mark/);
  assert.equal(Cmp.compare('﻿' + a, '﻿' + a).identical, true);
});

test('compare R1: records out of place or in another order are a difference', () => {
  const moves = {
    'e13 second file header moved into the batch': ['e13-second-header.ach', (l) => { const k = l.findIndex((x, i) => i > 0 && x.charAt(0) === '1'); const [h] = l.splice(k, 1); l.splice(k + 1, 0, h); }],
    'e11 stray header moved before the file control': ['e11-after-control.ach', (l) => { const k = l.findIndex((x) => x.charAt(0) === '9' && !/^9{94}$/.test(x)); const [c] = l.splice(k, 1); l.push(c); }],
    'e09 stray entry moved after the file control': ['e09-entry-outside.ach', (l) => { const k = l.findIndex((x, i) => i > 0 && x.charAt(0) === '6'); const [e] = l.splice(k, 1); const f = l.findIndex((x) => x.charAt(0) === '9' && !/^9{94}$/.test(x)); l.splice(f + 1, 0, e); }],
    'e03 unknown record moved up one place': ['e03-unknown-type.ach', (l) => { const k = l.findIndex((x) => !/^[1-9]/.test(x)); const [u] = l.splice(k, 1); l.splice(k - 1, 0, u); }]
  };
  for (const [name, [file, move]] of Object.entries(moves)) {
    const a = read(file);
    const lines = linesOf(a);
    move(lines);
    const b = join(lines);
    assert.notEqual(b, a, name);
    mustDiffer(name, a, b);
  }
  // Two neighbouring records swapped in every corpus file that has at least two different neighbours.
  let swapped = 0;
  for (const f of corpusFiles()) {
    const lines = linesOf(f.text);
    for (let k = 0; k + 1 < lines.length; k += 7) {
      if (lines[k] === lines[k + 1]) continue;
      const copy = lines.slice();
      [copy[k], copy[k + 1]] = [copy[k + 1], copy[k]];
      const res = Cmp.compare(f.text, join(copy));
      assert.equal(res.identical, false, f.name + ': records ' + (k + 1) + ' and ' + (k + 2) + ' swapped');
      swapped++;
    }
  }
  assert.ok(swapped > 100, swapped + ' swaps tried');
});

test('compare R1: records at another position are named as such', () => {
  const lines = linesOf(read('v08-five-batches.ach'));
  const withTwo = lines.slice(0, 1).concat(['Q first garbage record'.padEnd(94), 'Q second garbage record'.padEnd(94)], lines.slice(1));
  const swapped = withTwo.slice();
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  const res = Cmp.compare(join(withTwo), join(swapped));
  assert.equal(res.identical, false, 'two unknown records swapped');
  assert.equal(res.structure.other.added.length + res.structure.other.removed.length, 0, 'the structure alone cannot see it');
  assert.deepEqual(res.exact.records.map((d) => [d.record, d.kind]), [[2, 'position'], [3, 'position']]);
  assert.equal(res.exact.moved, true);
  assert.match(Cmp.toMarkdown(res), /the record is at another position/);
  assert.match(Cmp.summaryText(res), /the position of records/);
});

test('compare R1: every single-character change of every record is found', () => {
  for (const name of ['v01-ppd-credits.ach', 'v07-iat.ach', 'e03-unknown-type.ach']) {
    const a = read(name);
    const lines = linesOf(a);
    let tried = 0;
    for (let i = 0; i < lines.length; i++) {
      for (let pos = 0; pos < lines[i].length; pos += 3) {
        const ch = lines[i].charAt(pos);
        const copy = lines.slice();
        copy[i] = lines[i].slice(0, pos) + (ch === 'Q' ? 'R' : 'Q') + lines[i].slice(pos + 1);
        assert.equal(Cmp.compare(a, join(copy)).identical, false, name + ' record ' + (i + 1) + ' position ' + (pos + 1));
        tried++;
      }
    }
    assert.ok(tried > 200);
  }
});

test('compare R1: what is not a difference stays the same', () => {
  const a = read('v08-five-batches.ach');
  assert.equal(Cmp.compare(a, a).identical, true);
  assert.equal(Cmp.compare(a, a.replace(/\n/g, '\r\n')).identical, true, 'line breaks CR LF against LF');
  assert.equal(Cmp.compare(a, a.replace(/\n/g, '\r')).identical, true, 'line breaks CR against LF');
  assert.equal(Cmp.compare(a, a.replace(/\n/g, '')).identical, true, 'unwrapped against wrapped');
  assert.equal(Cmp.compare(a, a.replace(/\n$/, '')).identical, true, 'no line break at the end of the file');
  for (const f of corpusFiles()) assert.equal(Cmp.compare(f.text, f.text).identical, true, f.name);
});

test('compare R1: the ignore options blank the same fields in the exact text', () => {
  const a = read('v08-five-batches.ach');
  const lines = linesOf(a);
  // Dates: file creation date and time, file ID modifier, effective date.
  const dates = lines.map((l) => l);
  dates[0] = W.setField(dates[0], 24, '991231');
  dates[0] = W.setField(dates[0], 30, '2359');
  dates[0] = W.setField(dates[0], 34, 'Z');
  const batchHeader = dates.findIndex((l) => l.charAt(0) === '5');
  dates[batchHeader] = W.setField(dates[batchHeader], 70, '991231');
  mustDiffer('dates changed', a, join(dates));
  assert.equal(Cmp.compare(a, join(dates), { ignoreDates: true }).identical, true, 'dates ignored');
  // A date ignored, but a trailing space removed: still a difference.
  dates[0] = dates[0].replace(/ +$/, '');
  assert.equal(Cmp.compare(a, join(dates), { ignoreDates: true }).identical, false);
  // Trace numbers and batch numbers.
  const trace = lines.slice();
  const entry = trace.findIndex((l) => l.charAt(0) === '6');
  trace[entry] = W.setField(trace[entry], 80, '999999999999999');
  mustDiffer('trace number changed', a, join(trace));
  assert.equal(Cmp.compare(a, join(trace), { ignoreTrace: true }).identical, true, 'trace numbers ignored');
  trace[entry] += 'X';
  assert.equal(Cmp.compare(a, join(trace), { ignoreTrace: true }).identical, false, 'a character after position 94 is not ignored');
});

function startEditor(options) {
  const o = options || {};
  const mock = M.createMock(Object.assign({ folders: [{ uri: M.Uri.parse('file:///work'), name: 'work' }] }, o));
  const uninstall = M.install(mock.vscode);
  const srcDir = path.join(__dirname, '..', 'src');
  for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
  const ext = require('../src/extension');
  const context = M.makeContext(pkg, o.extensionMode);
  const t0 = Date.now() - 86400000;
  context.globalMap.set('trial.startedAt', t0);
  context.globalMap.set('trial.lastSeenAt', t0);
  ext.activate(context);
  return { state: mock.state, uninstall: uninstall, run: (id, ...a) => mock.vscode.commands.executeCommand(id, ...a) };
}

test('compare R1: the command compares the byte order mark that the editor hides from the text', async () => {
  const FIRST = 'file:///work/payroll.ach';
  const SECOND = 'file:///work/copy.ach';
  const text = samples.sampleFor('valid').text;
  for (const bom of [false, true]) {
    const x = startEditor({ files: { [FIRST]: text, [SECOND]: text }, active: SECOND, quickPickAnswers: [(i) => i.label === 'payroll.ach', []], buttonAnswers: [undefined, undefined] });
    try {
      if (bom) x.state.documents.find((d) => d.uri.toString() === SECOND).encoding = 'utf8bom';
      await x.run('achAtlas.compare');
      const report = x.state.openedDocs.pop().getText();
      if (bom) {
        assert.ok(!/No differences/.test(report), 'the hidden mark is a difference');
        assert.match(report, /Byte order mark: only in the second file/);
      } else assert.match(report, /No differences/, 'same text, no mark');
    } finally { x.uninstall(); }
  }
});

// ---- R2: Anonymise cannot be turned back -------------------------------------------------------------

const sample = samples.sampleFor('valid').text;
const entriesOf = (text) => linesOf(text).filter((l) => l.charAt(0) === '6');
const accountsOf = (text) => entriesOf(text).map((l) => l.slice(12, 29));

function entryFile(accounts) {
  // One batch whose entries carry the given account numbers; everything else comes from the sample.
  const lines = linesOf(sample);
  const entry = lines.find((l) => l.charAt(0) === '6');
  const body = accounts.map((acct, k) => W.setField(W.setField(entry, 13, acct), 80, '59012340' + String(k + 1).padStart(7, '0')));
  const batchHeader = lines.find((l) => l.charAt(0) === '5');
  const batchControl = lines.find((l) => l.charAt(0) === '8');
  return join([lines[0], batchHeader].concat(body, [batchControl]));
}

test('anonymise R2: a copy made the way the command makes it uses a 256-bit key, not a small seed', () => {
  const calls = [];
  const original = crypto.randomBytes;
  crypto.randomBytes = function (n) { calls.push(n); return original.apply(this, arguments); };
  try {
    const run = () => A.createAnonymiser({ amounts: 'keep' }).anonymise(sample).text;
    const one = run();
    const two = run();
    assert.ok(calls.indexOf(32) !== -1, 'a 32-byte random key is drawn: ' + JSON.stringify(calls));
    assert.notEqual(one, two, 'two runs without a given key give different copies');
  } finally { crypto.randomBytes = original; }
  // Nothing reachable from a command takes a seed: the command module draws no small number.
  const commands = fs.readFileSync(path.join(__dirname, '..', 'src', 'procommands.js'), 'utf8');
  const callsInCommands = commands.match(/createAnonymiser\(\{[^}]*\}\)/g) || [];
  assert.equal(callsInCommands.length, 2, 'Anonymise File and Anonymise Folder');
  for (const call of callsInCommands) assert.ok(/key: /.test(call) && !/seed/.test(call), call + ' passes a key and no seed');
});

test('anonymise R2: a copy made without a given key cannot be reproduced with small seeds', () => {
  const copy = A.createAnonymiser({ amounts: 'replace' }).anonymise(sample).text;
  for (let seed = 0; seed < 2000; seed++) {
    assert.notEqual(A.createAnonymiser({ seed: seed, amounts: 'replace' }).anonymise(sample).text, copy, 'seed ' + seed);
  }
  // The replacement of a number is not a function of the number alone: another run, another value.
  const second = A.createAnonymiser({ amounts: 'replace' }).anonymise(sample).text;
  assert.notEqual(accountsOf(copy)[0], accountsOf(second)[0]);
  assert.notEqual(linesOf(copy)[0].slice(3, 13), linesOf(second)[0].slice(3, 13));
});

test('anonymise R2: the replacement of an account number depends on a secret key', () => {
  const file = entryFile(['7731904', '4410027719', '120044871']);
  const withKey = (key) => A.createAnonymiser({ key: key, amounts: 'keep' }).anonymise(file).text;
  const k1 = crypto.randomBytes(32);
  const k2 = crypto.randomBytes(32);
  assert.equal(withKey(k1), withKey(k1), 'the same key gives the same copy');
  assert.notEqual(accountsOf(withKey(k1))[0], accountsOf(withKey(k2))[0]);
  // A key that is too short is refused.
  assert.throws(() => A.createAnonymiser({ key: Buffer.alloc(8) }), /key/);
  // The given seed of the unit tests reproduces a copy (and is documented as doing so).
  assert.equal(A.createAnonymiser({ seed: 12 }).anonymise(file).text, A.createAnonymiser({ seed: 12 }).anonymise(file).text);
  assert.notEqual(A.createAnonymiser({ seed: 12 }).anonymise(file).text, A.createAnonymiser({ seed: 13 }).anonymise(file).text);
});

test('anonymise R2: 10,000 different 4-digit accounts get 10,000 different replacements', () => {
  const accounts = [];
  for (let k = 0; k < 10000; k++) accounts.push(String(k).padStart(4, '0').padEnd(17, ' '));
  const copy = A.createAnonymiser({ amounts: 'keep' }).anonymise(entryFile(accounts)).text;
  const replaced = accountsOf(copy);
  assert.equal(replaced.length, 10000);
  assert.equal(new Set(replaced).size, 10000, 'no two different accounts share a replacement');
  assert.ok(replaced.every((r, k) => r !== accounts[k] && /^[0-9]{4} {13}$/.test(r)), 'every account is replaced and keeps its shape');
});

test('anonymise R2: different values never share a replacement, in every field kind and shape', () => {
  const rnd = crypto.createHash('sha256');
  const values = new Set();
  let k = 0;
  while (values.size < 3000) {
    const h = crypto.createHash('sha256').update(String(k++)).digest();
    const len = 1 + (h[0] % 17);
    let v = '';
    for (let j = 0; j < len; j++) {
      const b = h[1 + (j % 30)];
      v += b % 5 === 0 ? String.fromCharCode(65 + (b % 26)) : String.fromCharCode(48 + (b % 10));
    }
    values.add(v.padEnd(17, ' '));
  }
  const list = Array.from(values);
  const copy = A.createAnonymiser({ amounts: 'keep' }).anonymise(entryFile(list)).text;
  const replaced = accountsOf(copy);
  assert.equal(new Set(replaced).size, list.length);
  list.forEach((v, i) => {
    assert.notEqual(replaced[i], v, 'replaced: ' + v);
    assert.equal(replaced[i].replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A'), v.replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A'), 'same shape: ' + v);
  });
  void rnd;
});

test('anonymise R2: a one-character value changes, and the same value is replaced the same way everywhere', () => {
  const file = entryFile(['5'.padEnd(17), '5'.padEnd(17), '6'.padEnd(17)]);
  for (let n = 0; n < 20; n++) {
    const r = accountsOf(A.createAnonymiser({ amounts: 'keep' }).anonymise(file).text);
    assert.notEqual(r[0], '5'.padEnd(17));
    assert.equal(r[0], r[1]);
    assert.notEqual(r[0], r[2]);
    assert.notEqual(r[2], '6'.padEnd(17));
  }
});

test('anonymise R2: company identifications never collide either', () => {
  const lines = linesOf(sample);
  const header = lines.find((l) => l.charAt(0) === '5');
  const control = lines.find((l) => l.charAt(0) === '8');
  // Identifications with a single replaceable character: 26 of them share 26 possible replacements.
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const batches = letters.map((c) => [W.setField(header, 41, ('9' + c).padEnd(10)), W.setField(control, 45, ('9' + c).padEnd(10))]);
  const text = join([lines[0]].concat(...batches));
  for (let seed = 1; seed <= 40; seed++) {
    const copy = A.createAnonymiser({ seed: seed, amounts: 'keep' }).anonymise(text).text;
    const ids = linesOf(copy).filter((l) => l.charAt(0) === '5').map((l) => l.slice(40, 50));
    assert.equal(new Set(ids).size, 26, 'seed ' + seed + ': 26 identifications keep 26 different replacements');
    ids.forEach((id, k) => assert.notEqual(id, ('9' + letters[k]).padEnd(10), 'seed ' + seed + ': replaced'));
  }
});

test('anonymise R2: a folder run (two passes with one key) gives the same copies twice', () => {
  const files = [sample, samples.sampleFor('problems').text, read('v08-five-batches.ach'), read('v11-returns.ach')];
  const key = crypto.randomBytes(32);
  const pass = () => { const an = A.createAnonymiser({ key: key, amounts: 'replace' }); return files.map((f) => an.anonymise(f).text); };
  assert.deepEqual(pass(), pass());
  const other = A.createAnonymiser({ key: crypto.randomBytes(32), amounts: 'replace' });
  assert.notEqual(other.anonymise(files[0]).text, pass()[0]);
});

test('anonymise R2: the problems of the corpus are unchanged with the keyed replacement', () => {
  for (const f of corpusFiles()) {
    const copy = A.createAnonymiser({ amounts: 'replace' }).anonymise(f.text);
    assert.deepEqual(codeCounts(copy.text), codeCounts(f.text), f.name);
    assert.equal(copy.text.length, f.text.length, f.name);
  }
});

test('anonymise R2: the documentation says what the code does', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro-tools.md'), 'utf8');
  assert.ok(!/cannot be turned back into the original with ACH Atlas/.test(doc), 'the old sentence is gone');
  assert.match(doc, /256-bit key/);
  assert.match(doc, /same value gets the same replacement/);
});

const K = { createKeyed: (options) => require('../src/pro/keyed').createKeyed(options) };

test('keyed permutation: a bijection without fixed points on small domains, checked completely', () => {
  const k = K.createKeyed({ key: crypto.randomBytes(32) });
  const domains = {
    'four digits': (i) => String(i).padStart(4, '0'),
    'three lower-case letters': (i) => String.fromCharCode(97 + (i % 26), 97 + (Math.floor(i / 26) % 26), 97 + Math.floor(i / 676)),
    'letter, digit, letter with a separator': (i) => String.fromCharCode(65 + (i % 26)) + '-' + (Math.floor(i / 26) % 10) + '/' + String.fromCharCode(97 + Math.floor(i / 260))
  };
  const sizes = { 'four digits': 10000, 'three lower-case letters': 17576, 'letter, digit, letter with a separator': 6760 };
  for (const [name, make] of Object.entries(domains)) {
    const out = new Set();
    for (let i = 0; i < sizes[name]; i++) {
      const v = make(i);
      const r = k.permute('accounts', v);
      assert.notEqual(r, v, name + ': ' + v + ' is replaced');
      assert.equal(r.length, v.length);
      assert.equal(r.replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a'), v.replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a'), name + ': the shape is kept');
      out.add(r);
    }
    assert.equal(out.size, sizes[name], name + ': every value has its own replacement');
  }
});

test('keyed permutation: consecutive values of a large domain never collide and do not look sequential', () => {
  const k = K.createKeyed({ key: crypto.randomBytes(32) });
  const out = new Set();
  const numbers = [];
  for (let i = 1000000; i < 1030000; i++) { const r = k.permute('accounts', String(i)); out.add(r); numbers.push(Number(r)); }
  assert.equal(out.size, 30000);
  const steps = new Set();
  for (let i = 1; i < 200; i++) steps.add(numbers[i] - numbers[i - 1]);
  assert.ok(steps.size > 150, 'consecutive numbers do not keep their distance: ' + steps.size + ' different steps in 199');
});

test('keyed permutation: a change of one digit changes most digits, and the digits are spread evenly', () => {
  const k = K.createKeyed({ key: crypto.randomBytes(32) });
  let changed = 0;
  let total = 0;
  const seen = Array.from({ length: 12 }, () => new Array(10).fill(0));
  for (let i = 0; i < 1000; i++) {
    const v = String(100000000000 + i * 7919).padStart(12, '0');
    const w = v.slice(0, 11) + String((Number(v[11]) + 1) % 10);
    const a = k.permute('accounts', v);
    const b = k.permute('accounts', w);
    for (let j = 0; j < 12; j++) { total++; if (a[j] !== b[j]) changed++; seen[j][Number(a[j])]++; }
  }
  assert.ok(changed / total > 0.8, 'share of changed digits ' + changed / total);
  for (const row of seen) for (const n of row) assert.ok(n > 40 && n < 170, 'a digit value occurs ' + n + ' times in 1000');
});

test('keyed permutation: two keys give two different mappings', () => {
  const a = K.createKeyed({ key: crypto.randomBytes(32) });
  const b = K.createKeyed({ key: crypto.randomBytes(32) });
  let same = 0;
  for (let i = 0; i < 500; i++) { const v = String(481291300000 + i); if (a.permute('accounts', v) === b.permute('accounts', v)) same++; }
  assert.equal(same, 0);
  const c = K.createKeyed({ key: crypto.randomBytes(32) });
  assert.notEqual(c.permute('accounts', '4410027719'), c.permute('identifiers', '4410027719'), 'the kind of field is part of the mapping');
});

test('keyed stream: integers stay in range and are spread evenly, big numbers too', () => {
  const r = K.createKeyed({ key: crypto.randomBytes(32) }).random;
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 7000; i++) { const v = r.int(10, 16); assert.ok(v >= 10 && v <= 16); counts[v - 10]++; }
  for (const n of counts) assert.ok(n > 800 && n < 1200, 'count ' + n);
  for (let i = 0; i < 200; i++) { const v = r.big(10n ** 11n, 10n ** 12n - 1n); assert.ok(v >= 10n ** 11n && v < 10n ** 12n); }
  assert.equal(r.big(5n, 5n), 5n);
  assert.throws(() => r.int(1, 0));
  const digits = new Array(10).fill(0);
  const letters = new Array(26).fill(0);
  for (let i = 0; i < 10000; i++) { digits[r.digit() - 48]++; letters[r.letter()]++; }
  for (const n of digits) assert.ok(n > 800 && n < 1200);
  for (const n of letters) assert.ok(n > 280 && n < 500);
});

// ---- R3: a trial survives a clock that was ahead at its start ------------------------------------------

const { make, stores, DAY } = require('./helpers/licence-fakes');

test('trial R3: 2 days ahead at the start, corrected after 3 days of use: active with 11 days left', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  const m = make({ start: real + 2 * DAY });
  assert.equal((await m.lic.startTrial()).state, 'active');
  m.advance(3 * DAY);
  await m.lic.checkTrial();
  m.setClock(real + 3 * DAY);
  const s = await m.lic.checkTrial();
  assert.deepEqual([s.state, s.daysLeft], ['active', 11]);
  assert.equal(await m.lic.hasAccess(), true);
  assert.equal(m.s.globalMap.get('trial.expiredAt'), undefined, 'no end was written down');
});

test('trial R3: a clock that was ahead and is corrected at once does not end the trial', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  for (const ahead of [2 * DAY, 40 * DAY, 365 * DAY]) {
    const m = make({ start: real + ahead });
    await m.lic.startTrial();
    m.setClock(real);
    const s = await m.lic.checkTrial();
    assert.deepEqual([s.state, s.daysLeft], ['active', 14], ahead / DAY + ' days ahead');
    assert.equal(m.s.globalMap.get('trial.expiredAt'), undefined);
    assert.ok(m.s.globalMap.get('trial.startedAt') <= real && m.s.globalMap.get('trial.lastSeenAt') <= real, 'the stored times are written again, not in the future');
    m.advance(13 * DAY);
    assert.equal(await m.lic.hasAccess(), true, 'day 13');
    m.advance(2 * DAY);
    assert.equal(await m.lic.hasAccess(), false, 'day 15: the trial lasts 14 days, not more');
  }
});

test('trial R3: setting the clock back gains nothing, the used time is kept', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  const m = make({ start: real + 2 * DAY });
  await m.lic.startTrial();
  m.advance(3 * DAY);
  await m.lic.checkTrial();
  m.setClock(real + 3 * DAY);
  assert.equal((await m.lic.checkTrial()).daysLeft, 11);
  m.advance(2 * DAY);
  assert.equal((await m.lic.checkTrial()).daysLeft, 9, 'the two days of the wrong clock are not given back as a pause');
  // Same through the plain "clock set back" path of an ordinary user.
  const n = make();
  await n.lic.startTrial();
  n.advance(10 * DAY);
  await n.lic.checkTrial();
  n.setClock(n.now() - 9 * DAY);
  assert.equal((await n.lic.checkTrial()).daysLeft, 4);
  n.advance(3 * DAY);
  assert.equal((await n.lic.checkTrial()).daysLeft, 1);
  n.advance(1 * DAY);
  assert.equal((await n.lic.checkTrial()).state, 'expired');
});

test('trial R3: an ended trial stays ended after the clock is corrected, restarted or edited', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  const m = make({ start: real });
  await m.lic.startTrial();
  m.advance(15 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired');
  assert.ok(m.s.globalMap.get('trial.expiredAt') > 0);
  m.setClock(real - 400 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired', 'clock set back a year');
  m.s.globalMap.set('trial.startedAt', real + 900 * DAY);
  m.s.globalMap.set('trial.lastSeenAt', real + 900 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired', 'times edited into the future after the end');
  assert.equal((await m.lic.startTrial()).state, 'expired');
  assert.equal(await m.lic.hasAccess(), false);
  assert.equal(m.s.globalMap.get('trial.startedAt'), real + 900 * DAY, 'an ended trial is not rewritten');
});

test('trial R3: a trial that already ran out under the wrong clock is ended, and stays so', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  const m = make({ start: real });
  await m.lic.startTrial();
  m.setClock(real + 20 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired', 'by the computer clock the 14 days are over');
  m.setClock(real + 1 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired', 'and the correction does not reopen it');
});

test('trial R3: storage that cannot be written does not break the status', async () => {
  const real = Date.UTC(2026, 10, 12, 10, 0, 0);
  let failing = false;
  const m = make({ start: real + 2 * DAY, stores: stores({ failWhen: () => failing }) });
  await m.lic.startTrial();
  failing = true;
  m.setClock(real);
  const s = await m.lic.checkTrial();
  assert.deepEqual([s.state, s.daysLeft], ['active', 14]);
  m.advance(3 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'active');
});

// ---- N1: a value with one letter or digit must not be replaced by its successor ---------------------------

test('keyed permutation N1: a one-character value is replaced differently for every key', () => {
  const images = { '7': new Map(), Q: new Map(), q: new Map() };
  for (let n = 0; n < 400; n++) {
    const k = K.createKeyed({ key: crypto.randomBytes(32) });
    for (const v of Object.keys(images)) {
      const r = k.permute('accounts', v);
      assert.notEqual(r, v, v + ' is replaced');
      images[v].set(r, (images[v].get(r) || 0) + 1);
    }
  }
  assert.ok(images['7'].size >= 8, '7 has ' + images['7'].size + ' different replacements over 400 keys (9 are possible)');
  assert.ok((images['7'].get('8') || 0) < 100, 'the successor is not the usual replacement: ' + images['7'].get('8') + ' of 400');
  assert.ok(images.Q.size >= 20 && images.q.size >= 20, 'letters: ' + images.Q.size + ' and ' + images.q.size + ' of 25');
  assert.ok((images.Q.get('R') || 0) < 60);
});

test('keyed permutation N1: the one-character replacement is a single cycle through all digits and letters', () => {
  for (let n = 0; n < 20; n++) {
    const k = K.createKeyed({ key: crypto.randomBytes(32) });
    for (const alphabet of ['0123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz']) {
      const next = new Map(alphabet.split('').map((c) => [c, k.permute('accounts', c)]));
      assert.equal(new Set(next.values()).size, alphabet.length, 'a bijection');
      let at = alphabet[0];
      let steps = 0;
      do { at = next.get(at); steps++; } while (at !== alphabet[0] && steps <= alphabet.length);
      assert.equal(steps, alphabet.length, 'one cycle through all ' + alphabet.length);
      assert.equal(k.permute('accounts', alphabet[3]), next.get(alphabet[3]), 'the same value, the same replacement');
    }
    assert.equal(k.permute('accounts', ' - 5 '), ' - ' + k.permute('accounts', '5') + ' ', 'a separator and spaces around it stay');
  }
});

test('anonymise N1: an account number of one digit is not replaced by its successor under every key', () => {
  const file = entryFile(['7'.padEnd(17), '8'.padEnd(17), '7'.padEnd(17)]);
  const seen = new Set();
  let successor = 0;
  for (let n = 0; n < 150; n++) {
    const r = accountsOf(A.createAnonymiser({ key: crypto.randomBytes(32), amounts: 'keep' }).anonymise(file).text);
    assert.equal(r[0], r[2], 'the same value, the same replacement');
    assert.notEqual(r[0], r[1]);
    assert.notEqual(r[0].trim(), '7');
    seen.add(r[0].trim());
    if (r[0].trim() === '8') successor++;
  }
  assert.ok(seen.size >= 7 && successor < 50, seen.size + ' different replacements of 7, ' + successor + ' times 8 in 150 runs');
});

test('keyed permutation N1: a two-character value depends on the key as well', () => {
  const images = new Set();
  for (let n = 0; n < 200; n++) images.add(K.createKeyed({ key: crypto.randomBytes(32) }).permute('accounts', '73'));
  assert.ok(images.size >= 60, images.size + ' different replacements of 73 over 200 keys');
});

test('no source file draws numbers with Math.random: Create Test File uses the system random source too', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = walk(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 20);
  for (const f of files) assert.ok(!/Math\.random/.test(fs.readFileSync(f, 'utf8')), f + ' uses Math.random');
});
