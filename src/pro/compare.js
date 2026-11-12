'use strict';
// Compare With Another File (Pro): matches the batches and entries of two ACH files and lists
// what was added, removed or changed, field by field, with the totals of both files.
//
// Batches are matched by their batch number when company identification, SEC code, service class
// and entry description agree, otherwise by those four values in file order. Entries are matched
// by trace number; with ignoreTrace they are matched by transaction code, routing number, account
// number and identification number instead (in order, for repeated values), and trace numbers,
// batch numbers and the entry detail sequence numbers of addenda are not compared. ignoreDates
// leaves out the file creation date and time, the file ID modifier, and the effective,
// descriptive and settlement dates of the batches.
//
// The whole file is compared, not only its entries: file header, batch headers, entries and
// addenda, but also every batch control, the file control, the number of filler records, records
// out of place (after the file control, a second file header, entries outside a batch) and any
// other record that no part of the structure accounts for. The order of the batches and of the
// entries inside a batch is compared too. Finally the exact text is compared: the byte order mark,
// the position and number of empty lines, and (when nothing else differs) every record character
// by character, including its length, with the positions of the fields that an ignore option
// leaves out blanked. Only the style of the line breaks (LF, CR LF, CR, or no line breaks at all)
// is not compared. "No differences" is only reported when none of these differs.

const P = require('../ach/parse');
const L = require('../ach/layout');
const V = require('../ach/values');
const T = require('../ach/totals');
const U = require('../util');

const DATE_FIELDS = ['File creation date', 'File creation time', 'File ID modifier', 'Effective entry date', 'Company descriptive date', 'Settlement date'];
const MAX_LISTED = 200;

function summaryOf(parsed) {
  const t = T.fileTotals(parsed);
  return { records: parsed.records.count, batches: parsed.structure.batches.length, entries: t.entries, addenda: t.addenda, debit: t.debit, credit: t.credit };
}

function fieldDiffs(ra, ia, rb, ib, lay, skip) {
  const out = [];
  for (const f of lay.fields) {
    if (f.kind === 'type' || skip.indexOf(f.name) !== -1) continue;
    const a = P.fieldOf(ra, ia, f.start, f.length);
    const b = P.fieldOf(rb, ib, f.start, f.length);
    if (a !== b) out.push({ field: f.name, a: show(f, a), b: show(f, b) });
  }
  return out;
}

function show(f, raw) {
  if (f.kind === 'amount') { const c = V.cents(raw); return c === null ? raw : V.formatCents(c); }
  return raw.replace(/\s+$/, '');
}

function batchKey(r, b) {
  return [P.fieldOf(r, b.header, 41, 10), P.fieldOf(r, b.header, 51, 3), P.fieldOf(r, b.header, 2, 3), P.fieldOf(r, b.header, 54, 10)].join('|');
}

function addendaText(r, e, end, ignoreTrace) {
  return P.addendaOf(r, e, end).map(function (a) {
    const t = P.recordText(r, a);
    const type = t.slice(1, 3);
    if (!ignoreTrace) return t;
    if (type === '05' || /^1[0-8]$/.test(type)) return t.slice(0, 87);
    return t.slice(0, 79);
  }).join('\n');
}

function trimEnd(text) { return text.replace(/ +$/, ''); }

/** Record indexes out of place (misplaced, after the file control, extra headers). */
function strayRecords(p) {
  const s = p.structure;
  const headers = new Set(s.batches.map(function (b) { return b.header; }));
  return s.misplaced.map(function (m) { return m.record; }).concat(s.afterControl, s.extraHeaders)
    .filter(function (i) { return !headers.has(i); }).sort(function (x, y) { return x - y; });
}

/** Texts of the records that no part of the structure accounts for (unknown types, addenda without an entry, ...). */
function otherRecords(p, stray) {
  const r = p.records;
  const s = p.structure;
  const covered = new Uint8Array(r.count);
  if (s.header !== -1) covered[s.header] = 1;
  if (s.fileControl !== -1) covered[s.fileControl] = 1;
  for (const b of s.batches) {
    covered[b.header] = 1;
    if (b.control !== -1) covered[b.control] = 1;
    const entries = P.entriesOf(r, b);
    for (let k = 0; k < entries.length; k++) {
      covered[entries[k]] = 1;
      const adds = P.addendaOf(r, entries[k], b.end);
      for (let n = 0; n < adds.length; n++) covered[adds[n]] = 1;
    }
  }
  for (const i of stray) covered[i] = 1;
  const out = [];
  for (let i = 0; i < r.count; i++) {
    if (covered[i]) continue;
    if (s.fileControl !== -1 && i > s.fileControl && P.isFiller(r, i)) continue;
    out.push(trimEnd(P.recordText(r, i)));
  }
  return out;
}

/** { added, removed }: the texts that occur more often in b than in a, and the other way round. */
function multisetDiff(a, b) {
  const count = new Map();
  for (const t of a) count.set(t, (count.get(t) || 0) + 1);
  const added = [];
  for (const t of b) {
    const n = count.get(t) || 0;
    if (n > 0) count.set(t, n - 1); else added.push(t);
  }
  const removed = [];
  for (const [t, n] of count) for (let k = 0; k < n; k++) removed.push(t);
  return { added: added, removed: removed };
}

/** The 1-based start and length of the fields of a layout whose names are in `names`. */
function rangesOf(lay, names) {
  const out = [];
  for (const f of lay.fields) if (f.kind !== 'type' && names.indexOf(f.name) !== -1) out.push([f.start, f.length]);
  return out;
}

const RANGES = {
  fileHeaderDates: rangesOf(L.FILE_HEADER, DATE_FIELDS),
  batchHeaderDates: rangesOf(L.BATCH_HEADER, DATE_FIELDS),
  iatHeaderDates: rangesOf(L.IAT_BATCH_HEADER, DATE_FIELDS),
  batchHeaderNumber: rangesOf(L.BATCH_HEADER, ['Batch number']),
  iatHeaderNumber: rangesOf(L.IAT_BATCH_HEADER, ['Batch number']),
  batchControlNumber: rangesOf(L.BATCH_CONTROL, ['Batch number'])
};

/** The fields of record i that the chosen ignore options leave out (the same ones the field comparison leaves out). */
function ignoredRanges(r, i, o) {
  const type = P.typeOf(r, i);
  if (type === P.T1) return o.ignoreDates ? RANGES.fileHeaderDates : [];
  if (type === P.T5) {
    const iat = P.fieldOf(r, i, 51, 3) === 'IAT';
    return (o.ignoreDates ? (iat ? RANGES.iatHeaderDates : RANGES.batchHeaderDates) : []).concat(o.ignoreTrace ? (iat ? RANGES.iatHeaderNumber : RANGES.batchHeaderNumber) : []);
  }
  if (!o.ignoreTrace) return [];
  if (type === P.T6) return [[80, 15]];
  if (type === P.T7) { const t = P.fieldOf(r, i, 2, 2); return t === '05' || /^1[0-8]$/.test(t) ? [[88, 7]] : [[80, 15]]; }
  if (type === P.T8) return RANGES.batchControlNumber;
  return [];
}

/** The exact text of record i with the ignored fields blanked. */
function exactRecord(r, i, o) {
  let t = P.recordText(r, i);
  if (!o.ignoreDates && !o.ignoreTrace) return t;
  for (const g of ignoredRanges(r, i, o)) {
    const from = g[0] - 1;
    if (from >= t.length) continue;
    const to = Math.min(t.length, from + g[1]);
    t = t.slice(0, from) + ' '.repeat(to - from) + t.slice(to);
  }
  return t;
}

/** The number of empty lines in front of every record; the last item counts those after the last record. */
function blankGaps(r) {
  const t = r.text;
  const gaps = new Int32Array(r.count + 1);
  let pos = r.bom ? 1 : 0;
  let pending = 0;
  let rec = 0;
  while (pos < t.length) {
    let end = pos;
    while (end < t.length) {
      const c = t.charCodeAt(end);
      if (c === 10 || c === 13) break;
      end++;
    }
    let next = end;
    if (end < t.length) next = t.charCodeAt(end) === 13 && t.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
    if (end > pos) {
      if (rec < r.count) gaps[rec] = pending;
      pending = 0;
      rec = r.unwrapped ? r.count : rec + 1;
    } else pending++;
    pos = next;
  }
  gaps[r.count] = pending;
  return gaps;
}

function excerpt(t) { return t.length > 60 ? t.slice(0, 60) + '...' : t; }

/**
 * The exact text of the two files: { bom: null | { a, b }, blank: [{ after, end, a, b }], records:
 * [{ record, kind, detail, a, b }], moved, total }. `records` is only filled in when `withRecords`
 * is true (nothing else differs, so that one change does not also show up as a line of text).
 */
function exactDifferences(pa, pb, o, withRecords) {
  const ra = pa.records;
  const rb = pb.records;
  const out = { bom: null, blank: [], records: [], moved: false, total: 0 };
  if (ra.bom !== rb.bom) { out.bom = { a: ra.bom, b: rb.bom }; out.total++; }
  const ga = blankGaps(ra);
  const gb = blankGaps(rb);
  const top = Math.max(ra.count, rb.count);
  for (let k = 0; k <= top; k++) {
    const a = k <= ra.count ? ga[k] : 0;
    const b = k <= rb.count ? gb[k] : 0;
    if (a === b) continue;
    out.total++;
    if (out.blank.length < MAX_LISTED) out.blank.push({ after: k, end: k === top, a: a, b: b });
  }
  if (!withRecords) return out;
  const diffs = [];
  for (let k = 0; k < top; k++) {
    const a = k < ra.count ? exactRecord(ra, k, o) : null;
    const b = k < rb.count ? exactRecord(rb, k, o) : null;
    if (a !== b) diffs.push({ record: k + 1, a: a, b: b });
  }
  // The same records in another order: the differing records of one file are those of the other.
  let moved = diffs.length > 1 && diffs.every(function (d) { return d.a !== null && d.b !== null; });
  if (moved) {
    const rest = new Map();
    for (const d of diffs) rest.set(d.a, (rest.get(d.a) || 0) + 1);
    for (const d of diffs) {
      const n = rest.get(d.b) || 0;
      if (n === 0) { moved = false; break; }
      rest.set(d.b, n - 1);
    }
  }
  out.moved = moved;
  for (const d of diffs) {
    out.total++;
    if (out.records.length >= MAX_LISTED) continue;
    const item = { record: d.record, kind: 'content', detail: '', a: d.a === null ? '' : excerpt(d.a), b: d.b === null ? '' : excerpt(d.b) };
    if (d.a === null) { item.kind = 'only-second'; item.detail = 'the record exists only in the second file'; }
    else if (d.b === null) { item.kind = 'only-first'; item.detail = 'the record exists only in the first file'; }
    else if (moved) { item.kind = 'position'; item.detail = 'the record is at another position (the same records, in a different order)'; }
    else if (d.a.length !== d.b.length) {
      const sizes = d.a.length + ' characters in the first file, ' + d.b.length + ' in the second';
      if (d.a.replace(/ +$/, '') === d.b.replace(/ +$/, '')) { item.kind = 'spaces'; item.detail = sizes + ' (trailing spaces)'; }
      else if (Math.min(d.a.length, d.b.length) >= 94 && d.a.slice(0, 94) === d.b.slice(0, 94)) { item.kind = 'extra'; item.detail = sizes + ' (characters after position 94)'; }
      else { item.kind = 'length'; item.detail = sizes; }
    } else {
      let at = 0;
      while (at < d.a.length && d.a.charCodeAt(at) === d.b.charCodeAt(at)) at++;
      item.detail = 'different text, first difference at position ' + (at + 1);
    }
    out.records.push(item);
  }
  return out;
}

/** The exact-text differences as short phrases, for messages. */
function exactPhrases(x) {
  const out = [];
  if (x.bom) out.push('the byte order mark');
  if (x.blank.length) out.push('empty lines');
  const kinds = new Set(x.records.map(function (d) { return d.kind; }));
  if (kinds.has('spaces') || kinds.has('extra') || kinds.has('length')) out.push('record lengths');
  if (kinds.has('position')) out.push('the position of records');
  if (kinds.has('content') || kinds.has('only-first') || kinds.has('only-second')) out.push('record text');
  return out;
}

function bomText(x) { return x.a ? 'only in the first file' : 'only in the second file'; }
function blankText(d) {
  const where = d.end ? 'at the end of the file' : d.after === 0 ? 'at the start of the file, before record 1' : 'after record ' + d.after;
  return where + ': ' + d.a + ' empty line' + (d.a === 1 ? '' : 's') + ' in the first file, ' + d.b + ' in the second';
}

function present(flag) { return flag ? 'present' : 'missing'; }

/**
 * Compares two files. Options: { ignoreTrace, ignoreDates, labels: { a, b } }. Returns
 * { a, b (summaries), header (field differences), batches: [...], counts, identical }.
 */
function compare(textA, textB, options) {
  const o = options || {};
  const pa = P.parseAch(textA);
  const pb = P.parseAch(textB);
  const ra = pa.records;
  const rb = pb.records;
  const skipDates = o.ignoreDates ? DATE_FIELDS : [];
  const skipBatch = skipDates.concat(o.ignoreTrace ? ['Batch number'] : []);
  const skipEntry = o.ignoreTrace ? ['Trace number'] : [];
  const skipControl = o.ignoreTrace ? ['Batch number'] : [];
  const result = { a: summaryOf(pa), b: summaryOf(pb), header: [], batches: [], counts: { batchesAdded: 0, batchesRemoved: 0, batchesChanged: 0, entriesAdded: 0, entriesRemoved: 0, entriesChanged: 0 }, identical: false, labels: o.labels || { a: 'first file', b: 'second file' },
    structure: { fileControl: [], filler: { a: pa.structure.fillerCount, b: pb.structure.fillerCount }, stray: { a: 0, b: 0, added: [], removed: [] }, other: { a: 0, b: 0, added: [], removed: [] }, batchOrder: false, controlsChanged: 0 },
    exact: { bom: null, blank: [], records: [], moved: false, total: 0 } };

  if (pa.structure.header !== -1 && pb.structure.header !== -1) result.header = fieldDiffs(ra, pa.structure.header, rb, pb.structure.header, L.FILE_HEADER, skipDates);
  else if (pa.structure.header !== pb.structure.header) result.header = [{ field: 'File header record', a: present(pa.structure.header !== -1), b: present(pb.structure.header !== -1) }];

  // Match batches.
  const bas = pa.structure.batches;
  const bbs = pb.structure.batches;
  const usedB = new Set();
  const pairs = [];
  const unmatchedA = [];
  bas.forEach(function (ba, k) {
    const key = batchKey(ra, ba);
    const num = P.fieldOf(ra, ba.header, 88, 7);
    let hit = -1;
    if (!o.ignoreTrace) hit = bbs.findIndex(function (bb, j) { return !usedB.has(j) && P.fieldOf(rb, bb.header, 88, 7) === num && batchKey(rb, bb) === key; });
    if (hit === -1) hit = bbs.findIndex(function (bb, j) { return !usedB.has(j) && batchKey(rb, bb) === key; });
    if (hit === -1) { unmatchedA.push(k); return; }
    usedB.add(hit);
    pairs.push([k, hit]);
  });

  for (const pair of pairs) {
    const ba = bas[pair[0]];
    const bb = bbs[pair[1]];
    const lay = P.fieldOf(ra, ba.header, 51, 3) === 'IAT' ? L.IAT_BATCH_HEADER : L.BATCH_HEADER;
    const entry = { status: 'same', indexA: pair[0] + 1, indexB: pair[1] + 1, label: T.batchLabel(ra, ba), header: fieldDiffs(ra, ba.header, rb, bb.header, lay, skipBatch), control: [], reordered: false, added: [], removed: [], changed: [], totalsA: T.batchTotals(ra, ba), totalsB: T.batchTotals(rb, bb) };
    if (ba.control !== -1 && bb.control !== -1) entry.control = fieldDiffs(ra, ba.control, rb, bb.control, L.BATCH_CONTROL, skipControl);
    else if ((ba.control === -1) !== (bb.control === -1)) entry.control = [{ field: 'Batch control record', a: present(ba.control !== -1), b: present(bb.control !== -1) }];
    if (entry.control.length) result.structure.controlsChanged++;
    compareEntries(ba, bb, entry);
    if (entry.header.length || entry.control.length || entry.reordered || entry.added.length || entry.removed.length || entry.changed.length) { entry.status = 'changed'; result.counts.batchesChanged++; }
    result.counts.entriesAdded += entry.added.length;
    result.counts.entriesRemoved += entry.removed.length;
    result.counts.entriesChanged += entry.changed.length;
    result.batches.push(entry);
  }
  for (const k of unmatchedA) {
    const t = T.batchTotals(ra, bas[k]);
    result.batches.push({ status: 'removed', indexA: k + 1, indexB: 0, label: T.batchLabel(ra, bas[k]), header: [], added: [], removed: [], changed: [], totalsA: t, totalsB: null });
    result.counts.batchesRemoved++;
    result.counts.entriesRemoved += t.entries;
  }
  bbs.forEach(function (bb, j) {
    if (usedB.has(j)) return;
    const t = T.batchTotals(rb, bb);
    result.batches.push({ status: 'added', indexA: 0, indexB: j + 1, label: T.batchLabel(rb, bb), header: [], added: [], removed: [], changed: [], totalsA: null, totalsB: t });
    result.counts.batchesAdded++;
    result.counts.entriesAdded += t.entries;
  });
  result.batches.sort(function (x, y) { return (x.indexA || 1e9) - (y.indexA || 1e9) || (x.indexB - y.indexB); });

  // Matched batches that changed their order.
  let lastB = -1;
  for (const pair of pairs.slice().sort(function (x, y) { return x[0] - y[0]; })) {
    if (pair[1] < lastB) result.structure.batchOrder = true;
    lastB = pair[1];
  }

  // File control, filler records, records out of place and any other record.
  const st = result.structure;
  if (pa.structure.fileControl !== -1 && pb.structure.fileControl !== -1) st.fileControl = fieldDiffs(ra, pa.structure.fileControl, rb, pb.structure.fileControl, L.FILE_CONTROL, []);
  else if (pa.structure.fileControl !== pb.structure.fileControl) st.fileControl = [{ field: 'File control record', a: present(pa.structure.fileControl !== -1), b: present(pb.structure.fileControl !== -1) }];
  const strayA = strayRecords(pa);
  const strayB = strayRecords(pb);
  const sd = multisetDiff(strayA.map(function (i) { return trimEnd(P.recordText(ra, i)); }), strayB.map(function (i) { return trimEnd(P.recordText(rb, i)); }));
  st.stray = { a: strayA.length, b: strayB.length, added: sd.added, removed: sd.removed };
  const otherA = otherRecords(pa, strayA);
  const otherB = otherRecords(pb, strayB);
  const od = multisetDiff(otherA, otherB);
  st.other = { a: otherA.length, b: otherB.length, added: od.added, removed: od.removed };

  const c = result.counts;
  const sameStructure = !result.header.length && !c.batchesAdded && !c.batchesRemoved && !c.batchesChanged && !st.fileControl.length && st.filler.a === st.filler.b &&
    !sd.added.length && !sd.removed.length && !od.added.length && !od.removed.length && !st.batchOrder;
  // The exact text last: the byte order mark and the empty lines always, every record only when the
  // structure is the same, so that one changed record is not also listed as a line of text.
  result.exact = exactDifferences(pa, pb, o, sameStructure);
  result.identical = sameStructure && result.exact.total === 0;
  return result;

  function entryKey(r, e) {
    if (!o.ignoreTrace) return P.fieldOf(r, e, 80, 15);
    return [P.fieldOf(r, e, 2, 2), P.fieldOf(r, e, 4, 9), P.fieldOf(r, e, 13, 17).trim(), P.fieldOf(r, e, 40, 15).trim()].join('|');
  }
  function describeEntry(r, e, sec) {
    const name = L.hasAddendaCount(sec) ? P.fieldOf(r, e, 59, 16).trim() : sec === 'IAT' ? '' : P.fieldOf(r, e, 55, 22).trim();
    const c2 = V.cents(P.fieldOf(r, e, 30, 10));
    return { trace: P.fieldOf(r, e, 80, 15), transactionCode: P.fieldOf(r, e, 2, 2), routing: P.fieldOf(r, e, 4, 9), account: P.fieldOf(r, e, 13, 17).trim(), amount: c2 === null ? P.fieldOf(r, e, 30, 10) : V.formatCents(c2), name: name };
  }
  function compareEntries(ba, bb, entry) {
    const sec = P.fieldOf(ra, ba.header, 51, 3);
    const lay = L.entryLayout(sec);
    const ea = P.entriesOf(ra, ba);
    const eb = P.entriesOf(rb, bb);
    const byKey = new Map();
    const position = new Map();
    for (let k = 0; k < eb.length; k++) {
      const key = entryKey(rb, eb[k]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(eb[k]);
      position.set(eb[k], k);
    }
    const matched = new Set();
    let lastPosition = -1;
    for (let k = 0; k < ea.length; k++) {
      const key = entryKey(ra, ea[k]);
      const list = byKey.get(key);
      if (!list || !list.length) { entry.removed.push(describeEntry(ra, ea[k], sec)); continue; }
      const other = list.shift();
      matched.add(other);
      if (position.get(other) < lastPosition) entry.reordered = true;
      lastPosition = position.get(other);
      const diffs = fieldDiffs(ra, ea[k], rb, other, lay, skipEntry);
      const adA = addendaText(ra, ea[k], ba.end, o.ignoreTrace);
      const adB = addendaText(rb, other, bb.end, o.ignoreTrace);
      if (adA !== adB) diffs.push({ field: 'Addenda', a: adA.split('\n').filter(Boolean).length + ' record(s)', b: adB.split('\n').filter(Boolean).length + ' record(s), content differs' });
      if (diffs.length) entry.changed.push({ entry: describeEntry(rb, other, sec), diffs: diffs });
    }
    for (let k = 0; k < eb.length; k++) if (!matched.has(eb[k])) entry.added.push(describeEntry(rb, eb[k], sec));
  }
}

/** One sentence for the notification after a comparison. */
function summaryText(res) {
  if (res.identical) return 'no differences with the chosen options.';
  const c = res.counts;
  const st = res.structure;
  const parts = [c.batchesChanged + ' batches changed, ' + c.batchesAdded + ' added, ' + c.batchesRemoved + ' removed; ' + c.entriesChanged + ' entries changed, ' + c.entriesAdded + ' added, ' + c.entriesRemoved + ' removed'];
  const more = [];
  if (res.header.length) more.push('the file header');
  if (st.controlsChanged) more.push(st.controlsChanged + ' batch control' + (st.controlsChanged === 1 ? '' : 's'));
  if (st.fileControl.length) more.push('the file control');
  if (st.filler.a !== st.filler.b) more.push('the number of filler records');
  if (st.stray.added.length || st.stray.removed.length) more.push('records out of place');
  if (st.other.added.length || st.other.removed.length) more.push('other records');
  if (st.batchOrder) more.push('the order of the batches');
  for (const phrase of exactPhrases(res.exact)) more.push(phrase);
  if (more.length) parts.push('also different: ' + more.join(', '));
  return parts.join('; ') + '. The report is open as a new file.';
}

function money(c) { return c === null || c === undefined ? '' : V.formatCents(c); }

/** The comparison as a Markdown report. */
function toMarkdown(res, title) {
  const m = U.escapeMarkdown;
  const lines = ['# ' + m(title || 'ACH file comparison'), ''];
  lines.push('Compared: ' + m(res.labels.a) + ' (first) with ' + m(res.labels.b) + ' (second).', '');
  lines.push('| | First | Second | Difference |', '| --- | ---: | ---: | ---: |');
  lines.push('| Records | ' + res.a.records + ' | ' + res.b.records + ' | ' + (res.b.records - res.a.records) + ' |');
  lines.push('| Batches | ' + res.a.batches + ' | ' + res.b.batches + ' | ' + (res.b.batches - res.a.batches) + ' |');
  lines.push('| Entries | ' + res.a.entries + ' | ' + res.b.entries + ' | ' + (res.b.entries - res.a.entries) + ' |');
  lines.push('| Addenda | ' + res.a.addenda + ' | ' + res.b.addenda + ' | ' + (res.b.addenda - res.a.addenda) + ' |');
  lines.push('| Debits | ' + money(res.a.debit) + ' | ' + money(res.b.debit) + ' | ' + money(res.b.debit - res.a.debit) + ' |');
  lines.push('| Credits | ' + money(res.a.credit) + ' | ' + money(res.b.credit) + ' | ' + money(res.b.credit - res.a.credit) + ' |');
  lines.push('');
  const c = res.counts;
  if (res.identical) { lines.push('**No differences** (with the chosen options).', ''); return lines.join('\n'); }
  lines.push('Batches: ' + c.batchesChanged + ' changed, ' + c.batchesAdded + ' added, ' + c.batchesRemoved + ' removed. Entries: ' + c.entriesChanged + ' changed, ' + c.entriesAdded + ' added, ' + c.entriesRemoved + ' removed.', '');
  const st = res.structure;
  if (st.fileControl.length) {
    lines.push('## File control', '', '| Field | First | Second |', '| --- | --- | --- |');
    for (const d of st.fileControl) lines.push('| ' + m(d.field) + ' | ' + m(d.a) + ' | ' + m(d.b) + ' |');
    lines.push('');
  }
  if (st.filler.a !== st.filler.b) lines.push('## Filler records', '', 'Filler records (nines) after the file control: ' + st.filler.a + ' in the first file, ' + st.filler.b + ' in the second.', '');
  if (st.batchOrder) lines.push('## Batch order', '', 'The batches that both files contain appear in a different order.', '');
  const x = res.exact;
  if (x.bom || x.blank.length || x.records.length) {
    lines.push('## Exact text', '', 'The text of the two files differs where the structure does not show it (records are numbered from 1; empty lines are not records).', '');
    if (x.bom) lines.push('* Byte order mark: ' + bomText(x.bom) + '.');
    for (const d of x.blank) lines.push('* Empty lines ' + m(blankText(d)) + '.');
    if (x.bom || x.blank.length) lines.push('');
    if (x.records.length) {
      lines.push('| Record | Difference | First file | Second file |', '| ---: | --- | --- | --- |');
      for (const d of x.records) lines.push('| ' + d.record + ' | ' + m(d.detail) + ' | ' + m(d.a) + ' | ' + m(d.b) + ' |');
      lines.push('');
    }
  }
  if (st.stray.added.length || st.stray.removed.length) {
    lines.push('## Records out of place', '', 'Records after the file control, second file headers and entries or addenda outside a batch: ' + st.stray.a + ' in the first file, ' + st.stray.b + ' in the second (' + st.stray.removed.length + ' only in the first, ' + st.stray.added.length + ' only in the second).', '');
  }
  if (st.other.added.length || st.other.removed.length) {
    lines.push('## Other records', '', 'Records that belong to no batch header, entry, addenda or control (unknown record types, addenda without an entry): ' + st.other.a + ' in the first file, ' + st.other.b + ' in the second (' + st.other.removed.length + ' only in the first, ' + st.other.added.length + ' only in the second).', '');
  }
  if (res.header.length) {
    lines.push('## File header', '', '| Field | First | Second |', '| --- | --- | --- |');
    for (const d of res.header) lines.push('| ' + m(d.field) + ' | ' + m(d.a) + ' | ' + m(d.b) + ' |');
    lines.push('');
  }
  for (const b of res.batches) {
    if (b.status === 'same') continue;
    const name = 'Batch ' + (b.indexA || '-') + ' / ' + (b.indexB || '-') + ': ' + b.label.sec + ' ' + b.label.company + ' (batch number ' + b.label.number + ')';
    lines.push('## ' + m(name) + ' (' + b.status + ')', '');
    if (b.status !== 'changed') {
      const t = b.totalsA || b.totalsB;
      lines.push(t.entries + ' entries, debits ' + money(t.debit) + ', credits ' + money(t.credit) + '.', '');
      continue;
    }
    lines.push('Debits ' + money(b.totalsA.debit) + ' to ' + money(b.totalsB.debit) + '; credits ' + money(b.totalsA.credit) + ' to ' + money(b.totalsB.credit) + '.', '');
    if (b.header.length) {
      lines.push('| Batch header field | First | Second |', '| --- | --- | --- |');
      for (const d of b.header) lines.push('| ' + m(d.field) + ' | ' + m(d.a) + ' | ' + m(d.b) + ' |');
      lines.push('');
    }
    if (b.control.length) {
      lines.push('| Batch control field | First | Second |', '| --- | --- | --- |');
      for (const d of b.control) lines.push('| ' + m(d.field) + ' | ' + m(d.a) + ' | ' + m(d.b) + ' |');
      lines.push('');
    }
    if (b.reordered) lines.push('The entries of this batch appear in a different order.', '');
    const rows = [];
    for (const e of b.removed) rows.push(['removed', e, '']);
    for (const e of b.added) rows.push(['added', e, '']);
    for (const ch of b.changed) rows.push(['changed', ch.entry, ch.diffs.map(function (d) { return d.field + ': ' + d.a + ' to ' + d.b; }).join('; ')]);
    if (rows.length) {
      lines.push('| Change | Trace number | Name | Amount | Details |', '| --- | --- | --- | ---: | --- |');
      for (const row of rows.slice(0, MAX_LISTED)) lines.push('| ' + row[0] + ' | ' + m(row[1].trace) + ' | ' + m(row[1].name) + ' | ' + m(row[1].amount) + ' | ' + m(row[2]) + ' |');
      if (rows.length > MAX_LISTED) lines.push('', (rows.length - MAX_LISTED) + ' more rows are in the CSV report.');
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Every difference as CSV rows: level, batch (first/second), trace, name, field, first, second. */
function toCsv(res, options) {
  const o = options || {};
  const row = function (cells) { return U.csvRow(cells, o); };
  let out = row(['Level', 'Batch in first file', 'Batch in second file', 'Trace number', 'Name', 'Field', 'First', 'Second']);
  for (const d of res.header) out += row(['file header', '', '', '', '', d.field, d.a, d.b]);
  const st = res.structure;
  for (const d of st.fileControl) out += row(['file control', '', '', '', '', d.field, d.a, d.b]);
  if (st.filler.a !== st.filler.b) out += row(['filler records', '', '', '', '', 'number of filler records', st.filler.a, st.filler.b]);
  if (st.batchOrder) out += row(['batch order', '', '', '', '', 'order of the batches', 'as in the first file', 'different']);
  for (const t of st.stray.removed) out += row(['record out of place', '', '', '', '', 'record only in the first file', t.slice(0, 60), '']);
  for (const t of st.stray.added) out += row(['record out of place', '', '', '', '', 'record only in the second file', '', t.slice(0, 60)]);
  for (const t of st.other.removed) out += row(['other record', '', '', '', '', 'record only in the first file', t.slice(0, 60), '']);
  for (const t of st.other.added) out += row(['other record', '', '', '', '', 'record only in the second file', '', t.slice(0, 60)]);
  const x = res.exact;
  if (x.bom) out += row(['byte order mark', '', '', '', '', 'byte order mark', x.bom.a ? 'present' : 'missing', x.bom.b ? 'present' : 'missing']);
  for (const d of x.blank) out += row(['empty lines', '', '', '', '', d.end ? 'at the end of the file' : 'after record ' + d.after, d.a, d.b]);
  for (const d of x.records) out += row(['exact text', '', '', '', '', 'record ' + d.record + ': ' + d.detail, d.a, d.b]);
  for (const b of res.batches) {
    if (b.status === 'added' || b.status === 'removed') {
      const t = b.totalsA || b.totalsB;
      out += row(['batch ' + b.status, b.indexA || '', b.indexB || '', '', b.label.company, 'entries / debits / credits', b.totalsA ? t.entries + ' / ' + V.plainCents(t.debit) + ' / ' + V.plainCents(t.credit) : '', b.totalsB ? t.entries + ' / ' + V.plainCents(t.debit) + ' / ' + V.plainCents(t.credit) : '']);
      continue;
    }
    for (const d of b.header) out += row(['batch header', b.indexA, b.indexB, '', '', d.field, d.a, d.b]);
    for (const d of b.control) out += row(['batch control', b.indexA, b.indexB, '', '', d.field, d.a, d.b]);
    if (b.reordered) out += row(['entry order', b.indexA, b.indexB, '', '', 'order of the entries', 'as in the first file', 'different']);
    for (const e of b.removed) out += row(['entry removed', b.indexA, b.indexB, e.trace, e.name, 'amount', e.amount, '']);
    for (const e of b.added) out += row(['entry added', b.indexA, b.indexB, e.trace, e.name, 'amount', '', e.amount]);
    for (const ch of b.changed) for (const d of ch.diffs) out += row(['entry changed', b.indexA, b.indexB, ch.entry.trace, ch.entry.name, d.field, d.a, d.b]);
  }
  return out;
}

module.exports = { compare: compare, toMarkdown: toMarkdown, toCsv: toCsv, summaryText: summaryText };
