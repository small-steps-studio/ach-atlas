'use strict';
// Building blocks for writing ACH records: fixed-width fields, control records from totals, filler
// records, and joining records with a line break. Used by the samples and the Pro tools.

const V = require('./values');
const P = require('./parse');

/** Text left-aligned in `width` characters (cut when longer). */
function text(value, width) {
  const s = String(value === undefined || value === null ? '' : value);
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

/** Digits right-aligned with zeros; throws a RangeError when the value does not fit. */
function num(value, width, what) {
  const s = V.zeroPad(value, width);
  if (s === null) throw new RangeError((what || 'A value') + ' (' + String(value) + ') does not fit into ' + width + ' digits.');
  return s;
}

/** Replaces the characters at 1-based `start` of a 94-character record. */
function setField(record, start, value) {
  return record.slice(0, start - 1) + value + record.slice(start - 1 + value.length);
}

/**
 * The batch control record for a batch header and its totals: { entries, addenda, hash, debit,
 * credit }. `keep` is the old control record (its message authentication code and reserved
 * field are kept) or ''.
 */
function batchControl(header, t, keep) {
  const old = keep && keep.length >= 94 ? keep : '8' + ' '.repeat(93);
  return '8' + header.slice(1, 4) + num(t.entries + t.addenda, 6, 'The entry/addenda count') + num(t.hash % V.HASH_MOD, 10) + num(t.debit, 12, 'The debit total') +
    num(t.credit, 12, 'The credit total') + header.slice(40, 50) + old.slice(54, 73) + old.slice(73, 79) + header.slice(79, 87) + header.slice(87, 94);
}

/** The file control record: { batches, blocks, count, hash, debit, credit }. */
function fileControl(t) {
  return '9' + num(t.batches, 6, 'The batch count') + num(t.blocks, 6, 'The block count') + num(t.count, 8, 'The entry/addenda count') + num(t.hash % V.HASH_MOD, 10) +
    num(t.debit, 12, 'The file debit total') + num(t.credit, 12, 'The file credit total') + ' '.repeat(39);
}

/** Filler records that bring `count` records to a multiple of ten. */
function filler(count) {
  const n = (10 - (count % 10)) % 10;
  const out = [];
  for (let k = 0; k < n; k++) out.push(P.NINES);
  return out;
}

/** Joins records with a line break; `trailing` adds one after the last record. */
function join(records, lineBreak, trailing) {
  if (!lineBreak) return records.join('');
  return records.join(lineBreak) + (trailing ? lineBreak : '');
}

module.exports = { text: text, num: num, setField: setField, batchControl: batchControl, fileControl: fileControl, filler: filler, join: join };
