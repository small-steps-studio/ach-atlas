'use strict';
// Assembles a complete ACH file from a file header and batches: every batch control and the file
// control are computed from the entries, and filler records complete the last block. Shared by
// Create Test File, Split, Merge and Recompute Control Records.

const P = require('../ach/parse');
const T = require('../ach/totals');
const W = require('../ach/write');

/** Totals of a list of 94-character entry and addenda records (see totals.batchTotals). */
function totalsOfBody(body) {
  const r = P.readRecords(body.join('\n'));
  return T.batchTotals(r, { first: 0, end: r.count });
}

/**
 * Builds the records of a file. `batches` is [{ header, body, control }] where `body` holds the
 * entry and addenda records and `control` an old batch control whose message authentication code
 * and reserved field are kept ('' for none). Options: { filler: true }. Returns the record list;
 * throws a RangeError when a count or a total does not fit into its field.
 */
function assemble(fileHeader, batches, options) {
  const o = Object.assign({ filler: true }, options || {});
  const out = [fileHeader];
  const sum = { batches: 0, blocks: 0, count: 0, hash: 0n, debit: 0n, credit: 0n };
  for (const b of batches) {
    const t = totalsOfBody(b.body);
    out.push(b.header);
    for (const rec of b.body) out.push(rec);
    out.push(W.batchControl(b.header, t, b.control || ''));
    sum.batches++;
    sum.count += t.entries + t.addenda;
    sum.hash += t.hash;
    sum.debit += t.debit;
    sum.credit += t.credit;
  }
  sum.blocks = Math.ceil((out.length + 1) / 10);
  out.push(W.fileControl(sum));
  if (o.filler) for (const f of W.filler(out.length)) out.push(f);
  return out;
}

module.exports = { assemble: assemble, totalsOfBody: totalsOfBody };
