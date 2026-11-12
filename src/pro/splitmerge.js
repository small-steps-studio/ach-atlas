'use strict';
// Split Into One File Per Batch and Merge Files (Pro). Both write complete files: the file header
// of the source, the batches, a batch control and a file control computed from the entries, and
// filler records to a multiple of ten. Files with records out of order, records of the wrong
// length or unknown record types are refused with the reason, because the result could not be
// trusted. So are automated accounting advice batches (service class 280, SEC code ADV): their
// entries and controls use another layout, which these tools neither read nor rebuild.
//
// Split gives every file its own file ID modifier (the source file's own first, then A to Z and 0
// to 9), because banks commonly take a second file with the same destination, date and file ID
// modifier for a duplicate. The creation date and time are those of the source file.

const P = require('../ach/parse');
const B = require('./build');
const W = require('../ach/write');
const U = require('../util');

const CODES = Object.freeze({ STRUCTURE: 'SPLIT-STRUCTURE', NO_BATCHES: 'SPLIT-NO-BATCHES', DESTINATION: 'MERGE-DESTINATION', TOO_FEW: 'MERGE-TOO-FEW', OVERFLOW: 'MERGE-TOO-LARGE', ADVICE: 'SPLIT-ADVICE-BATCH', TOO_MANY: 'SPLIT-TOO-MANY' });

const MODIFIERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Returns null when the file can be rebuilt, otherwise a sentence that says why not. */
function structureProblem(parsed) {
  const r = parsed.records;
  const s = parsed.structure;
  if (!r.count || s.header !== 0) return 'it does not start with a file header record';
  for (let i = 0; i < r.count; i++) {
    if (r.lengths[i] !== P.RECORD_LENGTH) return 'record ' + (i + 1) + ' does not have 94 characters (run Recompute Control Records And Padding, or correct it first)';
    if ([P.T1, P.T5, P.T6, P.T7, P.T8, P.T9].indexOf(P.typeOf(r, i)) === -1) return 'record ' + (i + 1) + ' has an unknown record type';
  }
  if (s.misplaced.length || s.extraHeaders.length || s.afterControl.length) {
    const m = s.misplaced[0];
    return 'record ' + ((m ? m.record : s.extraHeaders.length ? s.extraHeaders[0] : s.afterControl[0]) + 1) + ' is out of order';
  }
  return null;
}

/** Returns null, or a sentence when the file has an automated accounting advice batch. */
function adviceProblem(parsed) {
  const r = parsed.records;
  const s = parsed.structure;
  for (let k = 0; k < s.batches.length; k++) {
    const b = s.batches[k];
    if (P.fieldOf(r, b.header, 51, 3) === 'ADV' || P.fieldOf(r, b.header, 2, 3) === '280') return 'batch ' + (k + 1) + ' is an automated accounting advice batch, which this command does not rebuild';
  }
  return null;
}

function body(r, b) {
  const out = [];
  for (let i = b.first; i < b.end; i++) out.push(P.recordText(r, i));
  return out;
}

function lineBreakOf(r) { return r.unwrapped ? '' : (r.lineBreak || '\n'); }

/**
 * Splits a file into one file per batch: { ok: true, files: [{ name, text, batch, entries }] } or
 * { ok: false, code, reason }. `baseName` is the source file name without extension.
 */
function split(text, baseName) {
  const parsed = P.parseAch(text);
  const why = structureProblem(parsed);
  if (why) return { ok: false, code: CODES.STRUCTURE, reason: 'The file cannot be split because ' + why + '. Nothing was written.' };
  const advice = adviceProblem(parsed);
  if (advice) return { ok: false, code: CODES.ADVICE, reason: 'The file cannot be split because ' + advice + '. Nothing was written.' };
  const r = parsed.records;
  const s = parsed.structure;
  if (!s.batches.length) return { ok: false, code: CODES.NO_BATCHES, reason: 'The file has no batches, so there is nothing to split.' };
  if (s.batches.length > MODIFIERS.length) return { ok: false, code: CODES.TOO_MANY, reason: 'The file has ' + s.batches.length + ' batches. Split gives every file its own file ID modifier (A to Z, 0 to 9), which allows at most ' + MODIFIERS.length + ' files. Nothing was written.' };
  const header = P.recordText(r, s.header);
  const modifiers = modifiersFor(P.fieldOf(r, s.header, 34, 1), s.batches.length);
  const used = new Set();
  const files = s.batches.map(function (b, k) {
    const records = B.assemble(W.setField(header, 34, modifiers[k]), [{ header: P.recordText(r, b.header), body: body(r, b), control: b.control !== -1 ? P.recordText(r, b.control) : '' }], { filler: true });
    const number = P.fieldOf(r, b.header, 88, 7).trim() || String(k + 1);
    let name = U.safeName(baseName) + '-batch-' + U.safeName(number) + '.ach';
    if (used.has(name)) name = U.safeName(baseName) + '-batch-' + U.safeName(number) + '-' + (k + 1) + '.ach';
    used.add(name);
    return { name: name, text: W.join(records, lineBreakOf(r), true), batch: k + 1, entries: P.entriesOf(r, b).length };
  });
  return { ok: true, files: files, notes: ['Each file has its own file ID modifier (' + modifiers.slice(0, 6).join(', ') + (modifiers.length > 6 ? ', ...' : '') + ') so that a bank does not take one for a duplicate of another; the creation date and time are those of the source file.'] };
}

/** The file ID modifiers of the split files: the source file's own first (when valid), then the unused ones in the order A-Z, 0-9. */
function modifiersFor(own, count) {
  const out = [];
  if (MODIFIERS.indexOf(own) !== -1 && own !== '') out.push(own);
  for (let k = 0; out.length < count && k < MODIFIERS.length; k++) if (out.indexOf(MODIFIERS[k]) === -1) out.push(MODIFIERS[k]);
  return out;
}

/**
 * Merges files ([{ name, text }], at least two) into one: the file header of the first file, all
 * batches in the given order renumbered from 1, controls recomputed. Refuses files for different
 * immediate destinations. Returns { ok: true, text, notes } or { ok: false, code, reason }.
 */
function merge(files) {
  if (!files || files.length < 2) return { ok: false, code: CODES.TOO_FEW, reason: 'Choose at least two files to merge.' };
  const parsedList = [];
  for (const f of files) {
    const p = P.parseAch(f.text);
    const why = structureProblem(p);
    if (why) return { ok: false, code: CODES.STRUCTURE, reason: f.name + ' cannot be merged because ' + why + '. Nothing was written.' };
    const advice = adviceProblem(p);
    if (advice) return { ok: false, code: CODES.ADVICE, reason: f.name + ' cannot be merged because ' + advice + '. Nothing was written.' };
    parsedList.push(p);
  }
  const first = parsedList[0];
  const dest = P.fieldOf(first.records, 0, 4, 10);
  for (let k = 1; k < parsedList.length; k++) {
    const d = P.fieldOf(parsedList[k].records, 0, 4, 10);
    if (d !== dest) return { ok: false, code: CODES.DESTINATION, reason: files[k].name + ' is for the immediate destination "' + d.trim() + '", ' + files[0].name + ' for "' + dest.trim() + '". Only files for the same destination can be merged. Nothing was written.' };
  }
  const batches = [];
  const traces = new Set();
  let duplicates = 0;
  let n = 0;
  parsedList.forEach(function (p) {
    const r = p.records;
    for (const b of p.structure.batches) {
      n++;
      const header = W.setField(P.recordText(r, b.header), 88, W.num(n, 7, 'The batch number'));
      const entries = P.entriesOf(r, b);
      for (let k = 0; k < entries.length; k++) {
        const tr = P.fieldOf(r, entries[k], 80, 15);
        if (traces.has(tr)) duplicates++;
        traces.add(tr);
      }
      batches.push({ header: header, body: body(r, b), control: b.control !== -1 ? P.recordText(r, b.control) : '' });
    }
  });
  let records;
  try { records = B.assemble(P.recordText(first.records, 0), batches, { filler: true }); } catch (e) { return { ok: false, code: CODES.OVERFLOW, reason: e.message + ' Nothing was written.' }; }
  const notes = ['The file header of ' + files[0].name + ' was used; check its creation date, time and file ID modifier before sending the file.', 'Batches were renumbered from 1 to ' + n + '.'];
  if (duplicates) notes.push(duplicates + ' trace number' + (duplicates === 1 ? ' appears' : 's appear') + ' in more than one of the merged files; the checks mark them in the new file.');
  return { ok: true, text: W.join(records, lineBreakOf(first.records), true), notes: notes, batches: n };
}

module.exports = { split: split, merge: merge, CODES: CODES, modifiersFor: modifiersFor };
