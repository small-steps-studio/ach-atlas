'use strict';
// Reconciliation report for a folder (Pro): totals of every ACH file and batch, totals by
// effective date and by SEC code, debits against credits, and a list of anomalies (problems found
// by the checks, trace numbers used in two files, batches that appear in two files, returns and
// change notices). Written as a self-contained HTML page without scripts, and as CSV.

const P = require('../ach/parse');
const V = require('../ach/values');
const T = require('../ach/totals');
const { validate } = require('../ach/validate');
const U = require('../util');

const MAX_TRACE_REPORTS = 100;

/**
 * Collects the report one file at a time, so that no file text is kept after it was read:
 * add(name, text) for every file, then result(). Files that do not start with an ACH file header
 * are listed as skipped. Options: { checks } (passed to the validator).
 */
function createReconciler(options) {
  const o = options || {};
  const res = { files: [], skipped: [], batches: [], days: [], bySec: [], anomalies: [], totals: { files: 0, batches: 0, entries: 0, debit: 0n, credit: 0n } };
  const days = new Map();
  const secs = new Map();
  const traces = new Map();
  const signatures = new Map();
  let traceReports = 0;
  let traceExtra = 0;
  function addFile(file) {
    if (!P.looksLikeAch(file.text)) { res.skipped.push({ name: file.name, reason: 'does not start with an ACH file header' }); return; }
    const parsed = P.parseAch(file.text);
    const r = parsed.records;
    const v = validate(parsed, { maxProblems: 50, checks: o.checks });
    const t = v.totals;
    const h = parsed.structure.header;
    const created = h !== -1 ? V.parseYYMMDD(P.fieldOf(r, h, 24, 6)) : null;
    res.files.push({
      name: file.name, batches: parsed.structure.batches.length, entries: t.entries, debit: t.debit, credit: t.credit, errors: v.counts.error, warnings: v.counts.warning,
      created: created ? created.iso : '', destination: h !== -1 ? P.fieldOf(r, h, 4, 10).trim() : ''
    });
    res.totals.files++;
    if (v.counts.error) {
      const first = v.problems.find(function (p) { return p.severity === 'error'; });
      res.anomalies.push({ file: file.name, kind: 'problems', text: v.counts.error + ' error' + (v.counts.error === 1 ? '' : 's') + ' found by the checks' + (first ? '; first: ' + first.code + ' ' + first.message : '') });
    }
    t.batches.forEach(function (bt, k) {
      const b = bt.batch;
      const bt2 = bt.totals;
      const lab = T.batchLabel(r, b);
      const row = { file: file.name, index: k + 1, number: lab.number, sec: lab.sec, company: lab.company, companyId: P.fieldOf(r, b.header, 41, 10).trim(), effective: lab.effective,
        entries: bt2.entries, debit: bt2.debit, credit: bt2.credit, prenotes: bt2.prenotes, returns: bt2.returns, changes: bt2.changes };
      res.batches.push(row);
      res.totals.batches++;
      res.totals.entries += bt2.entries;
      res.totals.debit += bt2.debit;
      res.totals.credit += bt2.credit;
      add(days, lab.effective || '(no date)', bt2);
      add(secs, lab.sec || '(none)', bt2);
      if (bt2.returns) res.anomalies.push({ file: file.name, kind: 'returns', text: 'Batch ' + (k + 1) + ' holds ' + bt2.returns + ' returned entr' + (bt2.returns === 1 ? 'y' : 'ies') + ' (addenda 99).' });
      if (bt2.changes) res.anomalies.push({ file: file.name, kind: 'changes', text: 'Batch ' + (k + 1) + ' holds ' + bt2.changes + ' notification' + (bt2.changes === 1 ? '' : 's') + ' of change (addenda 98).' });
      const sig = [row.companyId, row.sec, row.effective, P.fieldOf(r, b.header, 54, 10).trim(), row.entries, row.debit.toString(), row.credit.toString()].join('|');
      if (row.entries && signatures.has(sig)) {
        const prev = signatures.get(sig);
        res.anomalies.push({ file: file.name, kind: 'duplicate-batch', text: 'Batch ' + (k + 1) + ' has the same company, SEC code, effective date, description, entry count and totals as batch ' + prev.index + ' of ' + prev.file + ' (possible duplicate).' });
      } else signatures.set(sig, { file: file.name, index: k + 1 });
      const entries = P.entriesOf(r, b);
      for (let n = 0; n < entries.length; n++) {
        const tr = P.fieldOf(r, entries[n], 80, 15);
        if (!/^[0-9]{15}$/.test(tr)) continue;
        const seen = traces.get(tr);
        if (seen === undefined) traces.set(tr, file.name);
        else if (seen !== file.name) {
          if (traceReports < MAX_TRACE_REPORTS) { res.anomalies.push({ file: file.name, kind: 'duplicate-trace', text: 'Trace number ' + tr + ' is also used in ' + seen + '.' }); traceReports++; } else traceExtra++;
        }
      }
    });
  }
  function result() {
    const out = Object.assign({}, res, { anomalies: res.anomalies.slice() });
    if (traceExtra) out.anomalies.push({ file: '', kind: 'duplicate-trace', text: traceExtra + ' more trace numbers are used in more than one file.' });
    out.days = Array.from(days.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }).map(function (e) { return Object.assign({ date: e[0] }, e[1]); });
    out.bySec = Array.from(secs.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (e) { return Object.assign({ sec: e[0] }, e[1]); });
    return out;
  }
  return { add: function (name, text) { addFile({ name: name, text: text }); }, result: result };
}

/** The report for a list of files [{ name, text }] (see createReconciler). */
function reconcile(files, options) {
  const r = createReconciler(options);
  for (const f of files) r.add(f.name, f.text);
  return r.result();
}

function add(map, key, t) {
  const cur = map.get(key) || { batches: 0, entries: 0, debit: 0n, credit: 0n };
  cur.batches++;
  cur.entries += t.entries;
  cur.debit += t.debit;
  cur.credit += t.credit;
  map.set(key, cur);
}

const m = V.formatCents;

/** The report as one HTML page (inline styles, no scripts, every value escaped). */
function toHtml(res, title) {
  const e = U.escapeHtml;
  const row = function (cells, head) { return '<tr>' + cells.map(function (c, k) { return (head ? '<th' : '<td') + (k > 0 && !head && /^[-0-9,.]+$/.test(String(c)) ? ' class="n"' : '') + '>' + e(c) + (head ? '</th>' : '</td>'); }).join('') + '</tr>'; };
  const table = function (head, rows) { return '<table>' + row(head, true) + rows.map(function (r) { return row(r, false); }).join('') + '</table>'; };
  const parts = [];
  parts.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>' + e(title) + '</title>');
  parts.push('<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1b1f23}h1{font-size:22px}h2{font-size:17px;margin-top:28px}table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #c8ccd0;padding:4px 8px;text-align:left;font-size:13px}td.n{text-align:right;font-variant-numeric:tabular-nums}th{background:#eef1f4}p.note{color:#555;font-size:13px}</style></head><body>');
  parts.push('<h1>' + e(title) + '</h1>');
  const t = res.totals;
  parts.push(table(['Files', 'Batches', 'Entries', 'Debits', 'Credits', 'Credits minus debits'], [[t.files, t.batches, t.entries, m(t.debit), m(t.credit), m(t.credit - t.debit)]]));
  if (res.skipped.length) parts.push('<p class="note">' + res.skipped.length + ' file(s) skipped because they do not start with an ACH file header.</p>');
  parts.push('<h2>Anomalies</h2>');
  parts.push(res.anomalies.length ? table(['File', 'Kind', 'Details'], res.anomalies.map(function (a) { return [a.file, a.kind, a.text]; })) : '<p>None found.</p>');
  parts.push('<h2>By effective date</h2>');
  parts.push(table(['Effective date', 'Batches', 'Entries', 'Debits', 'Credits'], res.days.map(function (d) { return [d.date, d.batches, d.entries, m(d.debit), m(d.credit)]; })));
  parts.push('<h2>By SEC code</h2>');
  parts.push(table(['SEC code', 'Batches', 'Entries', 'Debits', 'Credits'], res.bySec.map(function (d) { return [d.sec, d.batches, d.entries, m(d.debit), m(d.credit)]; })));
  parts.push('<h2>Files</h2>');
  parts.push(table(['File', 'Created', 'Destination', 'Batches', 'Entries', 'Debits', 'Credits', 'Errors', 'Warnings'], res.files.map(function (f) { return [f.name, f.created, f.destination, f.batches, f.entries, m(f.debit), m(f.credit), f.errors, f.warnings]; })));
  parts.push('<h2>Batches</h2>');
  parts.push(table(['File', 'Batch', 'Number', 'SEC', 'Company', 'Effective', 'Entries', 'Debits', 'Credits', 'Prenotes', 'Returns', 'Changes'], res.batches.map(function (b) { return [b.file, b.index, b.number, b.sec, b.company, b.effective, b.entries, m(b.debit), m(b.credit), b.prenotes, b.returns, b.changes]; })));
  if (res.skipped.length) { parts.push('<h2>Skipped files</h2>'); parts.push(table(['File', 'Reason'], res.skipped.map(function (s) { return [s.name, s.reason]; }))); }
  parts.push('<p class="note">Totals are computed from the entries of each file. The checks are format checks; banks apply their own rules.</p>');
  parts.push('</body></html>\n');
  return parts.join('\n');
}

/** The report as CSV: one row per file, batch, day, SEC code and anomaly, with a section column. */
function toCsv(res, options) {
  const row = function (cells) { return U.csvRow(cells, options); };
  const p = V.plainCents;
  let out = row(['Section', 'File', 'Batch', 'Batch number', 'SEC code', 'Company', 'Effective date', 'Batches', 'Entries', 'Debits', 'Credits', 'Details']);
  for (const f of res.files) out += row(['file', f.name, '', '', '', '', f.created, f.batches, f.entries, p(f.debit), p(f.credit), f.errors + ' errors, ' + f.warnings + ' warnings']);
  for (const b of res.batches) out += row(['batch', b.file, b.index, b.number, b.sec, b.company, b.effective, 1, b.entries, p(b.debit), p(b.credit), b.prenotes + ' prenotes, ' + b.returns + ' returns, ' + b.changes + ' changes']);
  for (const d of res.days) out += row(['day', '', '', '', '', '', d.date, d.batches, d.entries, p(d.debit), p(d.credit), '']);
  for (const s of res.bySec) out += row(['sec', '', '', '', s.sec, '', '', s.batches, s.entries, p(s.debit), p(s.credit), '']);
  for (const a of res.anomalies) out += row(['anomaly', a.file, '', '', '', '', '', '', '', '', '', a.kind + ': ' + a.text]);
  for (const s of res.skipped) out += row(['skipped', s.name, '', '', '', '', '', '', '', '', '', s.reason]);
  out += row(['total', '', '', '', '', '', '', res.totals.batches, res.totals.entries, p(res.totals.debit), p(res.totals.credit), res.totals.files + ' files']);
  return out;
}

module.exports = { reconcile: reconcile, createReconciler: createReconciler, toHtml: toHtml, toCsv: toCsv };
