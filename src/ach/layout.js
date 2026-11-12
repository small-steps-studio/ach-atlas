'use strict';
// Record layouts of the ACH file format: for every record type the fields with their position
// (1-based, inclusive), length and kind. Positions and lengths are facts of the published file
// layout; the field notes are short explanations written for this extension.
//
// Kinds: type (record type code), digits, amount (digits, two implied decimals), date (YYMMDD),
// time (HHMM), routing8 (8-digit bank identification), check (check digit), routing10 (immediate
// destination or origin), txcode, sec, service, trace, text, reserved (should be blank),
// constant, indicator, addendaType, returnCode, changeCode, status, julian, count, hash, filler.

function F(name, start, length, kind, note) {
  return Object.freeze({ name: name, start: start, end: start + length - 1, length: length, kind: kind, note: note || '' });
}

function layout(name, fields) {
  return Object.freeze({ name: name, fields: Object.freeze(fields) });
}

const FILE_HEADER = layout('File header', [
  F('Record type code', 1, 1, 'type', 'Always 1 for the file header.'),
  F('Priority code', 2, 2, 'constant', 'Always 01.'),
  F('Immediate destination', 4, 10, 'routing10', 'The bank or processor that receives the file: usually a space followed by its nine-digit routing number.'),
  F('Immediate origin', 14, 10, 'text', 'Identifies the sender of the file: a routing number or a company identification, as agreed with the bank.'),
  F('File creation date', 24, 6, 'date', 'Date the file was created, YYMMDD.'),
  F('File creation time', 30, 4, 'time', 'Time the file was created, HHMM (optional).'),
  F('File ID modifier', 34, 1, 'text', 'A to Z or 0 to 9; tells apart files created on the same day for the same destination.'),
  F('Record size', 35, 3, 'constant', 'Always 094.'),
  F('Blocking factor', 38, 2, 'constant', 'Always 10: records are counted in blocks of ten.'),
  F('Format code', 40, 1, 'constant', 'Always 1.'),
  F('Immediate destination name', 41, 23, 'text', 'Name of the receiving bank or processor.'),
  F('Immediate origin name', 64, 23, 'text', 'Name of the sender.'),
  F('Reference code', 87, 8, 'text', 'Optional, for the sender\'s own use.')
]);

const BATCH_HEADER = layout('Batch header', [
  F('Record type code', 1, 1, 'type', 'Always 5 for a batch header.'),
  F('Service class code', 2, 3, 'service', '200 mixed, 220 credits only, 225 debits only.'),
  F('Company name', 5, 16, 'text', 'Name of the originator as the receivers know it.'),
  F('Company discretionary data', 21, 20, 'text', 'Optional, for the originator\'s own use.'),
  F('Company identification', 41, 10, 'text', 'Identifies the originator to the bank; often 1 followed by the tax number.'),
  F('Standard Entry Class code', 51, 3, 'sec', 'The kind of payment in this batch.'),
  F('Company entry description', 54, 10, 'text', 'Purpose of the entries as shown to receivers, for example PAYROLL.'),
  F('Company descriptive date', 64, 6, 'text', 'Optional date text shown to receivers.'),
  F('Effective entry date', 70, 6, 'date', 'Date on which the originator wants the entries to settle, YYMMDD.'),
  F('Settlement date', 76, 3, 'julian', 'Filled in by the ACH operator (day of the year); blank in files sent to a bank.'),
  F('Originator status code', 79, 1, 'status', 'Usually 1.'),
  F('Originating DFI identification', 80, 8, 'routing8', 'First eight digits of the routing number of the originating bank (ODFI).'),
  F('Batch number', 88, 7, 'digits', 'Numbers the batches of the file in ascending order.')
]);

const IAT_BATCH_HEADER = layout('Batch header (IAT)', [
  F('Record type code', 1, 1, 'type', 'Always 5 for a batch header.'),
  F('Service class code', 2, 3, 'service', '200 mixed, 220 credits only, 225 debits only.'),
  F('IAT indicator', 5, 16, 'text', 'Blank in most files.'),
  F('Foreign exchange indicator', 21, 2, 'text', 'FV (fixed to variable), VF (variable to fixed) or FF (fixed to fixed).'),
  F('Foreign exchange reference indicator', 23, 1, 'text', 'Says what the foreign exchange reference holds.'),
  F('Foreign exchange reference', 24, 15, 'text', 'Exchange rate or reference number, or blank.'),
  F('ISO destination country code', 39, 2, 'text', 'Two-letter country code of the receiver\'s country.'),
  F('Originator identification', 41, 10, 'text', 'Identifies the originator to the bank.'),
  F('Standard Entry Class code', 51, 3, 'sec', 'IAT.'),
  F('Company entry description', 54, 10, 'text', 'Purpose of the entries.'),
  F('ISO originating currency code', 64, 3, 'text', 'Three-letter currency code of the origin.'),
  F('ISO destination currency code', 67, 3, 'text', 'Three-letter currency code of the destination.'),
  F('Effective entry date', 70, 6, 'date', 'Requested settlement date, YYMMDD.'),
  F('Settlement date', 76, 3, 'julian', 'Filled in by the ACH operator; blank in files sent to a bank.'),
  F('Originator status code', 79, 1, 'status', 'Usually 1.'),
  F('Gateway operator or ODFI identification', 80, 8, 'routing8', 'First eight digits of the routing number of the originating bank or gateway operator.'),
  F('Batch number', 88, 7, 'digits', 'Numbers the batches of the file in ascending order.')
]);

function entryFields(idName, idNote, nameName, nameNote, discName, discNote) {
  return [
    F('Record type code', 1, 1, 'type', 'Always 6 for an entry detail record.'),
    F('Transaction code', 2, 2, 'txcode', 'Account type and direction of the entry.'),
    F('Receiving DFI identification', 4, 8, 'routing8', 'First eight digits of the routing number of the receiver\'s bank (RDFI). Added up for the entry hash.'),
    F('Check digit', 12, 1, 'check', 'Ninth digit of the receiver\'s routing number.'),
    F('DFI account number', 13, 17, 'text', 'Receiver\'s account number, left-aligned.'),
    F('Amount', 30, 10, 'amount', 'Amount in cents: the last two digits are the cents.'),
    F(idName, 40, 15, 'text', idNote),
    F(nameName, 55, 22, 'text', nameNote),
    F(discName, 77, 2, 'text', discNote),
    F('Addenda record indicator', 79, 1, 'indicator', '1 when addenda records follow this entry, otherwise 0.'),
    F('Trace number', 80, 15, 'trace', 'Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file.')
  ];
}

const ENTRY_PPD = layout('Entry detail', entryFields(
  'Individual identification number', 'Optional reference for the receiver, for example an employee number.',
  'Individual name', 'Name of the receiver.',
  'Discretionary data', 'Optional, for the originating bank\'s use.'));

const ENTRY_CCD = layout('Entry detail (CCD)', entryFields(
  'Identification number', 'Optional reference, for example an invoice or customer number.',
  'Receiving company name', 'Name of the receiving business.',
  'Discretionary data', 'Optional, for the originating bank\'s use.'));

const ENTRY_WEB = layout('Entry detail (WEB)', entryFields(
  'Individual identification number', 'Optional reference for the receiver.',
  'Individual name', 'Name of the receiver.',
  'Payment type code', 'For debits: R for a recurring payment, S for a single payment.'));

const ENTRY_TEL = layout('Entry detail (TEL)', entryFields(
  'Individual identification number', 'Optional reference for the receiver.',
  'Individual name', 'Name of the receiver.',
  'Payment type code', 'R for a recurring payment, S for a single payment, or blank.'));

// CIE and MTE carry the name of the individual in the first reference field and the
// identification in the second one (the other way round from PPD).
const ENTRY_CIE = layout('Entry detail (CIE, MTE)', entryFields(
  'Individual name', 'Name of the individual who made the payment.',
  'Individual identification number', 'Identification of the individual, as agreed with the bank.',
  'Discretionary data', 'Optional, for the originating bank\'s use.'));

const ENTRY_SHR = layout('Entry detail (SHR)', entryFields(
  'Card expiration date and document reference', 'Card expiration date (MMYY) followed by the document reference number.',
  'Card account number', 'Number of the card account.',
  'Card transaction type code', 'Says what kind of card transaction the entry is.'));

const ENTRY_ACK = layout('Entry detail (ACK)', entryFields(
  'Original entry trace number', 'Trace number of the corporate credit that is acknowledged.',
  'Receiving company name', 'Name of the receiving business.',
  'Discretionary data', 'Optional, for the originating bank\'s use.'));

const ENTRY_OTHER = layout('Entry detail', entryFields(
  'Identification number', 'Reference whose meaning depends on the SEC code of the batch.',
  'Receiver name', 'Name of the receiver.',
  'Discretionary data', 'Optional, meaning depends on the SEC code of the batch.'));

const ENTRY_CTX = layout('Entry detail (CTX)', [
  F('Record type code', 1, 1, 'type', 'Always 6 for an entry detail record.'),
  F('Transaction code', 2, 2, 'txcode', 'Account type and direction of the entry.'),
  F('Receiving DFI identification', 4, 8, 'routing8', 'First eight digits of the routing number of the receiver\'s bank (RDFI). Added up for the entry hash.'),
  F('Check digit', 12, 1, 'check', 'Ninth digit of the receiver\'s routing number.'),
  F('DFI account number', 13, 17, 'text', 'Receiver\'s account number, left-aligned.'),
  F('Amount', 30, 10, 'amount', 'Amount in cents: the last two digits are the cents.'),
  F('Identification number', 40, 15, 'text', 'Optional reference, for example an invoice number.'),
  F('Number of addenda records', 55, 4, 'count', 'How many addenda records follow this entry.'),
  F('Receiving company name or ID number', 59, 16, 'text', 'Name or identification of the receiving business.'),
  F('Reserved', 75, 2, 'reserved', 'Blank.'),
  F('Discretionary data', 77, 2, 'text', 'Optional, for the originating bank\'s use.'),
  F('Addenda record indicator', 79, 1, 'indicator', '1 when addenda records follow this entry, otherwise 0.'),
  F('Trace number', 80, 15, 'trace', 'Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file.')
]);

function ctxFields(idName, idNote, reservedName, reservedKind, reservedNote) {
  return [
    F('Record type code', 1, 1, 'type', 'Always 6 for an entry detail record.'),
    F('Transaction code', 2, 2, 'txcode', 'Account type and direction of the entry.'),
    F('Receiving DFI identification', 4, 8, 'routing8', 'First eight digits of the routing number of the receiver\'s bank (RDFI). Added up for the entry hash.'),
    F('Check digit', 12, 1, 'check', 'Ninth digit of the receiver\'s routing number.'),
    F('DFI account number', 13, 17, 'text', 'Receiver\'s account number, left-aligned.'),
    F('Amount', 30, 10, 'amount', 'Amount in cents: the last two digits are the cents.'),
    F(idName, 40, 15, 'text', idNote),
    F('Number of addenda records', 55, 4, 'count', 'How many addenda records follow this entry.'),
    F('Receiving company name or ID number', 59, 16, 'text', 'Name or identification of the receiving business.'),
    F(reservedName, 75, 2, reservedKind, reservedNote),
    F('Discretionary data', 77, 2, 'text', 'Optional, for the originating bank\'s use.'),
    F('Addenda record indicator', 79, 1, 'indicator', '1 when addenda records follow this entry, otherwise 0.'),
    F('Trace number', 80, 15, 'trace', 'Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file.')
  ];
}

const ENTRY_TRX = layout('Entry detail (TRX)', ctxFields('Identification number', 'Optional reference, for example a check or item reference.', 'Item type indicator', 'text', 'Says what kind of item the entry belongs to.'));
const ENTRY_ATX = layout('Entry detail (ATX)', ctxFields('Original entry trace number', 'Trace number of the corporate trade exchange credit that is acknowledged.', 'Reserved', 'reserved', 'Blank.'));

const ENTRY_IAT = layout('Entry detail (IAT)', [
  F('Record type code', 1, 1, 'type', 'Always 6 for an entry detail record.'),
  F('Transaction code', 2, 2, 'txcode', 'Account type and direction of the entry.'),
  F('Gateway operator or RDFI identification', 4, 8, 'routing8', 'First eight digits of the routing number of the receiving bank or gateway operator. Added up for the entry hash.'),
  F('Check digit', 12, 1, 'check', 'Ninth digit of that routing number.'),
  F('Number of addenda records', 13, 4, 'count', 'How many addenda records follow this entry.'),
  F('Reserved', 17, 13, 'reserved', 'Blank.'),
  F('Amount', 30, 10, 'amount', 'Amount in cents: the last two digits are the cents.'),
  F('Foreign receiver\'s account number', 40, 35, 'text', 'Account number of the receiver, left-aligned.'),
  F('Reserved', 75, 2, 'reserved', 'Blank.'),
  F('Gateway operator screening indicator', 77, 1, 'text', 'Set by the gateway operator.'),
  F('Secondary screening indicator', 78, 1, 'text', 'Set by the receiving bank or gateway.'),
  F('Addenda record indicator', 79, 1, 'indicator', 'Always 1: international entries carry addenda.'),
  F('Trace number', 80, 15, 'trace', 'Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file.')
]);

const ADDENDA_05 = layout('Addenda (payment related information)', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', '05: payment related information.'),
  F('Payment related information', 4, 80, 'text', 'Free text or, for CTX, a remittance message split over the addenda records.'),
  F('Addenda sequence number', 84, 4, 'digits', 'Numbers the addenda of one entry from 0001.'),
  F('Entry detail sequence number', 88, 7, 'digits', 'The last seven digits of the trace number of the entry this addenda belongs to.')
]);

const ADDENDA_02 = layout('Addenda (terminal details)', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', '02: terminal and transaction details.'),
  F('Terminal and transaction details', 4, 76, 'text', 'Reference, terminal, date and location details of a card or terminal transaction.'),
  F('Trace number', 80, 15, 'trace', 'Trace number of the entry this addenda belongs to.')
]);

const ADDENDA_98 = layout('Addenda (notification of change)', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', '98: notification of change.'),
  F('Change code', 4, 3, 'changeCode', 'What the originator should correct.'),
  F('Original entry trace number', 7, 15, 'trace', 'Trace number of the entry that needs the change.'),
  F('Reserved', 22, 6, 'reserved', 'Blank.'),
  F('Original receiving DFI identification', 28, 8, 'routing8', 'Receiving bank identification of the original entry.'),
  F('Corrected data', 36, 29, 'text', 'The corrected value, for example an account number.'),
  F('Reserved', 65, 15, 'reserved', 'Blank.'),
  F('Trace number', 80, 15, 'trace', 'Trace number of this notification.')
]);

const ADDENDA_99 = layout('Addenda (return)', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', '99: return.'),
  F('Return reason code', 4, 3, 'returnCode', 'Why the entry was returned.'),
  F('Original entry trace number', 7, 15, 'trace', 'Trace number of the returned entry.'),
  F('Date of death', 22, 6, 'text', 'Only for returns because of a death, YYMMDD; otherwise blank.'),
  F('Original receiving DFI identification', 28, 8, 'routing8', 'Receiving bank identification of the original entry.'),
  F('Addenda information', 36, 44, 'text', 'Optional text from the returning bank.'),
  F('Trace number', 80, 15, 'trace', 'Trace number of this return.')
]);

const ADDENDA_IAT = layout('Addenda (international)', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', '10 to 16 are required for every international entry, in this order; 17 and 18 are optional.'),
  F('Addenda content', 4, 84, 'text', 'Names, addresses, banks, amounts or remittance data, depending on the addenda type.'),
  F('Entry detail sequence number', 88, 7, 'digits', 'The last seven digits of the trace number of the entry this addenda belongs to.')
]);

const ADDENDA_OTHER = layout('Addenda', [
  F('Record type code', 1, 1, 'type', 'Always 7 for an addenda record.'),
  F('Addenda type code', 2, 2, 'addendaType', 'Says what the addenda carries.'),
  F('Addenda content', 4, 91, 'text', 'Content depends on the addenda type.')
]);

const BATCH_CONTROL = layout('Batch control', [
  F('Record type code', 1, 1, 'type', 'Always 8 for a batch control record.'),
  F('Service class code', 2, 3, 'service', 'Same as in the batch header.'),
  F('Entry/addenda count', 5, 6, 'count', 'Number of entry detail and addenda records in the batch.'),
  F('Entry hash', 11, 10, 'hash', 'Sum of the receiving bank identifications (8 digits) of all entries; only the rightmost ten digits are kept.'),
  F('Total debit entry dollar amount', 21, 12, 'amount', 'Sum of the debit entries, in cents.'),
  F('Total credit entry dollar amount', 33, 12, 'amount', 'Sum of the credit entries, in cents.'),
  F('Company identification', 45, 10, 'text', 'Same as in the batch header.'),
  F('Message authentication code', 55, 19, 'text', 'Usually blank.'),
  F('Reserved', 74, 6, 'reserved', 'Blank.'),
  F('Originating DFI identification', 80, 8, 'routing8', 'Same as in the batch header.'),
  F('Batch number', 88, 7, 'digits', 'Same as in the batch header.')
]);

const FILE_CONTROL = layout('File control', [
  F('Record type code', 1, 1, 'type', 'Always 9 for the file control record.'),
  F('Batch count', 2, 6, 'count', 'Number of batches in the file.'),
  F('Block count', 8, 6, 'count', 'Number of blocks of ten records, counting every record up to and including this one.'),
  F('Entry/addenda count', 14, 8, 'count', 'Number of entry detail and addenda records in the file.'),
  F('Entry hash', 22, 10, 'hash', 'Sum of the receiving bank identifications of all entries in the file; rightmost ten digits.'),
  F('Total debit entry dollar amount in file', 32, 12, 'amount', 'Sum of all debit entries, in cents.'),
  F('Total credit entry dollar amount in file', 44, 12, 'amount', 'Sum of all credit entries, in cents.'),
  F('Reserved', 56, 39, 'reserved', 'Blank.')
]);

const FILLER = layout('Filler', [
  F('Filler', 1, 94, 'filler', 'Records of nine digits 9 that fill the last block to a multiple of ten records.')
]);

const ALL = [FILE_HEADER, BATCH_HEADER, IAT_BATCH_HEADER, ENTRY_PPD, ENTRY_CCD, ENTRY_WEB, ENTRY_TEL, ENTRY_CIE, ENTRY_SHR, ENTRY_ACK, ENTRY_OTHER, ENTRY_CTX, ENTRY_TRX, ENTRY_ATX, ENTRY_IAT,
  ADDENDA_05, ADDENDA_02, ADDENDA_98, ADDENDA_99, ADDENDA_IAT, ADDENDA_OTHER, BATCH_CONTROL, FILE_CONTROL, FILLER];

/** The entry layout for the SEC code of its batch. */
function entryLayout(sec) {
  switch (sec) {
    case 'PPD': return ENTRY_PPD;
    case 'TEL': return ENTRY_TEL;
    case 'CCD': return ENTRY_CCD;
    case 'WEB': return ENTRY_WEB;
    case 'CTX': return ENTRY_CTX;
    case 'TRX': return ENTRY_TRX;
    case 'ATX': return ENTRY_ATX;
    case 'ACK': return ENTRY_ACK;
    case 'CIE': case 'MTE': return ENTRY_CIE;
    case 'SHR': return ENTRY_SHR;
    case 'IAT': return ENTRY_IAT;
    default: return ENTRY_OTHER;
  }
}

/** True for the SEC codes whose entries carry a count of addenda records in positions 55-58 and a company in 59-74. */
function hasAddendaCount(sec) { return sec === 'CTX' || sec === 'TRX' || sec === 'ATX'; }

/** The addenda layout for an addenda type code. */
function addendaLayout(typeCode) {
  if (typeCode === '05') return ADDENDA_05;
  if (typeCode === '02') return ADDENDA_02;
  if (typeCode === '98') return ADDENDA_98;
  if (typeCode === '99') return ADDENDA_99;
  if (/^1[0-8]$/.test(typeCode)) return ADDENDA_IAT;
  return ADDENDA_OTHER;
}

/** The field that covers a 1-based column of a layout, or null. */
function fieldAt(lay, column) {
  for (const f of lay.fields) if (column >= f.start && column <= f.end) return f;
  return null;
}

/** The field of a layout by name (the first one with that name). */
function field(lay, name) {
  for (const f of lay.fields) if (f.name === name) return f;
  return null;
}

module.exports = {
  FILE_HEADER: FILE_HEADER, BATCH_HEADER: BATCH_HEADER, IAT_BATCH_HEADER: IAT_BATCH_HEADER, ENTRY_PPD: ENTRY_PPD, ENTRY_CCD: ENTRY_CCD, ENTRY_WEB: ENTRY_WEB,
  ENTRY_TEL: ENTRY_TEL, ENTRY_CIE: ENTRY_CIE, ENTRY_SHR: ENTRY_SHR, ENTRY_ACK: ENTRY_ACK, ENTRY_TRX: ENTRY_TRX, ENTRY_ATX: ENTRY_ATX,
  ENTRY_OTHER: ENTRY_OTHER, ENTRY_CTX: ENTRY_CTX, hasAddendaCount: hasAddendaCount, ENTRY_IAT: ENTRY_IAT, ADDENDA_05: ADDENDA_05, ADDENDA_02: ADDENDA_02, ADDENDA_98: ADDENDA_98, ADDENDA_99: ADDENDA_99,
  ADDENDA_IAT: ADDENDA_IAT, ADDENDA_OTHER: ADDENDA_OTHER, BATCH_CONTROL: BATCH_CONTROL, FILE_CONTROL: FILE_CONTROL, FILLER: FILLER, ALL: ALL,
  entryLayout: entryLayout, addendaLayout: addendaLayout, fieldAt: fieldAt, field: field
};
