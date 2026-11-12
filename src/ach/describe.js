'use strict';
// Explains a position in an ACH file: which record and field it is, the raw characters and what
// they mean (amounts, dates, routing numbers with their check digit, codes), and for control
// fields the value computed from the entries. Used by the hover, Copy Field Path and the status
// bar. No editor API here.

const P = require('./parse');
const L = require('./layout');
const V = require('./values');
const C = require('./codes');
const T = require('./totals');

const totalsCache = new WeakMap();
function fileTotalsOf(parsed) {
  let t = totalsCache.get(parsed);
  if (!t) { t = T.fileTotals(parsed); totalsCache.set(parsed, t); }
  return t;
}

/** The layout of record i, chosen by its record type, its batch's SEC code and its addenda type. */
function layoutOf(parsed, i) {
  const r = parsed.records;
  const t = P.typeOf(r, i);
  if (t === P.T1) return L.FILE_HEADER;
  if (t === P.T5) return P.fieldOf(r, i, 51, 3) === 'IAT' ? L.IAT_BATCH_HEADER : L.BATCH_HEADER;
  if (t === P.T6) {
    const b = P.batchOf(parsed.structure, i);
    return L.entryLayout(b ? b.sec : '');
  }
  if (t === P.T7) return L.addendaLayout(P.fieldOf(r, i, 2, 2));
  if (t === P.T8) return L.BATCH_CONTROL;
  if (t === P.T9) return P.isFiller(r, i) ? L.FILLER : L.FILE_CONTROL;
  return null;
}

/** Position of record i in the file: { batchIndex (1-based or 0), entryIndex, addendaIndex, kind }. */
function placeOf(parsed, i) {
  const r = parsed.records;
  const s = parsed.structure;
  const t = P.typeOf(r, i);
  const out = { batchIndex: 0, entryIndex: 0, addendaIndex: 0, kind: '' };
  if (t === P.T9 && P.isFiller(r, i)) {
    out.kind = 'filler';
    out.fillerIndex = s.fillerStart !== -1 && i >= s.fillerStart ? i - s.fillerStart + 1 : 0;
    return out;
  }
  const b = P.batchOf(s, i);
  if (b) out.batchIndex = s.batches.indexOf(b) + 1;
  if (t === P.T1) out.kind = 'file-header';
  else if (t === P.T9) out.kind = 'file-control';
  else if (t === P.T5) out.kind = 'batch-header';
  else if (t === P.T8) out.kind = 'batch-control';
  else if ((t === P.T6 || t === P.T7) && b) {
    const entries = P.entriesOf(r, b);
    let e = i;
    while (e > b.first && P.typeOf(r, e) === P.T7) e--;
    if (P.typeOf(r, e) === P.T6) {
      out.entryIndex = indexIn(entries, e) + 1;
      if (t === P.T7) { out.kind = 'addenda'; out.addendaIndex = i - e; } else out.kind = 'entry';
    } else out.kind = t === P.T6 ? 'entry' : 'addenda';
  } else out.kind = 'record';
  return out;
}

function indexIn(sorted, value) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] === value) return mid;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/** "Batch 2 > Entry 1 > Amount (30-39)" for record i and a 1-based column. */
function pathAt(parsed, i, column) {
  const lay = layoutOf(parsed, i);
  const fld = lay ? L.fieldAt(lay, column) : null;
  const p = placeOf(parsed, i);
  const parts = [];
  if (p.kind === 'file-header') parts.push('File header');
  else if (p.kind === 'file-control') parts.push('File control');
  else if (p.kind === 'filler') parts.push('Filler record' + (p.fillerIndex ? ' ' + p.fillerIndex : ''));
  else {
    if (p.batchIndex) parts.push('Batch ' + p.batchIndex);
    if (p.kind === 'batch-header') parts.push('Batch header');
    else if (p.kind === 'batch-control') parts.push('Batch control');
    else if (p.kind === 'entry' || p.kind === 'addenda') {
      if (p.entryIndex) parts.push('Entry ' + p.entryIndex);
      if (p.kind === 'addenda') parts.push('Addenda ' + (p.addendaIndex || '?'));
    } else parts.push('Record ' + (i + 1));
  }
  if (fld && p.kind !== 'filler') parts.push(fld.name + ' (' + (fld.start === fld.end ? fld.start : fld.start + '-' + fld.end) + ')');
  return parts.join(' > ');
}

/**
 * Describes the field at a 1-based column of record i: { layout, field, raw, meaning, computed,
 * path, place } or null when the record type is unknown or the column is outside every field.
 */
function describeAt(parsed, i, column) {
  const r = parsed.records;
  const lay = layoutOf(parsed, i);
  if (!lay) return null;
  const fld = L.fieldAt(lay, column);
  if (!fld) return null;
  const raw = P.fieldOf(r, i, fld.start, fld.length);
  const out = { layout: lay, field: fld, raw: raw, meaning: '', computed: '', path: pathAt(parsed, i, column), place: placeOf(parsed, i) };
  out.meaning = meaning(parsed, i, fld, raw);
  out.computed = computed(parsed, i, lay, fld, raw);
  return out;
}

function meaning(parsed, i, fld, raw) {
  const r = parsed.records;
  const trimmed = raw.trim();
  switch (fld.kind) {
    case 'type': return C.RECORD_TYPES[raw] || 'unknown record type';
    case 'constant': {
      const want = { 'Priority code': '01', 'Record size': '094', 'Blocking factor': '10', 'Format code': '1' }[fld.name];
      return want === undefined ? trimmed : raw === want ? 'correct (' + want + ')' : 'should be ' + want;
    }
    case 'routing10':
      if (/^ [0-9]{9}$/.test(raw)) return 'routing number ' + raw.slice(1) + ', check digit ' + (V.validRouting(raw.slice(1)) ? 'correct' : 'wrong (should be ' + V.checkDigit(raw.slice(1, 9)) + ')');
      return trimmed ? 'not in the usual form (a space followed by nine digits)' : 'blank';
    case 'date': {
      if (!trimmed) return 'blank';
      const d = V.parseYYMMDD(raw);
      return d ? d.iso + ', ' + V.WEEKDAYS[d.weekday] : 'not a valid date (YYMMDD)';
    }
    case 'time': {
      if (!trimmed) return 'blank';
      const t = V.parseHHMM(raw);
      return t ? t.text : 'not a valid time (HHMM)';
    }
    case 'julian': return !trimmed ? 'blank (the ACH operator fills it in)' : /^[0-9]{3}$/.test(raw) ? 'day ' + Number(raw) + ' of the year' : 'not a day number';
    case 'service': return C.SERVICE_CLASSES[raw] ? raw + ': ' + C.SERVICE_CLASSES[raw] : 'unknown service class code';
    case 'sec':
      if (!C.SEC_CODES[raw]) return 'unknown SEC code';
      return raw + ': ' + C.SEC_CODES[raw] + (C.CHECKED_SEC.indexOf(raw) !== -1 ? '' : ' (read and totalled; fields specific to this code are not checked)');
    case 'status': return C.ORIGINATOR_STATUS[raw] ? raw + ': ' + C.ORIGINATOR_STATUS[raw] : 'unknown originator status code';
    case 'routing8': {
      if (!/^[0-9]{8}$/.test(raw)) return 'not eight digits';
      if (fld.start === 4 && P.typeOf(r, i) === P.T6) {
        const cd = P.fieldOf(r, i, 12, 1);
        const ok = V.checkDigit(raw) === Number(cd) && /^[0-9]$/.test(cd);
        return 'routing number ' + raw + cd + ', check digit ' + (ok ? 'correct' : 'wrong (should be ' + V.checkDigit(raw) + ')');
      }
      return 'bank identification; with its check digit the routing number is ' + raw + V.checkDigit(raw);
    }
    case 'check': {
      const rdfi = P.fieldOf(r, i, 4, 8);
      if (!/^[0-9]{8}$/.test(rdfi)) return 'cannot be checked: the bank identification is not eight digits';
      const want = V.checkDigit(rdfi);
      return String(want) === raw ? 'correct for ' + rdfi : 'wrong: for ' + rdfi + ' the check digit is ' + want;
    }
    case 'txcode': { const tx = C.transactionCode(raw); return tx.valid ? tx.code + ': ' + tx.label : 'unknown transaction code'; }
    case 'amount': { const c = V.cents(raw); return c === null ? 'not a valid amount (digits only)' : V.formatCents(c) + ' (the last two digits are cents)'; }
    case 'count': return /^[0-9]+$/.test(raw) ? String(Number(raw)) : trimmed ? 'not a number' : 'blank';
    case 'hash': return /^[0-9]+$/.test(raw) ? raw : 'not a number';
    case 'digits': return /^[0-9]+$/.test(raw) ? raw : trimmed ? 'not all digits' : 'blank';
    case 'trace': return /^[0-9]{15}$/.test(raw) ? 'bank ' + raw.slice(0, 8) + ', sequence ' + raw.slice(8) : trimmed ? 'not fifteen digits' : 'blank';
    case 'indicator': {
      let n = 0;
      for (let k = i + 1; k < r.count && P.typeOf(r, k) === P.T7; k++) n++;
      if (raw === '0') return 'no addenda (' + n + ' follow' + (n === 1 ? 's' : '') + ')';
      if (raw === '1') return 'addenda follow (' + n + ' found)';
      return 'must be 0 or 1';
    }
    case 'addendaType': return C.ADDENDA_TYPES[raw] ? raw + ': ' + C.ADDENDA_TYPES[raw] : 'unknown addenda type';
    case 'returnCode': return C.RETURN_CODES[raw] ? raw + ': ' + C.RETURN_CODES[raw] : raw + ' (see your bank\'s list of return reason codes)';
    case 'changeCode': return C.CHANGE_CODES[raw] ? raw + ': ' + C.CHANGE_CODES[raw] : raw + ' (see your bank\'s list of change codes)';
    case 'reserved': return trimmed ? 'should be blank' : 'blank';
    case 'filler': return 'filler record';
    default: return trimmed ? trimmed : 'blank';
  }
}

function computed(parsed, i, lay, fld, raw) {
  const r = parsed.records;
  const t = P.typeOf(r, i);
  let value = null;
  if (lay === L.BATCH_CONTROL && t === P.T8) {
    const b = P.batchOf(parsed.structure, i);
    if (!b) return '';
    const bt = T.batchTotals(r, b);
    if (fld.name === 'Entry/addenda count') value = String(bt.entries + bt.addenda);
    else if (fld.name === 'Entry hash') value = V.hashField(bt.hash);
    else if (fld.name === 'Total debit entry dollar amount') value = V.formatCents(bt.debit);
    else if (fld.name === 'Total credit entry dollar amount') value = V.formatCents(bt.credit);
    else if (fld.name === 'Service class code' || fld.name === 'Company identification' || fld.name === 'Originating DFI identification' || fld.name === 'Batch number') {
      const fromHeader = { 'Service class code': [2, 3], 'Company identification': [41, 10], 'Originating DFI identification': [80, 8], 'Batch number': [88, 7] }[fld.name];
      const h = P.fieldOf(r, b.header, fromHeader[0], fromHeader[1]);
      return 'Batch header: ' + h + (h === raw ? ' (same)' : ' (differs)');
    }
  } else if (lay === L.FILE_CONTROL) {
    const ft = fileTotalsOf(parsed);
    if (fld.name === 'Batch count') value = String(parsed.structure.batches.length);
    else if (fld.name === 'Block count') value = String(ft.blocks);
    else if (fld.name === 'Entry/addenda count') value = String(ft.entries + ft.addenda);
    else if (fld.name === 'Entry hash') value = V.hashField(ft.hash);
    else if (fld.name === 'Total debit entry dollar amount in file') value = V.formatCents(ft.debit);
    else if (fld.name === 'Total credit entry dollar amount in file') value = V.formatCents(ft.credit);
  } else if (fld.name === 'Entry detail sequence number' && t === P.T7) {
    let e = i;
    while (e > 0 && P.typeOf(r, e) === P.T7) e--;
    if (P.typeOf(r, e) === P.T6) {
      const tr = P.fieldOf(r, e, 80, 15);
      return 'Entry trace number ends in ' + tr.slice(8) + (tr.slice(8) === raw ? ' (same)' : ' (differs)');
    }
  }
  if (value === null) return '';
  const own = fld.kind === 'amount' ? (V.cents(raw) === null ? null : V.formatCents(V.cents(raw))) : fld.kind === 'count' ? (/^[0-9]+$/.test(raw) ? String(Number(raw)) : null) : raw;
  return 'Computed from the entries: ' + value + (own === value ? ' (matches)' : ' (differs)');
}

function code(text) {
  const s = String(text);
  return s.indexOf('`') === -1 ? '`' + s + '`' : '`` ' + s + ' ``';
}

function escapeMd(s) {
  return String(s).replace(/([\\`*_{}\[\]()#+!|<>~])/g, '\\$1');
}

/** Markdown text for the hover of a description from describeAt(). */
function hoverMarkdown(d) {
  const f = d.field;
  const lines = [];
  lines.push('**' + escapeMd(d.layout.name) + ': ' + escapeMd(f.name) + '**');
  lines.push('');
  lines.push('Positions ' + f.start + (f.end !== f.start ? '-' + f.end : '') + ' (' + f.length + ' character' + (f.length === 1 ? '' : 's') + ')' + (f.kind === 'filler' ? '' : ' · raw ' + code(d.raw.replace(/ /g, '·'))));
  lines.push('');
  if (d.meaning) lines.push(escapeMd(d.meaning.charAt(0).toUpperCase() + d.meaning.slice(1)) + '.');
  if (d.computed) { lines.push(''); lines.push(escapeMd(d.computed) + '.'); }
  if (f.note) { lines.push(''); lines.push('*' + escapeMd(f.note) + '*'); }
  lines.push('');
  lines.push(escapeMd(d.path));
  return lines.join('\n');
}

module.exports = { layoutOf: layoutOf, placeOf: placeOf, pathAt: pathAt, describeAt: describeAt, hoverMarkdown: hoverMarkdown, fileTotalsOf: fileTotalsOf };
