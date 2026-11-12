'use strict';
// Recompute Control Records And Padding (Pro): rewrites every batch control and the file control
// from the entries, adds missing control records, pads records whose trailing spaces were removed
// back to 94 characters, and sets the filler records to complete the last block. Entries, addenda
// and headers are never changed. Files whose record order is broken are refused with the reason,
// because the right correction cannot be known.

const P = require('../ach/parse');
const B = require('./build');
const V = require('../ach/values');

const CODES = Object.freeze({
  EMPTY: 'FIX-EMPTY',
  NO_HEADER: 'FIX-NO-HEADER',
  LONG: 'FIX-LONG-RECORD',
  ORDER: 'FIX-RECORD-ORDER',
  TYPE: 'FIX-RECORD-TYPE',
  ADV: 'FIX-ADVICE-BATCH',
  OVERFLOW: 'FIX-TOO-LARGE'
});

const CONTROL_FIELDS = [
  ['service class code', 2, 3], ['entry/addenda count', 5, 6], ['entry hash', 11, 10], ['total debit amount', 21, 12], ['total credit amount', 33, 12],
  ['company identification', 45, 10], ['originating DFI identification', 80, 8], ['batch number', 88, 7]
];
const FILE_FIELDS = [['batch count', 2, 6], ['block count', 8, 6], ['entry/addenda count', 14, 8], ['entry hash', 22, 10], ['total debit amount', 32, 12], ['total credit amount', 44, 12], ['reserved field', 56, 39]];

function differences(before, after, fields) {
  const out = [];
  for (const f of fields) {
    const a = before.substr(f[1] - 1, f[2]).padEnd(f[2], ' ');
    const b = after.substr(f[1] - 1, f[2]);
    if (a !== b) out.push(f[0] + ' ' + (f[0].indexOf('amount') !== -1 && /^[0-9]+$/.test(a) ? V.formatCents(BigInt(a)) + ' to ' + V.formatCents(BigInt(b)) : a.trim() + ' to ' + b.trim()));
  }
  return out;
}

/**
 * Returns { ok: true, text, changes: [sentences], changed } or { ok: false, code, reason }.
 * Options: { filler: true } (false removes the filler records instead of completing the block).
 */
function fixUp(text, options) {
  const o = Object.assign({ filler: true }, options || {});
  const parsed = P.parseAch(text);
  const r = parsed.records;
  const s = parsed.structure;
  if (r.count === 0) return { ok: false, code: CODES.EMPTY, reason: 'The file contains no records.' };
  if (s.header !== 0) return { ok: false, code: CODES.NO_HEADER, reason: 'The file does not start with a file header record, so the file cannot be rebuilt.' };
  for (let i = 0; i < r.count; i++) {
    if (r.lengths[i] > P.RECORD_LENGTH) return { ok: false, code: CODES.LONG, reason: 'Record ' + (i + 1) + ' has ' + r.lengths[i] + ' characters (more than 94). Correct it by hand first; nothing was changed.' };
    if ([P.T1, P.T5, P.T6, P.T7, P.T8, P.T9].indexOf(P.typeOf(r, i)) === -1) return { ok: false, code: CODES.TYPE, reason: 'Record ' + (i + 1) + ' has an unknown record type. Correct it by hand first; nothing was changed.' };
  }
  const blocking = s.misplaced.filter(function (m) { return m.reason !== 'batch-without-control'; });
  if (blocking.length || s.extraHeaders.length || s.afterControl.length) {
    const first = blocking.length ? blocking[0].record : s.extraHeaders.length ? s.extraHeaders[0] : s.afterControl[0];
    return { ok: false, code: CODES.ORDER, reason: 'Record ' + (first + 1) + ' is out of order. The record order has to be corrected by hand first, because the right place cannot be known; nothing was changed.' };
  }
  for (const b of s.batches) {
    const sec = P.fieldOf(r, b.header, 51, 3);
    if (sec === 'ADV' || P.fieldOf(r, b.header, 2, 3) === '280') return { ok: false, code: CODES.ADV, reason: 'Batch ' + (s.batches.indexOf(b) + 1) + ' is an automated accounting advice batch, which this command does not recompute; nothing was changed.' };
  }

  const changes = [];
  let padded = 0;
  const rec = function (i) {
    const t = P.recordText(r, i);
    if (t.length < P.RECORD_LENGTH) { padded++; return t + ' '.repeat(P.RECORD_LENGTH - t.length); }
    return t;
  };
  const batches = s.batches.map(function (b) {
    const body = [];
    for (let i = b.first; i < b.end; i++) body.push(rec(i));
    return { header: rec(b.header), body: body, control: b.control !== -1 ? rec(b.control) : '', had: b.control !== -1 };
  });
  let records;
  try {
    records = B.assemble(rec(s.header), batches, { filler: o.filler });
  } catch (e) {
    return { ok: false, code: CODES.OVERFLOW, reason: (e && e.message ? e.message : 'A total is too large.') + ' Nothing was changed.' };
  }
  if (padded) changes.push(padded + ' record' + (padded === 1 ? '' : 's') + ' padded with spaces to 94 characters.');
  if (r.blankLines.length) changes.push(r.blankLines.length + ' empty line' + (r.blankLines.length === 1 ? '' : 's') + ' removed.');

  // Describe what changed in the control records.
  let k = 1;
  batches.forEach(function (b, n) {
    k += 1 + b.body.length;
    const now = records[k];
    if (!b.had) changes.push('Batch ' + (n + 1) + ': batch control added.');
    else {
      const d = differences(b.control, now, CONTROL_FIELDS);
      if (d.length) changes.push('Batch ' + (n + 1) + ' control: ' + d.join('; ') + '.');
    }
    k += 1;
  });
  const fc = records[k];
  if (s.fileControl === -1) changes.push('File control added.');
  else {
    const d = differences(rec(s.fileControl), fc, FILE_FIELDS);
    if (d.length) changes.push('File control: ' + d.join('; ') + '.');
  }
  const newFiller = records.length - k - 1;
  if (newFiller !== s.fillerCount) changes.push('Filler records: ' + s.fillerCount + ' to ' + newFiller + '.');

  const lineBreak = r.unwrapped ? '' : (r.lineBreak || '\n');
  const out = (r.bom ? '﻿' : '') + (lineBreak ? records.join(lineBreak) + (r.trailingBreak ? lineBreak : '') : records.join(''));
  return { ok: true, text: out, changes: changes, changed: out !== text };
}

module.exports = { fixUp: fixUp, CODES: CODES };
