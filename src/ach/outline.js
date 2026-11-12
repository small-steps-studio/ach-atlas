'use strict';
// Outline of an ACH file for the tree view and the editor's document symbols. The tree is built
// lazily: batches list their entries in pages of PAGE_SIZE, so a file with half a million entries
// opens at once. No editor API here.

const P = require('./parse');
const V = require('./values');
const C = require('./codes');
const T = require('./totals');
const L = require('./layout');

const PAGE_SIZE = 500;

function name(r, i, sec) {
  if (L.hasAddendaCount(sec)) return P.fieldOf(r, i, 59, 16).trim();
  if (sec === 'IAT') return '';
  return P.fieldOf(r, i, 55, 22).trim();
}

function entryNode(r, b, i, n) {
  const tx = C.transactionCode(P.fieldOf(r, i, 2, 2));
  const amount = V.cents(P.fieldOf(r, i, 30, 10));
  const who = name(r, i, b.sec);
  const addenda = P.addendaOf(r, i, b.end).length;
  return {
    kind: 'entry', record: i, batch: b, label: 'Entry ' + n + (who ? ': ' + who : ''),
    detail: (tx.valid ? tx.code + ' ' + (tx.kind === 'prenote' ? 'prenote' : tx.direction) : P.fieldOf(r, i, 2, 2)) + ' ' + (amount === null ? '?' : V.formatCents(amount)) + (addenda ? ' · ' + addenda + ' addenda' : ''),
    expandable: addenda > 0
  };
}

/** The top-level nodes: file header, batches, file control, filler and stray records. */
function rootNodes(parsed) {
  const r = parsed.records;
  const s = parsed.structure;
  const out = [];
  if (s.header !== -1) {
    const d = V.parseYYMMDD(P.fieldOf(r, s.header, 24, 6));
    out.push({ kind: 'file-header', record: s.header, label: 'File header', detail: P.fieldOf(r, s.header, 41, 23).trim() + (d ? ' · ' + d.iso : ''), expandable: false });
  }
  s.batches.forEach(function (b, k) {
    const t = T.batchTotals(r, b);
    const lab = T.batchLabel(r, b);
    const sums = [];
    if (t.debit > 0n) sums.push('debits ' + V.formatCents(t.debit));
    if (t.credit > 0n) sums.push('credits ' + V.formatCents(t.credit));
    out.push({
      kind: 'batch', record: b.header, batch: b, index: k + 1, label: 'Batch ' + (k + 1) + ': ' + (lab.sec || '?') + ' ' + lab.company,
      detail: t.entries + ' entr' + (t.entries === 1 ? 'y' : 'ies') + (sums.length ? ' · ' + sums.join(' · ') : '') + (lab.effective ? ' · ' + lab.effective : ''), expandable: true
    });
  });
  if (s.fileControl !== -1) out.push({ kind: 'file-control', record: s.fileControl, label: 'File control', detail: s.batches.length + ' batch' + (s.batches.length === 1 ? '' : 'es'), expandable: false });
  if (s.fillerCount) out.push({ kind: 'filler', record: s.fillerStart, label: 'Filler', detail: s.fillerCount + ' record' + (s.fillerCount === 1 ? '' : 's') + ' of nines', expandable: false });
  const headers = new Set();
  for (const b of s.batches) headers.add(b.header);
  const stray = s.misplaced.map(function (m) { return m.record; }).concat(s.afterControl, s.extraHeaders).filter(function (i) { return !headers.has(i); });
  if (stray.length) out.push({ kind: 'stray', records: stray.slice(0, PAGE_SIZE), label: 'Records out of place', detail: String(stray.length), expandable: true });
  return out;
}

/** Children of a node from rootNodes() or childrenOf(). */
function childrenOf(parsed, node) {
  const r = parsed.records;
  if (node.kind === 'batch') {
    const b = node.batch;
    const entries = P.entriesOf(r, b);
    const out = [{ kind: 'batch-header', record: b.header, label: 'Batch header', detail: 'service class ' + P.fieldOf(r, b.header, 2, 3) + ' · batch number ' + P.fieldOf(r, b.header, 88, 7), expandable: false }];
    if (entries.length <= PAGE_SIZE) for (let k = 0; k < entries.length; k++) out.push(entryNode(r, b, entries[k], k + 1));
    else {
      for (let from = 0; from < entries.length; from += PAGE_SIZE) {
        const to = Math.min(entries.length, from + PAGE_SIZE);
        out.push({ kind: 'page', batch: b, from: from, to: to, record: entries[from], label: 'Entries ' + (from + 1) + ' to ' + to, detail: '', expandable: true });
      }
    }
    if (b.control !== -1) out.push({ kind: 'batch-control', record: b.control, label: 'Batch control', detail: 'count ' + Number(P.fieldOf(r, b.control, 5, 6)) + ' · hash ' + P.fieldOf(r, b.control, 11, 10), expandable: false });
    return out;
  }
  if (node.kind === 'page') {
    const entries = P.entriesOf(r, node.batch);
    const out = [];
    for (let k = node.from; k < node.to; k++) out.push(entryNode(r, node.batch, entries[k], k + 1));
    return out;
  }
  if (node.kind === 'entry') {
    return P.addendaOf(r, node.record, node.batch.end).map(function (a, k) {
      const type = P.fieldOf(r, a, 2, 2);
      let detail = C.ADDENDA_TYPES[type] || 'addenda type ' + type;
      if (type === '99') detail = 'return ' + P.fieldOf(r, a, 4, 3);
      else if (type === '98') detail = 'change ' + P.fieldOf(r, a, 4, 3);
      else if (type === '05') detail = P.fieldOf(r, a, 4, 80).trim().slice(0, 60);
      return { kind: 'addenda', record: a, label: 'Addenda ' + (k + 1) + ' (' + type + ')', detail: detail, expandable: false };
    });
  }
  if (node.kind === 'stray') {
    return node.records.map(function (i) { return { kind: 'record', record: i, label: 'Record ' + (i + 1), detail: 'type ' + r.text.charAt(r.starts[i]), expandable: false }; });
  }
  return [];
}

/**
 * Document symbols: [{ name, detail, kind, start, end, selStart, selEnd, children }] with text
 * offsets. Entries are listed only when the file has at most `maxEntries` of them; otherwise the
 * batches appear without their entries.
 */
function symbols(parsed, maxEntries) {
  const r = parsed.records;
  const s = parsed.structure;
  const limit = typeof maxEntries === 'number' ? maxEntries : 5000;
  let total = 0;
  for (const b of s.batches) total += P.entriesOf(r, b).length;
  const withEntries = total <= limit;
  const end = function (i) { return r.starts[i] + r.lengths[i]; };
  function sym(nameText, detail, kind, a, b, children) {
    return { name: nameText || '?', detail: detail || '', kind: kind, start: r.starts[a], end: end(b), selStart: r.starts[a], selEnd: Math.min(end(a), r.starts[a] + 1), children: children || [] };
  }
  const out = [];
  for (const node of rootNodes(parsed)) {
    if (node.kind === 'batch') {
      const b = node.batch;
      const last = b.control !== -1 ? b.control : Math.max(b.header, b.end - 1);
      const kids = [];
      if (withEntries) {
        const entries = P.entriesOf(r, b);
        for (let k = 0; k < entries.length; k++) {
          const child = entryNode(r, b, entries[k], k + 1);
          const adds = P.addendaOf(r, child.record, b.end);
          const lastRec = adds.length ? adds[adds.length - 1] : child.record;
          kids.push(sym(child.label, child.detail, 'entry', child.record, lastRec, adds.map(function (a, n) { return sym('Addenda ' + (n + 1), P.fieldOf(r, a, 2, 2), 'addenda', a, a); })));
        }
      }
      out.push(sym(node.label, node.detail, 'batch', b.header, last, kids));
    } else if (node.kind === 'filler') {
      out.push(sym(node.label, node.detail, 'filler', s.fillerStart, s.fillerStart + s.fillerCount - 1));
    } else if (node.kind !== 'stray') {
      out.push(sym(node.label, node.detail, node.kind, node.record, node.record));
    }
  }
  return out;
}

/** One line per batch for Go To Batch: [{ index, record, label, description, detail }]. */
function batchList(parsed) {
  const r = parsed.records;
  return parsed.structure.batches.map(function (b, k) {
    const lab = T.batchLabel(r, b);
    const t = T.batchTotals(r, b);
    return {
      index: k + 1, record: b.header, label: 'Batch ' + (k + 1) + ': ' + (lab.sec || '?') + ' ' + lab.company,
      description: 'batch number ' + lab.number + (lab.effective ? ' · effective ' + lab.effective : ''),
      detail: t.entries + ' entries, ' + t.addenda + ' addenda · debits ' + V.formatCents(t.debit) + ' · credits ' + V.formatCents(t.credit)
    };
  });
}

module.exports = { rootNodes: rootNodes, childrenOf: childrenOf, symbols: symbols, batchList: batchList, PAGE_SIZE: PAGE_SIZE };
