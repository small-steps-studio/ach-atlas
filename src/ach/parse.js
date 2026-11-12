'use strict';
// Reads the text of an ACH file into records and batches without copying it: every record is an
// offset and a length into the original text, kept in typed arrays, so a 50 MB file with half a
// million entries costs a few megabytes on top of its text. Lines end in CR LF, LF or CR; a file
// without line breaks is read as consecutive 94-character records ("unwrapped").

const RECORD_LENGTH = 94;
const NINES = '9'.repeat(RECORD_LENGTH);

/**
 * Splits text into records. Returns { text, count, starts, lengths, unwrapped, bom, lineBreak,
 * trailingBreak, blankLines } where starts/lengths are Int32Arrays of `count` items and
 * blankLines holds the offsets of empty lines between records (at most 1,000).
 */
function readRecords(text) {
  const t = typeof text === 'string' ? text : '';
  let cap = Math.max(16, Math.ceil(t.length / 96) + 4);
  let starts = new Int32Array(cap);
  let lengths = new Int32Array(cap);
  let count = 0;
  const blankLines = [];
  function push(start, length) {
    if (count === cap) {
      cap *= 2;
      const s2 = new Int32Array(cap); s2.set(starts); starts = s2;
      const l2 = new Int32Array(cap); l2.set(lengths); lengths = l2;
    }
    starts[count] = start;
    lengths[count] = length;
    count++;
  }
  const bom = t.charCodeAt(0) === 0xFEFF;
  const begin = bom ? 1 : 0;
  let lineBreak = '';
  let firstBreak = -1;
  for (let i = begin; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 10 || c === 13) { firstBreak = i; break; }
  }
  if (firstBreak !== -1) lineBreak = t.charCodeAt(firstBreak) === 13 ? (t.charCodeAt(firstBreak + 1) === 10 ? '\r\n' : '\r') : '\n';
  let pos = begin;
  let trailingBreak = false;
  while (pos < t.length) {
    let end = pos;
    while (end < t.length) {
      const c = t.charCodeAt(end);
      if (c === 10 || c === 13) break;
      end++;
    }
    let next = end;
    if (end < t.length) next = t.charCodeAt(end) === 13 && t.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
    if (end > pos) push(pos, end - pos);
    else if (next < t.length && blankLines.length < 1000) blankLines.push(pos);
    if (end < t.length && next >= t.length) trailingBreak = true;
    pos = next;
  }
  // One line longer than a record: read it as consecutive 94-character records ("unwrapped").
  if (count === 1 && lengths[0] > RECORD_LENGTH) {
    const from = starts[0];
    const to = from + lengths[0];
    count = 0;
    for (let p = from; p < to; p += RECORD_LENGTH) push(p, Math.min(RECORD_LENGTH, to - p));
    return { text: t, count: count, starts: starts, lengths: lengths, unwrapped: true, bom: bom, lineBreak: lineBreak, trailingBreak: trailingBreak, blankLines: blankLines };
  }
  return { text: t, count: count, starts: starts, lengths: lengths, unwrapped: false, bom: bom, lineBreak: lineBreak, trailingBreak: trailingBreak, blankLines: blankLines };
}

/** The record text (without the line break). */
function recordText(r, i) { return r.text.substr(r.starts[i], r.lengths[i]); }

/** The record type character code of record i. */
function typeOf(r, i) { return r.text.charCodeAt(r.starts[i]); }

/** True when record i is a filler record of 94 nines. */
function isFiller(r, i) { return r.lengths[i] === RECORD_LENGTH && r.text.startsWith(NINES, r.starts[i]); }

/**
 * A field of record i (1-based start, length). Positions beyond the end of a short record read
 * as spaces, so a record whose trailing spaces were removed still has blank fields there.
 */
function fieldOf(r, i, start, length) {
  const len = r.lengths[i];
  const from = start - 1;
  if (from >= len) return ' '.repeat(length);
  const s = r.text.substr(r.starts[i] + from, Math.min(length, len - from));
  return s.length < length ? s + ' '.repeat(length - s.length) : s;
}

const T1 = 49; const T5 = 53; const T6 = 54; const T7 = 55; const T8 = 56; const T9 = 57;

/**
 * Groups the records into the file structure:
 * { header, fileControl, fillerStart, fillerCount, batches: [{ header, control, first, end, sec }],
 *   misplaced: [{ record, reason }], afterControl: [record], extraHeaders: [record] }
 * A batch spans the records first..end-1 between its header and its control (or the record that
 * closed it). Record indexes are positions in the arrays of readRecords().
 */
function buildStructure(r) {
  const s = { header: -1, fileControl: -1, fillerStart: -1, fillerCount: 0, batches: [], misplaced: [], afterControl: [], extraHeaders: [] };
  let open = null;
  function close(endIndex, control) {
    open.end = endIndex;
    open.control = control;
    s.batches.push(open);
    open = null;
  }
  for (let i = 0; i < r.count; i++) {
    const t = typeOf(r, i);
    if (s.fileControl !== -1) {
      if (isFiller(r, i)) { if (s.fillerStart === -1) s.fillerStart = i; s.fillerCount++; } else s.afterControl.push(i);
      continue;
    }
    if (t === T1) {
      if (s.header === -1 && i === 0) s.header = i;
      else if (s.header === -1) { s.header = i; s.misplaced.push({ record: i, reason: 'header-late' }); }
      else s.extraHeaders.push(i);
      continue;
    }
    if (t === T5) {
      if (open) { s.misplaced.push({ record: i, reason: 'batch-without-control' }); close(i, -1); }
      open = { header: i, control: -1, first: i + 1, end: i + 1, sec: fieldOf(r, i, 51, 3) };
      continue;
    }
    if (t === T6 || t === T7) {
      if (!open) s.misplaced.push({ record: i, reason: t === T6 ? 'entry-outside-batch' : 'addenda-outside-batch' });
      continue;
    }
    if (t === T8) {
      if (!open) { s.misplaced.push({ record: i, reason: 'control-without-batch' }); continue; }
      close(i, i);
      continue;
    }
    if (t === T9) {
      if (isFiller(r, i)) { s.misplaced.push({ record: i, reason: 'filler-before-control' }); continue; }
      if (open) { s.misplaced.push({ record: open.header, reason: 'batch-without-control' }); close(i, -1); }
      s.fileControl = i;
      continue;
    }
    // Unknown record types are reported by the validator; they stay inside an open batch.
  }
  if (open) { s.misplaced.push({ record: open.header, reason: 'batch-without-control' }); close(r.count, -1); }
  return s;
}

/** The batch (from structure.batches) that contains record i, or null. Binary search. */
function batchOf(s, i) {
  let lo = 0;
  let hi = s.batches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = s.batches[mid];
    if (i < b.header) hi = mid - 1;
    else if (i > (b.control !== -1 ? b.control : b.end - 1)) lo = mid + 1;
    else return b;
  }
  return null;
}

/** Record indexes of the entries (type 6) of a batch, as an Int32Array (built once per batch). */
function entriesOf(r, b) {
  if (b.entries) return b.entries;
  let n = 0;
  for (let i = b.first; i < b.end; i++) if (typeOf(r, i) === T6) n++;
  const out = new Int32Array(n);
  let k = 0;
  for (let i = b.first; i < b.end; i++) if (typeOf(r, i) === T6) out[k++] = i;
  Object.defineProperty(b, 'entries', { value: out, enumerable: false, configurable: true });
  return out;
}

/** The addenda record indexes that follow entry record e (up to the next non-addenda record). */
function addendaOf(r, e, end) {
  const out = [];
  for (let i = e + 1; i < end && typeOf(r, i) === T7; i++) out.push(i);
  return out;
}

/** Reads text and structure in one call. */
function parseAch(text) {
  const records = readRecords(text);
  return { records: records, structure: buildStructure(records) };
}

/** True when the text starts like an ACH file (a file header in the first record). */
function looksLikeAch(text) {
  const t = String(text || '').replace(/^﻿/, '');
  if (!/^1[0-9 ]{2}[ 0-9A-Za-z]{10}[ 0-9A-Za-z]{10}[0-9]{6}/.test(t)) return false;
  const lineEnd = t.search(/[\r\n]/);
  const first = lineEnd === -1 ? t.slice(0, RECORD_LENGTH) : t.slice(0, lineEnd);
  // A header whose trailing spaces were removed still counts (it is reported as too short).
  if (first.length < 37 || first.length > RECORD_LENGTH) return false;
  return /^1/.test(first) && first.slice(34, 37) === '094';
}

module.exports = {
  RECORD_LENGTH: RECORD_LENGTH, NINES: NINES, readRecords: readRecords, recordText: recordText, typeOf: typeOf, isFiller: isFiller, fieldOf: fieldOf,
  buildStructure: buildStructure, batchOf: batchOf, entriesOf: entriesOf, addendaOf: addendaOf, parseAch: parseAch, looksLikeAch: looksLikeAch,
  T1: T1, T5: T5, T6: T6, T7: T7, T8: T8, T9: T9
};
