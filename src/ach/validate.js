'use strict';
// Format checks of an ACH file. Each problem has a stable code (documented in docs/problems.md),
// a severity, a range in the text and a message that says what is wrong and what was expected.
// These are checks of the file format and of the totals inside the file; banks apply further
// rules of their own.

const P = require('./parse');
const V = require('./values');
const C = require('./codes');
const T = require('./totals');

const CODES = Object.freeze({
  'ACH-EMPTY-FILE': 'error',
  'ACH-BOM': 'warning',
  'ACH-UNWRAPPED': 'info',
  'ACH-BLANK-LINE': 'warning',
  'ACH-CHARACTERS': 'error',
  'ACH-RECORD-LENGTH': 'error',
  'ACH-RECORD-TYPE': 'error',
  'ACH-RECORD-ORDER': 'error',
  'ACH-FILE-HEADER-MISSING': 'error',
  'ACH-FILE-CONTROL-MISSING': 'error',
  'ACH-BATCH-CONTROL-MISSING': 'error',
  'ACH-AFTER-FILE-CONTROL': 'error',
  'ACH-FIELD-NUMERIC': 'error',
  'ACH-CONSTANT-FIELD': 'error',
  'ACH-DESTINATION': 'error',
  'ACH-DESTINATION-FORM': 'warning',
  'ACH-ORIGIN': 'error',
  'ACH-DATE': 'error',
  'ACH-TIME': 'warning',
  'ACH-FILE-ID-MODIFIER': 'error',
  'ACH-SERVICE-CLASS': 'error',
  'ACH-SERVICE-CLASS-MISMATCH': 'error',
  'ACH-SERVICE-CLASS-ENTRY': 'error',
  'ACH-SEC-CODE': 'error',
  'ACH-SEC-NOT-CHECKED': 'info',
  'ACH-SEC-DIRECTION': 'error',
  'ACH-COMPANY-NAME': 'error',
  'ACH-COMPANY-ID': 'error',
  'ACH-COMPANY-ID-MISMATCH': 'error',
  'ACH-ENTRY-DESCRIPTION': 'error',
  'ACH-EFFECTIVE-DATE': 'error',
  'ACH-EFFECTIVE-DATE-PAST': 'warning',
  'ACH-EFFECTIVE-DATE-FAR': 'warning',
  'ACH-EFFECTIVE-DATE-WEEKEND': 'info',
  'ACH-ORIGINATOR-STATUS': 'error',
  'ACH-ODFI-MISMATCH': 'error',
  'ACH-BATCH-NUMBER-MISMATCH': 'error',
  'ACH-BATCH-NUMBER-ORDER': 'warning',
  'ACH-BATCH-NUMBER-DUPLICATE': 'error',
  'ACH-IAT-FIELD': 'error',
  'ACH-EMPTY-BATCH': 'warning',
  'ACH-TRANSACTION-CODE': 'error',
  'ACH-RDFI-CHECK-DIGIT': 'error',
  'ACH-ACCOUNT': 'error',
  'ACH-AMOUNT': 'error',
  'ACH-AMOUNT-PRENOTE': 'error',
  'ACH-AMOUNT-ZERO': 'warning',
  'ACH-NAME': 'warning',
  'ACH-WEB-PAYMENT-TYPE': 'warning',
  'ACH-ADDENDA-INDICATOR': 'error',
  'ACH-ADDENDA-TYPE': 'error',
  'ACH-ADDENDA-COUNT': 'error',
  'ACH-ADDENDA-SEQUENCE': 'error',
  'ACH-IAT-ADDENDA-ORDER': 'error',
  'ACH-TRACE-ODFI': 'warning',
  'ACH-TRACE-ORDER': 'warning',
  'ACH-TRACE-DUPLICATE': 'error',
  'ACH-BATCH-COUNT': 'error',
  'ACH-BATCH-HASH': 'error',
  'ACH-BATCH-DEBITS': 'error',
  'ACH-BATCH-CREDITS': 'error',
  'ACH-FILE-BATCH-COUNT': 'error',
  'ACH-FILE-BLOCK-COUNT': 'error',
  'ACH-FILE-ENTRY-COUNT': 'error',
  'ACH-FILE-HASH': 'error',
  'ACH-FILE-DEBITS': 'error',
  'ACH-FILE-CREDITS': 'error',
  'ACH-RESERVED': 'warning',
  'ACH-BLOCKING': 'warning',
  'ACH-TOO-MANY-PROBLEMS': 'info'
});

const DIGITS = /^[0-9]+$/;
const isBlank = function (s) { return s.trim() === ''; };
const money = V.formatCents;

/**
 * Checks a parsed file (see parse.parseAch). Options: maxProblems (default 1000), checks:
 * { effectiveDate: true, blocking: true }. Returns { problems, counts: { error, warning, info },
 * dropped, totals } where totals is totals.fileTotals() of the file.
 */
function validate(parsed, options) {
  const r = parsed.records;
  const s = parsed.structure;
  const o = options || {};
  const max = Math.max(1, Math.floor(Number(o.maxProblems) || 1000));
  const checks = Object.assign({ effectiveDate: true, blocking: true }, o.checks || {});
  const problems = [];
  const counts = { error: 0, warning: 0, info: 0 };
  let dropped = 0;

  function addAt(code, start, end, message, record) {
    const severity = CODES[code];
    counts[severity]++;
    if (problems.length >= max) { dropped++; return; }
    problems.push({ code: code, severity: severity, start: start, end: Math.max(end, start), message: message, record: record === undefined ? -1 : record });
  }
  function add(code, rec, col, len, message) {
    if (rec < 0 || rec >= r.count) { addAt(code, 0, Math.min(1, r.text.length), message, -1); return; }
    const base = r.starts[rec];
    const rl = r.lengths[rec];
    let a = Math.min(col - 1, rl);
    let b = Math.min(col - 1 + len, rl);
    if (b <= a) { a = Math.max(0, rl - 1); b = rl; }
    addAt(code, base + a, base + b, message, rec);
  }
  function f(rec, start, len) { return P.fieldOf(r, rec, start, len); }
  function digits(rec, start, len, what) {
    const v = f(rec, start, len);
    if (!DIGITS.test(v)) { add('ACH-FIELD-NUMERIC', rec, start, len, what + ' must be ' + len + ' digit' + (len === 1 ? '' : 's') + '; found "' + v + '".'); return null; }
    return v;
  }

  const totals = T.fileTotals(parsed);

  if (r.count === 0) {
    addAt('ACH-EMPTY-FILE', 0, 0, 'The file contains no records.');
    return finish();
  }
  if (r.bom) addAt('ACH-BOM', 0, 1, 'The file starts with a byte order mark. Bank systems usually expect plain ASCII text without it.');
  if (r.unwrapped) add('ACH-UNWRAPPED', 0, 1, 94, 'The file has no line breaks; it is read as consecutive records of 94 characters.');
  for (const off of r.blankLines) addAt('ACH-BLANK-LINE', off, off, 'Empty line between records. ACH files contain no empty lines.');

  // ---- every record: characters, length, record type --------------------------------------------
  const text = r.text;
  for (let i = 0; i < r.count; i++) {
    const start = r.starts[i];
    const len = r.lengths[i];
    for (let k = 0; k < len; k++) {
      const c = text.charCodeAt(start + k);
      if (c < 32 || c > 126) {
        addAt('ACH-CHARACTERS', start + k, start + k + 1, 'Character ' + charName(c) + ' at position ' + (k + 1) + '. ACH records hold only printable ASCII characters (space to tilde).', i);
        break;
      }
    }
    if (len !== P.RECORD_LENGTH) {
      if (len < P.RECORD_LENGTH) add('ACH-RECORD-LENGTH', i, 1, len, 'The record has ' + len + ' characters; every record has 94. If the record ended in spaces, they may have been removed when the file was edited or copied.');
      else add('ACH-RECORD-LENGTH', i, 95, len - 94, 'The record has ' + len + ' characters; every record has 94.');
    }
    const t = P.typeOf(r, i);
    if ([P.T1, P.T5, P.T6, P.T7, P.T8, P.T9].indexOf(t) === -1) add('ACH-RECORD-TYPE', i, 1, 1, 'Unknown record type code "' + text.charAt(start) + '". Records start with 1, 5, 6, 7, 8 or 9.');
  }

  // ---- structure -----------------------------------------------------------------------------------
  if (s.header === -1) add('ACH-FILE-HEADER-MISSING', 0, 1, 1, 'The file does not start with a file header record (record type 1).');
  for (const m of s.misplaced) {
    switch (m.reason) {
      case 'header-late': add('ACH-RECORD-ORDER', m.record, 1, 1, 'The file header must be the first record of the file.'); break;
      case 'batch-without-control': add('ACH-BATCH-CONTROL-MISSING', m.record, 1, 1, 'This batch has no batch control record (type 8) before the next batch or the file control.'); break;
      case 'entry-outside-batch': add('ACH-RECORD-ORDER', m.record, 1, 1, 'Entry detail record outside a batch: entries belong between a batch header (5) and its batch control (8).'); break;
      case 'addenda-outside-batch': add('ACH-RECORD-ORDER', m.record, 1, 1, 'Addenda record outside a batch: addenda follow an entry detail record.'); break;
      case 'control-without-batch': add('ACH-RECORD-ORDER', m.record, 1, 1, 'Batch control record without a batch header before it.'); break;
      case 'filler-before-control': add('ACH-RECORD-ORDER', m.record, 1, 94, 'Filler record (all nines) before the file control record. Filler belongs after the file control.'); break;
      default: add('ACH-RECORD-ORDER', m.record, 1, 1, 'Record out of order.');
    }
  }
  for (const i of s.extraHeaders) add('ACH-RECORD-ORDER', i, 1, 1, 'A second file header. One ACH file has exactly one file header; split concatenated files first.');
  if (s.fileControl === -1) add('ACH-FILE-CONTROL-MISSING', r.count - 1, 1, 1, 'The file has no file control record (type 9 after the last batch).');
  for (const i of s.afterControl) add('ACH-AFTER-FILE-CONTROL', i, 1, 1, 'Only filler records of 94 nines may follow the file control record.');

  // ---- file header ---------------------------------------------------------------------------------
  let created = null;
  if (s.header !== -1) {
    const h = s.header;
    if (f(h, 2, 2) !== '01') add('ACH-CONSTANT-FIELD', h, 2, 2, 'The priority code is always 01; found "' + f(h, 2, 2) + '".');
    const dest = f(h, 4, 10);
    if (isBlank(dest)) add('ACH-DESTINATION', h, 4, 10, 'The immediate destination is blank.');
    else if (/^ [0-9]{9}$/.test(dest)) {
      if (!V.validRouting(dest.slice(1))) add('ACH-DESTINATION', h, 4, 10, 'The immediate destination ' + dest.slice(1) + ' is not a valid routing number: its check digit should be ' + V.checkDigit(dest.slice(1, 9)) + '.');
    } else add('ACH-DESTINATION-FORM', h, 4, 10, 'The immediate destination is usually a space followed by the nine-digit routing number of the receiving bank; found "' + dest + '". Check what your bank expects.');
    if (isBlank(f(h, 14, 10))) add('ACH-ORIGIN', h, 14, 10, 'The immediate origin is blank.');
    created = V.parseYYMMDD(f(h, 24, 6));
    if (!created) add('ACH-DATE', h, 24, 6, 'The file creation date "' + f(h, 24, 6) + '" is not a valid date (YYMMDD).');
    const time = f(h, 30, 4);
    if (!isBlank(time) && !V.parseHHMM(time)) add('ACH-TIME', h, 30, 4, 'The file creation time "' + time + '" is not a valid time (HHMM).');
    if (!/^[A-Z0-9]$/.test(f(h, 34, 1))) add('ACH-FILE-ID-MODIFIER', h, 34, 1, 'The file ID modifier must be an upper-case letter A to Z or a digit 0 to 9; found "' + f(h, 34, 1) + '".');
    if (f(h, 35, 3) !== '094') add('ACH-CONSTANT-FIELD', h, 35, 3, 'The record size is always 094; found "' + f(h, 35, 3) + '".');
    if (f(h, 38, 2) !== '10') add('ACH-CONSTANT-FIELD', h, 38, 2, 'The blocking factor is always 10; found "' + f(h, 38, 2) + '".');
    if (f(h, 40, 1) !== '1') add('ACH-CONSTANT-FIELD', h, 40, 1, 'The format code is always 1; found "' + f(h, 40, 1) + '".');
  }

  // ---- batches -------------------------------------------------------------------------------------
  const traces = new Set();
  const batchNumbers = new Set();
  let prevBatchNumber = -1;
  let unchecked = 0;
  totals.batches.forEach(function (bt) {
    const b = bt.batch;
    const t = bt.totals;
    const h = b.header;
    const sec = f(h, 51, 3);
    const svc = f(h, 2, 3);
    const iat = sec === 'IAT';
    let checked = true;
    if (!C.SERVICE_CLASSES[svc]) add('ACH-SERVICE-CLASS', h, 2, 3, 'Unknown service class code "' + svc + '". Use 200 (mixed), 220 (credits only) or 225 (debits only).');
    if (!C.SEC_CODES[sec]) add('ACH-SEC-CODE', h, 51, 3, 'Unknown Standard Entry Class code "' + sec + '".');
    else if (sec === 'ADV' || svc === '280') {
      checked = false;
      unchecked++;
      add('ACH-SEC-NOT-CHECKED', h, 51, 3, 'Automated accounting advice batches use their own entry layout; this batch is listed but its entries and totals are not checked.');
    } else if (C.CHECKED_SEC.indexOf(sec) === -1) add('ACH-SEC-NOT-CHECKED', h, 51, 3, 'SEC code ' + sec + ' (' + C.SEC_CODES[sec] + '): the batch is read, counted and totalled, but the fields specific to this code are not checked.');
    if (iat) {
      if (['FV', 'VF', 'FF'].indexOf(f(h, 21, 2)) === -1) add('ACH-IAT-FIELD', h, 21, 2, 'The foreign exchange indicator must be FV, VF or FF; found "' + f(h, 21, 2) + '".');
      if (!/^[A-Z]{2}$/.test(f(h, 39, 2))) add('ACH-IAT-FIELD', h, 39, 2, 'The destination country code must be two upper-case letters; found "' + f(h, 39, 2) + '".');
      if (!/^[A-Z]{3}$/.test(f(h, 64, 3))) add('ACH-IAT-FIELD', h, 64, 3, 'The originating currency code must be three upper-case letters; found "' + f(h, 64, 3) + '".');
      if (!/^[A-Z]{3}$/.test(f(h, 67, 3))) add('ACH-IAT-FIELD', h, 67, 3, 'The destination currency code must be three upper-case letters; found "' + f(h, 67, 3) + '".');
      if (isBlank(f(h, 41, 10))) add('ACH-COMPANY-ID', h, 41, 10, 'The originator identification is blank.');
    } else {
      if (isBlank(f(h, 5, 16))) add('ACH-COMPANY-NAME', h, 5, 16, 'The company name is blank. Receivers see this name on their statements.');
      if (isBlank(f(h, 41, 10))) add('ACH-COMPANY-ID', h, 41, 10, 'The company identification is blank.');
    }
    if (isBlank(f(h, 54, 10))) add('ACH-ENTRY-DESCRIPTION', h, 54, 10, 'The company entry description is blank. It tells receivers what the entries are for, for example PAYROLL.');
    const eff = V.parseYYMMDD(f(h, 70, 6));
    if (!eff) add('ACH-EFFECTIVE-DATE', h, 70, 6, 'The effective entry date "' + f(h, 70, 6) + '" is not a valid date (YYMMDD).');
    else if (checks.effectiveDate) {
      if (created && eff.day < created.day) add('ACH-EFFECTIVE-DATE-PAST', h, 70, 6, 'The effective entry date ' + eff.iso + ' is earlier than the file creation date ' + created.iso + '.');
      else if (created && eff.day - created.day > 60) add('ACH-EFFECTIVE-DATE-FAR', h, 70, 6, 'The effective entry date ' + eff.iso + ' is ' + (eff.day - created.day) + ' days after the file creation date. Check that the date is intended.');
      if (eff.weekday === 0 || eff.weekday === 6) add('ACH-EFFECTIVE-DATE-WEEKEND', h, 70, 6, 'The effective entry date ' + eff.iso + ' is a ' + V.WEEKDAYS[eff.weekday] + '. Entries settle on business days, so check the date with your bank.');
    }
    if (['0', '1', '2'].indexOf(f(h, 79, 1)) === -1) add('ACH-ORIGINATOR-STATUS', h, 79, 1, 'The originator status code must be 0, 1 or 2; found "' + f(h, 79, 1) + '".');
    const odfi = digits(h, 80, 8, 'The originating DFI identification');
    const number = digits(h, 88, 7, 'The batch number');
    if (number !== null) {
      if (batchNumbers.has(number)) add('ACH-BATCH-NUMBER-DUPLICATE', h, 88, 7, 'Batch number ' + number + ' is used by an earlier batch of this file.');
      else if (Number(number) <= prevBatchNumber) add('ACH-BATCH-NUMBER-ORDER', h, 88, 7, 'Batch numbers should ascend through the file; ' + number + ' follows ' + String(prevBatchNumber).padStart(7, '0') + '.');
      batchNumbers.add(number);
      prevBatchNumber = Math.max(prevBatchNumber, Number(number));
    }
    if (t.entries === 0) add('ACH-EMPTY-BATCH', h, 1, 1, 'This batch contains no entry detail records.');

    if (checked) checkEntries(b, sec, svc, odfi);

    // Batch control against header and entries.
    const c = b.control;
    if (c === -1) return;
    const csvc = f(c, 2, 3);
    if (csvc !== svc) add('ACH-SERVICE-CLASS-MISMATCH', c, 2, 3, 'The batch control says service class ' + csvc + ', the batch header ' + svc + '.');
    if (f(c, 45, 10) !== f(h, 41, 10)) add('ACH-COMPANY-ID-MISMATCH', c, 45, 10, 'The company identification "' + f(c, 45, 10) + '" differs from the batch header ("' + f(h, 41, 10) + '").');
    if (f(c, 80, 8) !== f(h, 80, 8)) add('ACH-ODFI-MISMATCH', c, 80, 8, 'The originating DFI identification ' + f(c, 80, 8) + ' differs from the batch header (' + f(h, 80, 8) + ').');
    if (f(c, 88, 7) !== f(h, 88, 7)) add('ACH-BATCH-NUMBER-MISMATCH', c, 88, 7, 'The batch number ' + f(c, 88, 7) + ' differs from the batch header (' + f(h, 88, 7) + ').');
    if (!isBlank(f(c, 74, 6))) add('ACH-RESERVED', c, 74, 6, 'Positions 74 to 79 of the batch control are reserved and should be blank.');
    if (!checked) return;
    const count = digits(c, 5, 6, 'The entry/addenda count');
    if (count !== null && Number(count) !== t.entries + t.addenda) add('ACH-BATCH-COUNT', c, 5, 6, 'The batch control counts ' + Number(count) + ' entry and addenda records; the batch has ' + (t.entries + t.addenda) + ' (' + t.entries + ' entries, ' + t.addenda + ' addenda).');
    const hash = digits(c, 11, 10, 'The entry hash');
    if (hash !== null && t.badRouting === 0 && hash !== V.hashField(t.hash)) add('ACH-BATCH-HASH', c, 11, 10, 'The entry hash is ' + hash + '; the receiving bank identifications of the entries add up to ' + V.hashField(t.hash) + ' (rightmost ten digits).');
    const debit = digits(c, 21, 12, 'The total debit amount');
    if (debit !== null && t.badAmounts === 0 && t.unknownCodes === 0 && BigInt(debit) !== t.debit) add('ACH-BATCH-DEBITS', c, 21, 12, 'The batch control says ' + money(BigInt(debit)) + ' in debits; the debit entries add up to ' + money(t.debit) + '.');
    const credit = digits(c, 33, 12, 'The total credit amount');
    if (credit !== null && t.badAmounts === 0 && t.unknownCodes === 0 && BigInt(credit) !== t.credit) add('ACH-BATCH-CREDITS', c, 33, 12, 'The batch control says ' + money(BigInt(credit)) + ' in credits; the credit entries add up to ' + money(t.credit) + '.');
  });

  function checkEntries(b, sec, svc, odfi) {
    const rules = C.ADDENDA_RULES[sec];
    let prevTrace = '';
    for (let i = b.first; i < b.end; i++) {
      const t = P.typeOf(r, i);
      if (t === P.T7) { add('ACH-RECORD-ORDER', i, 1, 1, 'Addenda record without an entry detail record before it.'); continue; }
      if (t !== P.T6) continue;
      const addenda = [];
      let j = i + 1;
      while (j < b.end && P.typeOf(r, j) === P.T7) { addenda.push(j); j++; }
      prevTrace = checkEntry(i, addenda, sec, svc, odfi, rules, prevTrace);
      i = j - 1;
    }
  }

  function checkEntry(i, addenda, sec, svc, odfi, rules, prevTrace) {
    const iat = sec === 'IAT';
    const tx = C.transactionCode(f(i, 2, 2));
    if (!tx.valid) add('ACH-TRANSACTION-CODE', i, 2, 2, 'Unknown transaction code "' + f(i, 2, 2) + '".');
    else {
      if (svc === '220' && tx.direction === 'debit') add('ACH-SERVICE-CLASS-ENTRY', i, 2, 2, 'Debit entry (' + tx.code + ') in a batch with service class 220 (credits only).');
      if (svc === '225' && tx.direction === 'credit') add('ACH-SERVICE-CLASS-ENTRY', i, 2, 2, 'Credit entry (' + tx.code + ') in a batch with service class 225 (debits only).');
      if (sec === 'TEL' && tx.direction === 'credit') add('ACH-SEC-DIRECTION', i, 2, 2, 'TEL entries are debits; this entry is a credit (' + tx.code + ').');
    }
    const rdfi = f(i, 4, 8);
    const cd = f(i, 12, 1);
    if (!/^[0-9]{8}$/.test(rdfi)) add('ACH-FIELD-NUMERIC', i, 4, 8, 'The receiving DFI identification must be eight digits; found "' + rdfi + '".');
    else if (!/^[0-9]$/.test(cd) || V.checkDigit(rdfi) !== Number(cd)) add('ACH-RDFI-CHECK-DIGIT', i, 12, 1, 'Check digit "' + cd + '" does not fit the routing number: for ' + rdfi + ' the check digit is ' + V.checkDigit(rdfi) + '.');
    if (iat) {
      if (isBlank(f(i, 40, 35))) add('ACH-ACCOUNT', i, 40, 35, 'The receiver\'s account number is blank.');
    } else if (isBlank(f(i, 13, 17))) add('ACH-ACCOUNT', i, 13, 17, 'The account number is blank.');
    const amount = V.cents(f(i, 30, 10));
    if (amount === null) add('ACH-AMOUNT', i, 30, 10, 'The amount must be ten digits (cents, no decimal point); found "' + f(i, 30, 10) + '".');
    else if (tx.valid) {
      if ((tx.kind === 'prenote' || tx.kind === 'zero') && amount !== 0n) add('ACH-AMOUNT-PRENOTE', i, 30, 10, 'Transaction code ' + tx.code + ' (' + (tx.kind === 'prenote' ? 'prenotification' : 'zero-dollar entry') + ') carries an amount of ' + money(amount) + '; it must be zero.');
      if (tx.kind === 'live' && amount === 0n) {
        const prenote = C.transactionCode(tx.code[0] + (tx.direction === 'credit' ? '3' : '8'));
        add('ACH-AMOUNT-ZERO', i, 30, 10, 'Live entry with an amount of zero.' + (prenote.valid ? ' Use the prenotification code ' + prenote.code + ' for a test entry without money.' : ''));
      }
    }
    if (!iat) {
      if (sec === 'CTX') { if (isBlank(f(i, 59, 16))) add('ACH-NAME', i, 59, 16, 'The receiving company name or ID number is blank.'); }
      else if (isBlank(f(i, 55, 22))) add('ACH-NAME', i, 55, 22, 'The receiver name is blank.');
      if (sec === 'WEB' && tx.valid && tx.direction === 'debit' && tx.kind === 'live' && ['R', 'S'].indexOf(f(i, 77, 2).trim()) === -1) add('ACH-WEB-PAYMENT-TYPE', i, 77, 2, 'WEB debits carry a payment type code: R for a recurring payment, S for a single payment; found "' + f(i, 77, 2) + '".');
    }
    const ind = f(i, 79, 1);
    if (ind !== '0' && ind !== '1') add('ACH-ADDENDA-INDICATOR', i, 79, 1, 'The addenda record indicator must be 0 or 1; found "' + ind + '".');
    else if (ind === '1' && !addenda.length) add('ACH-ADDENDA-INDICATOR', i, 79, 1, 'The addenda record indicator is 1, but no addenda record follows this entry.');
    else if (ind === '0' && addenda.length) add('ACH-ADDENDA-INDICATOR', i, 79, 1, 'The addenda record indicator is 0, but ' + addenda.length + ' addenda record' + (addenda.length === 1 ? ' follows' : 's follow') + ' this entry.');
    if (iat && ind === '0') add('ACH-ADDENDA-INDICATOR', i, 79, 1, 'International (IAT) entries always carry addenda records, so the indicator must be 1.');

    const trace = f(i, 80, 15);
    const traceOk = /^[0-9]{15}$/.test(trace);
    if (!traceOk) add('ACH-FIELD-NUMERIC', i, 80, 15, 'The trace number must be fifteen digits; found "' + trace + '".');

    // Addenda of this entry.
    let returnLike = 0;
    let regular = 0;
    const types = [];
    for (const a of addenda) {
      const type = f(a, 2, 2);
      types.push(type);
      if (!/^[0-9]{2}$/.test(type)) { add('ACH-ADDENDA-TYPE', a, 2, 2, 'The addenda type code must be two digits; found "' + type + '".'); continue; }
      if (type === '98' || type === '99') { returnLike++; continue; }
      regular++;
      if (rules && rules.types.indexOf(type) === -1) add('ACH-ADDENDA-TYPE', a, 2, 2, 'Addenda type ' + type + ' is not used with ' + sec + ' entries' + (rules.types.length ? ' (expected ' + rules.types.join(', ') + ').' : ' (they carry no addenda besides returns and change notices).'));
      if (type === '05') {
        const seq = f(a, 84, 4);
        if (seq !== String(regular).padStart(4, '0')) add('ACH-ADDENDA-SEQUENCE', a, 84, 4, 'The addenda sequence number is "' + seq + '"; for addenda ' + regular + ' of this entry it is ' + String(regular).padStart(4, '0') + '.');
      }
      if ((type === '05' || /^1[0-8]$/.test(type)) && traceOk && f(a, 88, 7) !== trace.slice(8)) add('ACH-ADDENDA-SEQUENCE', a, 88, 7, 'The entry detail sequence number is "' + f(a, 88, 7) + '"; it should repeat the last seven digits of the entry\'s trace number (' + trace.slice(8) + ').');
    }
    if (rules && regular > rules.max) add('ACH-ADDENDA-COUNT', i, 79, 1, rules.max === 0
      ? sec + ' entries carry no addenda records besides returns and change notices; this one has ' + regular + '.'
      : sec + ' entries carry at most ' + rules.max + ' addenda record' + (rules.max === 1 ? '' : 's') + ' of their own; this one has ' + regular + '.');
    if (returnLike > 1) add('ACH-ADDENDA-COUNT', i, 79, 1, 'An entry carries at most one return or change addenda (types 98 and 99); this one has ' + returnLike + '.');
    if (sec === 'CTX') {
      const n = f(i, 55, 4);
      if (!DIGITS.test(n)) add('ACH-FIELD-NUMERIC', i, 55, 4, 'The number of addenda records must be four digits; found "' + n + '".');
      else if (Number(n) !== addenda.length) add('ACH-ADDENDA-COUNT', i, 55, 4, 'The entry says ' + Number(n) + ' addenda records; ' + addenda.length + ' follow.');
    }
    if (iat) {
      const n = f(i, 13, 4);
      if (!DIGITS.test(n)) add('ACH-FIELD-NUMERIC', i, 13, 4, 'The number of addenda records must be four digits; found "' + n + '".');
      else if (Number(n) !== addenda.length) add('ACH-ADDENDA-COUNT', i, 13, 4, 'The entry says ' + Number(n) + ' addenda records; ' + addenda.length + ' follow.');
      if (!returnLike) {
        const want = ['10', '11', '12', '13', '14', '15', '16'];
        let ok = types.length >= 7 && want.every(function (w, k) { return types[k] === w; });
        const rest = types.slice(7);
        if (ok) ok = rest.every(function (x) { return x === '17' || x === '18'; }) && rest.join(',') === rest.slice().sort().join(',');
        if (!ok) add('ACH-IAT-ADDENDA-ORDER', i, 1, 1, 'International entries carry the addenda types 10, 11, 12, 13, 14, 15 and 16 in this order, then optional 17 and 18 records; found ' + (types.length ? types.join(', ') : 'none') + '.');
      }
    }

    if (traceOk) {
      if (traces.has(trace)) add('ACH-TRACE-DUPLICATE', i, 80, 15, 'Trace number ' + trace + ' is used by an earlier entry of this file. Trace numbers are unique within a file.');
      traces.add(trace);
      if (!returnLike) {
        if (odfi !== null && trace.slice(0, 8) !== odfi) add('ACH-TRACE-ODFI', i, 80, 8, 'The trace number starts with ' + trace.slice(0, 8) + '; entries of this batch usually start with the originating DFI identification ' + odfi + '.');
        if (prevTrace && trace <= prevTrace) add('ACH-TRACE-ORDER', i, 80, 15, 'Trace numbers should ascend within a batch; ' + trace + ' follows ' + prevTrace + '.');
        return trace;
      }
    }
    return prevTrace;
  }

  // ---- file control --------------------------------------------------------------------------------
  if (s.fileControl !== -1) {
    const c = s.fileControl;
    const bc = digits(c, 2, 6, 'The batch count');
    if (bc !== null && Number(bc) !== s.batches.length) add('ACH-FILE-BATCH-COUNT', c, 2, 6, 'The file control counts ' + Number(bc) + ' batches; the file has ' + s.batches.length + '.');
    const blocks = digits(c, 8, 6, 'The block count');
    if (blocks !== null && Number(blocks) !== totals.blocks) add('ACH-FILE-BLOCK-COUNT', c, 8, 6, 'The file control counts ' + Number(blocks) + ' blocks; ' + totals.recordsToControl + ' records up to the file control make ' + totals.blocks + ' block' + (totals.blocks === 1 ? '' : 's') + ' of ten.');
    if (!isBlank(f(c, 56, 39))) add('ACH-RESERVED', c, 56, 39, 'Positions 56 to 94 of the file control are reserved and should be blank.');
    if (!unchecked) {
      const ec = digits(c, 14, 8, 'The entry/addenda count');
      if (ec !== null && Number(ec) !== totals.entries + totals.addenda) add('ACH-FILE-ENTRY-COUNT', c, 14, 8, 'The file control counts ' + Number(ec) + ' entry and addenda records; the file has ' + (totals.entries + totals.addenda) + '.');
      const allRouting = totals.batches.every(function (x) { return x.totals.badRouting === 0; });
      const allAmounts = totals.batches.every(function (x) { return x.totals.badAmounts === 0 && x.totals.unknownCodes === 0; });
      const hash = digits(c, 22, 10, 'The entry hash');
      if (hash !== null && allRouting && hash !== V.hashField(totals.hash)) add('ACH-FILE-HASH', c, 22, 10, 'The file entry hash is ' + hash + '; the receiving bank identifications of all entries add up to ' + V.hashField(totals.hash) + ' (rightmost ten digits).');
      const debit = digits(c, 32, 12, 'The total debit amount');
      if (debit !== null && allAmounts && BigInt(debit) !== totals.debit) add('ACH-FILE-DEBITS', c, 32, 12, 'The file control says ' + money(BigInt(debit)) + ' in debits; the debit entries of the file add up to ' + money(totals.debit) + '.');
      const credit = digits(c, 44, 12, 'The total credit amount');
      if (credit !== null && allAmounts && BigInt(credit) !== totals.credit) add('ACH-FILE-CREDITS', c, 44, 12, 'The file control says ' + money(BigInt(credit)) + ' in credits; the credit entries of the file add up to ' + money(totals.credit) + '.');
    }
    if (checks.blocking && !s.afterControl.length) {
      const all = c + 1 + s.fillerCount;
      if (all % 10 !== 0) add('ACH-BLOCKING', c, 1, 1, 'The file has ' + all + ' records. Files are filled with records of 94 nines to a multiple of ten records; ' + (10 - (all % 10)) % 10 + ' more filler record' + ((10 - (all % 10)) % 10 === 1 ? ' is' : 's are') + ' needed.');
      else if (s.fillerCount >= 10) add('ACH-BLOCKING', s.fillerStart, 1, 94, 'The file has ' + s.fillerCount + ' filler records; at most nine are needed to reach a multiple of ten.');
    }
  }

  return finish();

  function finish() {
    if (dropped) problems.push({ code: 'ACH-TOO-MANY-PROBLEMS', severity: 'info', start: 0, end: Math.min(1, r.text.length), message: 'Only the first ' + max + ' problems are listed; ' + dropped + ' more were found.', record: 0 });
    return { problems: problems, counts: counts, dropped: dropped, totals: totals };
  }
}

function charName(c) {
  if (c === 9) return 'TAB';
  if (c === 0) return 'NUL';
  if (c < 32 || c === 127) return 'control U+' + c.toString(16).toUpperCase().padStart(4, '0');
  return '"' + String.fromCharCode(c) + '" (U+' + c.toString(16).toUpperCase().padStart(4, '0') + ')';
}

module.exports = { validate: validate, CODES: CODES };
