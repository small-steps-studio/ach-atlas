'use strict';
// Hostile inputs and seeded fuzzing: nothing throws, problem ranges stay inside the text, results
// are repeatable, the Pro tools keep their promises on damaged files.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const D = require('../src/ach/describe');
const O = require('../src/ach/outline');
const { validate } = require('../src/ach/validate');
const F = require('../src/pro/fixup');
const A = require('../src/pro/anonymise');
const Cmp = require('../src/pro/compare');
const S = require('../src/pro/splitmerge');
const E = require('../src/pro/export');
const R = require('../src/pro/reconcile');
const { createRandom } = require('../src/pro/random');
const samples = require('../src/samples');
const { corpusFiles, codeCounts } = require('./helpers/load');

function exercise(text, label) {
  const t0 = Date.now();
  const p = P.parseAch(text);
  const v = validate(p, { maxProblems: 200 });
  for (const x of v.problems) assert.ok(x.start >= 0 && x.end >= x.start && x.end <= text.length, label + ': range of ' + x.code);
  for (const i of [0, Math.floor(p.records.count / 2), p.records.count - 1]) {
    if (i < 0 || i >= p.records.count) continue;
    for (const col of [1, 2, 12, 30, 40, 55, 79, 80, 94]) { const d = D.describeAt(p, i, col); if (d) D.hoverMarkdown(d); D.pathAt(p, i, col); }
  }
  for (const n of O.rootNodes(p)) for (const c of O.childrenOf(p, n).slice(0, 5)) O.childrenOf(p, c);
  O.symbols(p);
  O.batchList(p);
  const fx = F.fixUp(text);
  assert.ok(fx.ok === true || typeof fx.reason === 'string', label);
  A.createAnonymiser({ seed: 1, amounts: 'replace' }).anonymise(text);
  E.toCsv(p);
  JSON.parse(E.toJson(p));
  Cmp.toMarkdown(Cmp.compare(text, text), 'x');
  S.split(text, 'x');
  R.reconcile([{ name: 'a', text: text }]);
  return Date.now() - t0;
}

test('hostile inputs never throw and finish quickly', () => {
  const valid = samples.sampleFor('valid').text;
  const rnd = createRandom(77);
  let binary = '';
  for (let k = 0; k < 20000; k++) binary += String.fromCharCode(rnd.int(0, 255));
  const inputs = {
    empty: '', spaces: '   \n  \n', newlines: '\n'.repeat(100000), bomOnly: '﻿', nul: '\u0000'.repeat(500), binary: binary,
    lowercase: valid.toLowerCase(), crOnly: valid.replace(/\n/g, '\r'), noBreaks: valid.replace(/\n/g, ''), allNines: ('9'.repeat(94) + '\n').repeat(50),
    onlyHeaders: (valid.split('\n')[0] + '\n').repeat(30), onlyEntries: (valid.split('\n')[2] + '\n').repeat(300), onlyControls: (valid.split('\n')[6] + '\n').repeat(30),
    longLine: '6'.repeat(2 * 1024 * 1024), longRecord: valid.split('\n').map((l, k) => (k === 3 ? l + 'X'.repeat(10000) : l)).join('\n'),
    surrogates: valid.replace('ALMA ASHGROVE', 'ALMA \uD800 \uDFFF 😀'), tabs: valid.replace(/ /g, '\t'), unknownTypes: valid.replace(/^6/gm, 'Z'),
    shortRecords: valid.split('\n').map((l) => l.slice(0, 40)).join('\n'), headerOnly: valid.split('\n')[0], json: '{"records":[1,2,3]}', x12: 'ISA*00*          *00*~GS*PO~ST*850*0001~',
    nestedBatches: valid.split('\n').filter((l, k) => k !== 6).join('\n'), reversed: valid.split('\n').reverse().join('\n'), duplicated: valid + valid, fillerFirst: '9'.repeat(94) + '\n' + valid
  };
  for (const [name, text] of Object.entries(inputs)) {
    const ms = exercise(text, name);
    assert.ok(ms < 15000, name + ' took ' + ms + ' ms');
  }
});

function mutate(text, rnd) {
  const lines = text.split(/\r?\n/);
  const kind = rnd.int(0, 9);
  const li = rnd.int(0, Math.max(0, lines.length - 1));
  const line = lines[li] || '';
  const pos = rnd.int(0, Math.max(0, line.length - 1));
  const chars = '0123456789 ABCXYZ9\té*';
  switch (kind) {
    case 0: lines[li] = line.slice(0, pos) + chars[rnd.int(0, chars.length - 1)] + line.slice(pos + 1); break;
    case 1: lines.splice(li, 1); break;
    case 2: lines.splice(li, 0, line); break;
    case 3: { const lj = rnd.int(0, lines.length - 1); const t = lines[li]; lines[li] = lines[lj]; lines[lj] = t; break; }
    case 4: lines[li] = line.slice(0, pos); break;
    case 5: lines[li] = line + 'EXTRA'; break;
    case 6: lines[li] = line.slice(0, pos) + String(rnd.int(0, 9)).repeat(Math.min(12, line.length - pos)) + line.slice(pos + 12); break;
    case 7: lines.splice(li, 0, ''); break;
    case 8: return text.slice(0, rnd.int(0, text.length));
    default: lines[li] = line.replace(/[0-9]/, String(rnd.int(0, 9)));
  }
  return lines.join('\n');
}

test('seeded fuzz: 2,000 damaged files from the corpus', () => {
  const files = corpusFiles().filter((f) => f.text.length < 20000);
  const rnd = createRandom(20261112);
  let n = 0;
  let accepted = 0;
  for (let round = 0; round < 2000; round++) {
    const base = files[round % files.length];
    let text = base.text;
    const steps = rnd.int(1, 3);
    for (let s = 0; s < steps; s++) text = mutate(text, rnd);
    const label = base.name + ' round ' + round;
    const p = P.parseAch(text);
    const a = validate(p);
    const b = validate(P.parseAch(text));
    assert.deepEqual(a.problems, b.problems, label + ': not repeatable');
    for (const x of a.problems) assert.ok(x.start >= 0 && x.end <= text.length, label);
    // Anonymise keeps the problems (trace order may change when trace prefixes differ).
    const anon = A.createAnonymiser({ seed: round, amounts: round % 2 ? 'replace' : 'keep' }).anonymise(text);
    const before = codeCounts(text);
    const after = codeCounts(anon.text);
    delete before['ACH-TRACE-ORDER'];
    delete after['ACH-TRACE-ORDER'];
    assert.deepEqual(after, before, label + ': anonymise changed the problems');
    assert.equal(anon.text.length, text.length, label);
    // Fix-up either refuses or leaves no control problem.
    const fx = F.fixUp(text);
    if (fx.ok) {
      accepted++;
      const c = codeCounts(fx.text);
      for (const code of ['ACH-BATCH-COUNT', 'ACH-BATCH-HASH', 'ACH-FILE-BATCH-COUNT', 'ACH-FILE-BLOCK-COUNT', 'ACH-FILE-ENTRY-COUNT', 'ACH-FILE-HASH', 'ACH-BLOCKING', 'ACH-RECORD-LENGTH', 'ACH-FILE-CONTROL-MISSING', 'ACH-BATCH-CONTROL-MISSING']) {
        assert.ok(!c[code], label + ': ' + code + ' after fix-up');
      }
    }
    n++;
  }
  assert.equal(n, 2000);
  assert.ok(accepted > 500, 'fix-up accepted ' + accepted);
});

test('seeded fuzz: hostile field values in every position of the sample', () => {
  const lines = samples.sampleFor('valid').text.split('\n');
  const rnd = createRandom(4242);
  const values = ['\u0000', 'ÿ', '-', '+', '=', '@', '"', ',', '\'', '<', '>', '&', '`', '|', '\\', ' ', '9', 'Z'];
  for (let round = 0; round < 600; round++) {
    const copy = lines.slice();
    const li = rnd.int(0, 12);
    const pos = rnd.int(0, 93);
    copy[li] = copy[li].slice(0, pos) + rnd.pick(values) + copy[li].slice(pos + 1);
    exercise(copy.join('\n'), 'line ' + li + ' position ' + (pos + 1));
  }
});
