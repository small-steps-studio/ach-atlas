'use strict';
// Large files: 500,000 entries (about 47 MB) read, checked and recomputed within time and memory
// bounds; the Pro tools on 100,000 entries.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ach/parse');
const D = require('../src/ach/describe');
const O = require('../src/ach/outline');
const { validate } = require('../src/ach/validate');
const F = require('../src/pro/fixup');
const A = require('../src/pro/anonymise');
const E = require('../src/pro/export');
const G = require('../src/pro/generate');
const V = require('../src/ach/values');

function bigFile(entries) {
  const header = '101 590123400' + '1520749386' + '2611120915A094101' + 'RIVERSTONE TEST BANK   ' + 'HARBOR LANE CO         ' + '        ';
  const batchHeader = '5220' + 'HARBOR LANE CO'.padEnd(16) + ''.padEnd(20) + '1520749386' + 'PPD' + 'PAYROLL'.padEnd(10) + ''.padEnd(6) + '261113' + '   1' + '59012340' + '0000001';
  const parts = [header, batchHeader];
  for (let k = 1; k <= entries; k++) {
    const amount = String(100 + (k % 900000)).padStart(10, '0');
    parts.push('622581234560' + ('ACCT' + k).padEnd(17) + amount + ('EMP' + k).padEnd(15) + 'RECEIVER'.padEnd(22) + '  0' + '59012340' + String(k).padStart(7, '0'));
  }
  // Placeholder controls; the fix-up writes the right ones.
  parts.push('8220' + ' '.repeat(90));
  parts.push('9' + ' '.repeat(93));
  return parts.join('\n') + '\n';
}

test('500,000 entries: read, fix up and check within bounds', { timeout: 300000 }, () => {
  const raw = bigFile(500000);
  assert.ok(raw.length > 47 * 1000 * 1000, 'about 47 MB: ' + raw.length);
  let t = Date.now();
  const fixed = F.fixUp(raw);
  assert.equal(fixed.ok, true, fixed.reason);
  const fixMs = Date.now() - t;
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  t = Date.now();
  const p = P.parseAch(fixed.text);
  const res = validate(p);
  const checkMs = Date.now() - t;
  const heapMb = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.deepEqual(res.problems.map((x) => x.code), []);
  assert.equal(res.totals.entries, 500000);
  // 500,000 x 58123456 = 29,061,728,000,000; rightmost ten digits 1728000000.
  assert.equal(V.hashField(res.totals.hash), '1728000000');
  assert.equal(res.totals.blocks, 50001, '500,004 records up to the file control');
  assert.ok(checkMs < 30000, 'read and check took ' + checkMs + ' ms');
  assert.ok(fixMs < 60000, 'fix-up took ' + fixMs + ' ms');
  assert.ok(heapMb < 400, 'heap grew by ' + Math.round(heapMb) + ' MB on top of the text');
  t = Date.now();
  const roots = O.rootNodes(p);
  const kids = O.childrenOf(p, roots.find((n) => n.kind === 'batch'));
  assert.equal(kids.length, 1 + 1000 + 1, '1,000 pages of 500 entries');
  assert.equal(O.childrenOf(p, kids[1000]).length, 500);
  const d = D.describeAt(p, p.structure.batches[0].control, 15);
  assert.equal(d.computed, 'Computed from the entries: 1728000000 (matches)');
  assert.equal(D.pathAt(p, 400000, 35), 'Batch 1 > Entry 399999 > Amount (30-39)');
  assert.ok(Date.now() - t < 20000, 'outline and hover took ' + (Date.now() - t) + ' ms');
  assert.equal(O.symbols(p)[1].children.length, 0, 'symbols stay at batch level for large files');
});

test('100,000 entries: create, anonymise and export', { timeout: 300000 }, () => {
  let t = Date.now();
  const g = G.generate({ sec: 'CCD', direction: 'mixed', count: 100000, batches: 10, min: 1n, max: 9999999n, effectiveDate: '261113', created: { date: '261112', time: '0900' }, addenda: true, seed: 7 });
  assert.equal(g.ok, true, g.reason);
  const genMs = Date.now() - t;
  t = Date.now();
  const anon = A.createAnonymiser({ seed: 1, amounts: 'replace' }).anonymise(g.text);
  const anonMs = Date.now() - t;
  assert.deepEqual(validate(P.parseAch(anon.text)).problems.map((x) => x.code), []);
  t = Date.now();
  const csv = E.toCsv(P.parseAch(g.text));
  const csvMs = Date.now() - t;
  assert.equal(csv.split('\r\n').length, 100002);
  assert.ok(genMs < 30000 && anonMs < 60000 && csvMs < 30000, 'create ' + genMs + ' ms, anonymise ' + anonMs + ' ms, export ' + csvMs + ' ms');
});
