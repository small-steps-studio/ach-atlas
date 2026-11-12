'use strict';
// Totals computed from the entries themselves (not from the control records): counts, entry hash,
// debit and credit sums per batch and per file, with exact integer arithmetic (BigInt).

const P = require('./parse');
const V = require('./values');
const C = require('./codes');

/**
 * Totals of one batch: { entries, addenda, hash (BigInt, full sum), debit, credit (BigInt cents),
 * badAmounts, badRouting, prenotes, zeroDollar, returns (addenda 99), changes (addenda 98),
 * unknownCodes }. Entries with an amount or routing field that is not all digits are counted in
 * badAmounts / badRouting and left out of the sums.
 */
function batchTotals(r, b) {
  const out = { entries: 0, addenda: 0, hash: 0n, debit: 0n, credit: 0n, badAmounts: 0, badRouting: 0, prenotes: 0, zeroDollar: 0, returns: 0, changes: 0, unknownCodes: 0 };
  const text = r.text;
  for (let i = b.first; i < b.end; i++) {
    const t = P.typeOf(r, i);
    if (t === P.T6) {
      out.entries++;
      const rdfi = P.fieldOf(r, i, 4, 8);
      if (/^[0-9]{8}$/.test(rdfi)) out.hash += BigInt(rdfi); else out.badRouting++;
      const tx = C.transactionCode(P.fieldOf(r, i, 2, 2));
      const amount = V.cents(P.fieldOf(r, i, 30, 10));
      if (amount === null) out.badAmounts++;
      if (!tx.valid) { out.unknownCodes++; continue; }
      if (tx.kind === 'prenote') out.prenotes++;
      if (tx.kind === 'zero') out.zeroDollar++;
      if (amount === null) continue;
      if (tx.direction === 'debit') out.debit += amount; else out.credit += amount;
    } else if (t === P.T7) {
      out.addenda++;
      const s = r.starts[i];
      if (text.charCodeAt(s + 1) === 57 && text.charCodeAt(s + 2) === 57) out.returns++;
      else if (text.charCodeAt(s + 1) === 57 && text.charCodeAt(s + 2) === 56) out.changes++;
    }
  }
  return out;
}

/**
 * Totals of the whole file: { batches: [{ batch, totals }], entries, addenda, hash, debit,
 * credit, recordsToControl, blocks } where recordsToControl counts every record up to and
 * including the file control record (or all records when there is none).
 */
function fileTotals(parsed) {
  const r = parsed.records;
  const s = parsed.structure;
  const out = { batches: [], entries: 0, addenda: 0, hash: 0n, debit: 0n, credit: 0n, prenotes: 0, returns: 0, changes: 0, recordsToControl: 0, blocks: 0 };
  for (const b of s.batches) {
    const t = batchTotals(r, b);
    out.batches.push({ batch: b, totals: t });
    out.entries += t.entries;
    out.addenda += t.addenda;
    out.hash += t.hash;
    out.debit += t.debit;
    out.credit += t.credit;
    out.prenotes += t.prenotes;
    out.returns += t.returns;
    out.changes += t.changes;
  }
  out.recordsToControl = s.fileControl !== -1 ? s.fileControl + 1 : r.count;
  out.blocks = Math.ceil(out.recordsToControl / 10);
  return out;
}

/** Short description of a batch for lists: number, company, SEC, effective date. */
function batchLabel(r, b) {
  const number = P.fieldOf(r, b.header, 88, 7).trim();
  const sec = P.fieldOf(r, b.header, 51, 3);
  const name = sec === 'IAT' ? P.fieldOf(r, b.header, 41, 10).trim() : P.fieldOf(r, b.header, 5, 16).trim();
  const eff = V.parseYYMMDD(P.fieldOf(r, b.header, 70, 6));
  return { number: number, sec: sec.trim(), company: name, effective: eff ? eff.iso : P.fieldOf(r, b.header, 70, 6).trim(), serviceClass: P.fieldOf(r, b.header, 2, 3) };
}

module.exports = { batchTotals: batchTotals, fileTotals: fileTotals, batchLabel: batchLabel };
