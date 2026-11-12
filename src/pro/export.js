'use strict';
// Export Entries As CSV / JSON (Pro): one row (CSV) or object (JSON) per entry with the batch it
// belongs to. Amounts are written as exact decimal text ("1842.50") and as cents, never as
// floating-point numbers. CSV cells follow RFC 4180 and values that a spreadsheet would run as a
// formula get a leading apostrophe (unless the setting achAtlas.export.neutraliseFormulas is off).

const P = require('../ach/parse');
const V = require('../ach/values');
const C = require('../ach/codes');
const U = require('../util');
const L = require('../ach/layout');

const COLUMNS = ['batch', 'batch_number', 'company_name', 'company_id', 'sec_code', 'effective_date', 'entry', 'transaction_code', 'direction', 'entry_kind', 'account_type',
  'routing_number', 'account_number', 'amount', 'amount_cents', 'identification', 'name', 'discretionary_data', 'addenda_count', 'addenda', 'trace_number'];

function rows(parsed, each) {
  const r = parsed.records;
  parsed.structure.batches.forEach(function (b, k) {
    const h = b.header;
    const sec = P.fieldOf(r, h, 51, 3);
    const iat = sec === 'IAT';
    const eff = V.parseYYMMDD(P.fieldOf(r, h, 70, 6));
    const batch = {
      batch: k + 1, batch_number: P.fieldOf(r, h, 88, 7).trim(), company_name: iat ? '' : P.fieldOf(r, h, 5, 16).trim(), company_id: P.fieldOf(r, h, 41, 10).trim(),
      sec_code: sec.trim(), effective_date: eff ? eff.iso : P.fieldOf(r, h, 70, 6).trim()
    };
    const entries = P.entriesOf(r, b);
    for (let n = 0; n < entries.length; n++) {
      const e = entries[n];
      const tx = C.transactionCode(P.fieldOf(r, e, 2, 2));
      const amount = V.cents(P.fieldOf(r, e, 30, 10));
      const addenda = P.addendaOf(r, e, b.end);
      const addendaText = addenda.map(function (a) {
        const type = P.fieldOf(r, a, 2, 2);
        if (type === '05') return P.fieldOf(r, a, 4, 80).trim();
        if (type === '99') return 'return ' + P.fieldOf(r, a, 4, 3) + ' for trace ' + P.fieldOf(r, a, 7, 15);
        if (type === '98') return 'change ' + P.fieldOf(r, a, 4, 3) + ': ' + P.fieldOf(r, a, 36, 29).trim();
        return type + ' ' + P.fieldOf(r, a, 4, 84).trim();
      }).join(' | ');
      each(Object.assign({}, batch, {
        entry: n + 1, transaction_code: P.fieldOf(r, e, 2, 2), direction: tx.valid ? tx.direction : '', entry_kind: tx.valid ? tx.kind : '', account_type: tx.valid ? tx.account : '',
        routing_number: P.fieldOf(r, e, 4, 9).trim(), account_number: iat ? P.fieldOf(r, e, 40, 35).trim() : P.fieldOf(r, e, 13, 17).trim(),
        amount: amount === null ? '' : V.plainCents(amount), amount_cents: amount === null ? '' : amount.toString(),
        identification: iat ? '' : P.fieldOf(r, e, 40, 15).trim(), name: L.hasAddendaCount(sec) ? P.fieldOf(r, e, 59, 16).trim() : iat ? '' : P.fieldOf(r, e, 55, 22).trim(),
        discretionary_data: iat ? '' : P.fieldOf(r, e, 77, 2).trim(), addenda_count: addenda.length, addenda: addendaText, trace_number: P.fieldOf(r, e, 80, 15).trim()
      }));
    }
  });
}

/** CSV text (header row and one row per entry). `options.neutraliseFormulas` (default true) guards formula cells. */
function toCsv(parsed, options) {
  const parts = [U.csvRow(COLUMNS, options)];
  rows(parsed, function (row) { parts.push(U.csvRow(COLUMNS.map(function (c) { return row[c]; }), options)); });
  return parts.join('');
}

/** JSON text: { file, batches: [{ ..., entries: [...] }], totals }. Amounts are strings. */
function toJson(parsed) {
  const r = parsed.records;
  const s = parsed.structure;
  const file = {};
  if (s.header !== -1) {
    const h = s.header;
    const created = V.parseYYMMDD(P.fieldOf(r, h, 24, 6));
    Object.assign(file, {
      immediate_destination: P.fieldOf(r, h, 4, 10).trim(), immediate_origin: P.fieldOf(r, h, 14, 10).trim(), creation_date: created ? created.iso : P.fieldOf(r, h, 24, 6).trim(),
      creation_time: P.fieldOf(r, h, 30, 4).trim(), file_id_modifier: P.fieldOf(r, h, 34, 1), destination_name: P.fieldOf(r, h, 41, 23).trim(), origin_name: P.fieldOf(r, h, 64, 23).trim(),
      reference_code: P.fieldOf(r, h, 87, 8).trim()
    });
  }
  const batches = s.batches.map(function (b, k) {
    const sec = P.fieldOf(r, b.header, 51, 3);
    const eff = V.parseYYMMDD(P.fieldOf(r, b.header, 70, 6));
    return {
      batch: k + 1, batch_number: P.fieldOf(r, b.header, 88, 7).trim(), company_name: sec === 'IAT' ? '' : P.fieldOf(r, b.header, 5, 16).trim(), company_id: P.fieldOf(r, b.header, 41, 10).trim(),
      sec_code: sec.trim(), effective_date: eff ? eff.iso : P.fieldOf(r, b.header, 70, 6).trim(), entries: []
    };
  });
  let debit = 0n;
  let credit = 0n;
  let entries = 0;
  rows(parsed, function (row) {
    const e = {};
    for (const c of COLUMNS.slice(6)) e[c] = row[c];
    batches[row.batch - 1].entries.push(e);
    entries++;
    if (row.amount_cents !== '') { if (row.direction === 'debit') debit += BigInt(row.amount_cents); else if (row.direction === 'credit') credit += BigInt(row.amount_cents); }
  });
  return JSON.stringify({ file: file, batches: batches, totals: { batches: s.batches.length, entries: entries, debits: V.plainCents(debit), credits: V.plainCents(credit) } }, null, 2) + '\n';
}

module.exports = { toCsv: toCsv, toJson: toJson, COLUMNS: COLUMNS };
