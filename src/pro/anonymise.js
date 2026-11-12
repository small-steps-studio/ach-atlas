'use strict';
// Anonymise (Pro): a copy of an ACH file in which names, account numbers, identification numbers,
// company names and identifications, bank names, routing numbers and free text are replaced.
//
// Guarantees:
// 1. One mapping per run: the same original value gets the same replacement everywhere in the
//    file, and in every file of a folder run (a routing number in the file header, a batch header,
//    a trace number and a return addenda becomes the same new number).
// 2. New routing numbers start with 5 (a range not assigned to banks) and carry a correct check
//    digit; a check digit that was wrong in the original stays wrong in the copy.
// 3. Every record keeps its length, and the entry hash and (when amounts are replaced) the totals
//    in the control records are adjusted by exactly the change of the entries, so the copy shows
//    the same problems as the original: a correct file stays correct.
// 4. Dates, transaction codes, SEC codes, entry descriptions and amounts (unless replacing them is
//    chosen) are kept, so the copy still behaves like the original in tests.
// 5. Values that are not what their field should hold (a routing field that is not eight digits)
//    are replaced as well, keeping their shape, so that the problem stays visible and the value
//    does not stay in clear.
// 6. Automated accounting advice batches (SEC code ADV) have their own entry layout: account
//    numbers, names and routing numbers are replaced at their positions; amounts and the totals of
//    their batch control are never touched. Entries of the SEC codes TRX and ATX keep their count of
//    addenda records.
// 7. Every replacement is derived from one secret key of 256 bits that is drawn for each run (see
//    keyed.js): the key is kept in memory only, never shown, stored or logged. Account numbers,
//    identification numbers and the other values that keep their shape are replaced by a keyed
//    permutation, so two different values never get the same replacement and the same value
//    always gets the same one. The routing-number table and the name labels live only in memory
//    and are never written anywhere. A `seed` option exists for unit tests: anyone who holds the
//    seed (or the key) can compute the same replacements again.

const P = require('../ach/parse');
const V = require('../ach/values');
const C = require('../ach/codes');
const K = require('./keyed');
const L = require('../ach/layout');

const KINDS = ['names', 'accounts', 'identifiers', 'companies', 'routing', 'text', 'dates', 'amounts'];

function createAnonymiser(options) {
  const o = options || {};
  const keyed = K.createKeyed(o);
  const rnd = keyed.random;
  const replaceAmounts = o.amounts === 'replace';
  const routing = new Map();
  const usedRouting = new Set();
  const labels = new Map();
  const labelCounters = new Map();

  function newCounts() { const c = {}; for (const k of KINDS) c[k] = 0; return c; }

  // Shape-preserving replacement: letters stay letters, digits stay digits, everything else (spaces,
  // separators, punctuation) stays. With a `kind` the replacement is the keyed permutation of the
  // value (the same value always gets the same replacement, two values never share one); without
  // one (free text) the characters are drawn at random.
  function shape(value, kind) {
    if (kind) return keyed.permute(kind, value);
    let out = value;
    const codes = new Array(value.length);
    for (let attempt = 0; attempt < 5 && out === value; attempt++) {
      for (let k = 0; k < value.length; k++) {
        const ch = value.charCodeAt(k);
        if (ch >= 48 && ch <= 57) codes[k] = rnd.digit();
        else if (ch >= 65 && ch <= 90) codes[k] = 65 + rnd.letter();
        else if (ch >= 97 && ch <= 122) codes[k] = 97 + rnd.letter();
        else codes[k] = ch;
      }
      out = String.fromCharCode.apply(null, codes);
    }
    return out;
  }

  function routing8(orig) {
    if (!/^[0-9]{8}$/.test(orig)) return null;
    let v = routing.get(orig);
    if (v) return v;
    // New numbers are drawn at random; no two originals share one. Once nearly all of the ten million
    // are in use, the next free number is taken.
    let tries = 0;
    let n = rnd.int(0, 9999999);
    v = '5' + String(n).padStart(7, '0');
    while (usedRouting.has(v) || v === orig) {
      n = tries++ < 1000 ? rnd.int(0, 9999999) : (n + 1) % 10000000;
      v = '5' + String(n).padStart(7, '0');
    }
    usedRouting.add(v);
    routing.set(orig, v);
    return v;
  }

  function routing9(orig9) {
    const eight = routing8(orig9.slice(0, 8));
    if (!eight) return null;
    const cdChar = orig9.charAt(8);
    if (!/^[0-9]$/.test(cdChar)) return eight + cdChar;
    let cd = V.checkDigit(eight);
    if (!V.validRouting(orig9)) cd = (cd + 1) % 10;
    return eight + cd;
  }

  // The first character (the identifier type) stays; the rest is permuted, so two identifications
  // never share a replacement.
  function companyId(orig) {
    return orig.charAt(0) + keyed.permute('companies', orig.slice(1));
  }

  function label(table, original) {
    let byValue = labels.get(table);
    if (!byValue) { byValue = new Map(); labels.set(table, byValue); }
    let v = byValue.get(original);
    if (v) return v;
    const n = (labelCounters.get(table) || 0) + 1;
    labelCounters.set(table, n);
    v = table + ' ' + String(n).padStart(table === 'PERSON' ? 6 : 4, '0');
    byValue.set(original, v);
    return v;
  }

  /**
   * Anonymises one file. Returns { text, counts: { names, accounts, ... }, changed } where
   * changed is the number of replaced values (0 means nothing was found to replace).
   */
  function anonymise(text) {
    const parsed = P.parseAch(text);
    const r = parsed.records;
    const s = parsed.structure;
    const counts = newCounts();
    // The copy is edited in place (one byte per character when the text allows it, else UTF-16
    // code units), so that nothing is rebuilt per field and a 50 MB file needs no per-record
    // strings. Fields are read from the original text.
    const narrow = !/[^\u0000-\u00ff]/.test(text);
    let units;
    if (narrow) units = Buffer.from(text, 'latin1');
    else {
      units = new Uint16Array(text.length);
      for (let k = 0; k < text.length; k++) units[k] = text.charCodeAt(k);
    }

    // Writes `value` at 1-based `start`, never past the end of the original record.
    function put(i, start, value) {
      const from = r.starts[i] + start - 1;
      const limit = r.starts[i] + r.lengths[i];
      if (from >= limit) return;
      const n = Math.min(value.length, limit - from);
      for (let k = 0; k < n; k++) units[from + k] = value.charCodeAt(k);
    }
    function get(i, start, len) { return P.fieldOf(r, i, start, len); }
    function blank(v) { return v.trim() === ''; }
    function textField(i, start, len, kind) {
      const v = get(i, start, len);
      if (blank(v)) return;
      const n = shape(v, kind === 'text' ? null : kind);
      if (n !== v) { put(i, start, n); counts[kind]++; }
    }
    function labelField(i, start, len, table, kind) {
      const v = get(i, start, len);
      if (blank(v)) return;
      // A value with characters outside printable ASCII keeps them (shape replacement), so that a
      // character problem of the original stays visible in the copy.
      if (/[^\x20-\x7E]/.test(v)) { textField(i, start, len, kind); return; }
      put(i, start, label(table, v.trim()).padEnd(len, ' ').slice(0, len));
      counts[kind]++;
    }
    function companyField(i, start) {
      const v = get(i, start, 10);
      if (blank(v)) return;
      const n = companyId(v);
      if (n !== v) { put(i, start, n); counts.companies++; }
    }
    function routing8Field(i, start) {
      const v = get(i, start, 8);
      const n = routing8(v);
      if (n) { put(i, start, n); counts.routing++; return; }
      // Not eight digits: keep the shape (the problem stays), replace the characters.
      if (!blank(v)) textField(i, start, 8, 'routing');
    }
    function routing10Field(i, start) {
      const v = get(i, start, 10);
      if (/^ [0-9]{9}$/.test(v)) { put(i, start, ' ' + routing9(v.slice(1))); counts.routing++; return true; }
      return false;
    }

    function anonFileHeader(h) {
      if (!routing10Field(h, 4)) textField(h, 4, 10, 'identifiers');
      if (!routing10Field(h, 14)) companyField(h, 14);
      labelField(h, 41, 23, 'BANK', 'names');
      labelField(h, 64, 23, 'COMPANY', 'names');
      textField(h, 87, 8, 'identifiers');
    }
    function anonBatchHeader(h) {
      if (get(h, 51, 3) === 'IAT') {
        textField(h, 24, 15, 'identifiers');
        companyField(h, 41);
      } else {
        labelField(h, 5, 16, 'COMPANY', 'companies');
        textField(h, 21, 20, 'text');
        companyField(h, 41);
      }
      routing8Field(h, 80);
    }
    // Returns the change of the entry hash and of the debit and credit totals. `advice` is true in
    // automated accounting advice batches, whose entries have another layout.
    function anonEntry(i, sec, delta, advice) {
      const rdfi = get(i, 4, 8);
      const nine = routing9(rdfi + get(i, 12, 1));
      if (nine && /^[0-9]{8}$/.test(rdfi)) {
        put(i, 4, nine.slice(0, 8));
        if (/^[0-9]$/.test(get(i, 12, 1))) put(i, 12, nine.charAt(8));
        counts.routing++;
        delta.hash += BigInt(nine.slice(0, 8)) - BigInt(rdfi);
      } else if (!blank(rdfi)) textField(i, 4, 8, 'routing');
      if (advice) {
        textField(i, 13, 15, 'accounts');
        labelField(i, 55, 22, 'PERSON', 'names');
        routing8Field(i, 80);
        return;
      }
      if (sec === 'IAT') textField(i, 40, 35, 'accounts');
      else {
        textField(i, 13, 17, 'accounts');
        textField(i, 40, 15, 'identifiers');
        if (L.hasAddendaCount(sec)) labelField(i, 59, 16, 'COMPANY', 'names');
        else if (sec === 'CCD') labelField(i, 55, 22, 'COMPANY', 'names');
        else labelField(i, 55, 22, 'PERSON', 'names');
      }
      routing8Field(i, 80);
      if (replaceAmounts) {
        const tx = C.transactionCode(get(i, 2, 2));
        const amount = V.cents(get(i, 30, 10));
        if (tx.valid && tx.kind === 'live' && amount !== null && amount > 0n) {
          const digits = amount.toString().length;
          const min = digits === 1 ? 1n : 10n ** BigInt(digits - 1);
          const max = 10n ** BigInt(digits) - 1n;
          let next = rnd.big(min, max);
          if (next === amount) next = next === max ? min : next + 1n;
          put(i, 30, String(next).padStart(10, '0'));
          counts.amounts++;
          if (tx.direction === 'debit') delta.debit += next - amount; else delta.credit += next - amount;
        }
      }
    }
    function anonAddenda(i) {
      const type = get(i, 2, 2);
      if (type === '05') textField(i, 4, 80, 'text');
      else if (type === '02') { textField(i, 4, 76, 'text'); routing8Field(i, 80); }
      else if (type === '98' || type === '99') {
        routing8Field(i, 7);
        routing8Field(i, 28);
        if (type === '98') textField(i, 36, 29, 'text');
        else {
          const death = V.parseYYMMDD(get(i, 22, 6));
          if (death) { put(i, 22, V.yymmddOfDay(death.day - rnd.int(1, 365))); counts.dates++; } else textField(i, 22, 6, 'dates');
          textField(i, 36, 44, 'text');
        }
        routing8Field(i, 80);
      } else if (/^1[0-8]$/.test(type)) textField(i, 4, 84, 'text');
      else textField(i, 4, 91, 'text');
    }
    function adjust(c, start, width, change, mod) {
      const stored = get(c, start, width);
      if (change !== 0n && new RegExp('^[0-9]{' + width + '}$').test(stored)) put(c, start, wrap(BigInt(stored) + change, mod, width));
    }

    const done = new Uint8Array(r.count);
    if (s.header !== -1) { anonFileHeader(s.header); done[s.header] = 1; }

    // Batches with their entries, addenda and controls.
    const fileDelta = { hash: 0n, debit: 0n, credit: 0n };
    for (const b of s.batches) {
      const sec = get(b.header, 51, 3);
      const advice = sec === 'ADV' || get(b.header, 2, 3) === '280';
      anonBatchHeader(b.header);
      done[b.header] = 1;
      const delta = { hash: 0n, debit: 0n, credit: 0n };
      for (let i = b.first; i < b.end; i++) {
        const t = P.typeOf(r, i);
        if (t === P.T6) { anonEntry(i, sec, delta, advice); done[i] = 1; } else if (t === P.T7) { anonAddenda(i); done[i] = 1; }
      }
      if (b.control !== -1) {
        const c = b.control;
        // The batch control of an advice batch holds 20-digit totals where the others hold the company
        // identification; it is replaced there only when it repeats the company identification of the header.
        if (!advice || get(c, 45, 10) === get(b.header, 41, 10)) companyField(c, 45);
        routing8Field(c, 80);
        adjust(c, 11, 10, delta.hash, V.HASH_MOD);
        adjust(c, 21, 12, delta.debit, 10n ** 12n);
        adjust(c, 33, 12, delta.credit, 10n ** 12n);
        done[c] = 1;
      }
      fileDelta.hash += delta.hash;
      fileDelta.debit += delta.debit;
      fileDelta.credit += delta.credit;
    }
    if (s.fileControl !== -1) {
      const c = s.fileControl;
      adjust(c, 22, 10, fileDelta.hash, V.HASH_MOD);
      adjust(c, 32, 12, fileDelta.debit, 10n ** 12n);
      adjust(c, 44, 12, fileDelta.credit, 10n ** 12n);
      done[c] = 1;
    }

    // Records outside the structure (out of place, after the file control, a second file header)
    // are anonymised by their record type as well; they take part in no total.
    for (let i = 0; i < r.count; i++) {
      if (done[i] || P.isFiller(r, i)) continue;
      const t = P.typeOf(r, i);
      if (t === P.T1) anonFileHeader(i);
      else if (t === P.T5) anonBatchHeader(i);
      else if (t === P.T6) anonEntry(i, '', { hash: 0n, debit: 0n, credit: 0n });
      else if (t === P.T7) anonAddenda(i);
      else if (t === P.T8) { companyField(i, 45); routing8Field(i, 80); }
      else if (t !== P.T9) textField(i, 2, 93, 'text');
    }
    // The copy has the layout of the original: line breaks, empty lines and the byte order mark were never touched.
    const result = Buffer.from(units.buffer, units.byteOffset, units.byteLength).toString(narrow ? 'latin1' : 'utf16le');
    let changed = 0;
    for (const k of KINDS) changed += counts[k];
    return { text: result, counts: counts, changed: changed };
  }

  return { anonymise: anonymise, routingTableSize: function () { return routing.size; } };
}

function wrap(value, mod, width) {
  let v = value % mod;
  if (v < 0n) v += mod;
  return v.toString().padStart(width, '0');
}

/** One sentence that lists what was replaced, for messages and reports. */
function countsText(counts) {
  const names = { names: 'names', accounts: 'account numbers', identifiers: 'identification numbers', companies: 'company names and identifications', routing: 'routing numbers', text: 'free-text fields', dates: 'dates of death', amounts: 'amounts' };
  const parts = [];
  for (const k of KINDS) if (counts[k]) parts.push(counts[k] + ' ' + names[k]);
  return parts.length ? parts.join(', ') : 'nothing';
}

module.exports = { createAnonymiser: createAnonymiser, countsText: countsText, KINDS: KINDS };
