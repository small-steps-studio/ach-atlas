'use strict';
// Code tables of the ACH file format: record types, service class codes, Standard Entry Class
// (SEC) codes, transaction codes, addenda type codes, return reason codes and change codes. The
// short descriptions are written for this extension; codes and their structure are facts of the
// published file layout.

const RECORD_TYPES = Object.freeze({
  '1': 'File header', '5': 'Batch header', '6': 'Entry detail', '7': 'Addenda', '8': 'Batch control', '9': 'File control'
});

const SERVICE_CLASSES = Object.freeze({
  '200': 'mixed debits and credits',
  '220': 'credits only',
  '225': 'debits only',
  '280': 'automated accounting advices'
});

const SEC_CODES = Object.freeze({
  ACK: 'acknowledgement of a corporate credit',
  ADV: 'automated accounting advice',
  ARC: 'accounts receivable check conversion',
  ATX: 'acknowledgement of a corporate trade exchange credit',
  BOC: 'back office check conversion',
  CCD: 'corporate credit or debit',
  CIE: 'customer-initiated entry',
  COR: 'notification of change or refused notification of change',
  CTX: 'corporate trade exchange with remittance addenda',
  DNE: 'death notification entry',
  ENR: 'automated enrolment entry',
  IAT: 'international ACH transaction',
  MTE: 'machine transfer entry',
  POP: 'point-of-purchase check conversion',
  POS: 'point-of-sale entry',
  PPD: 'prearranged payment and deposit (consumer accounts)',
  RCK: 're-presented check entry',
  SHR: 'shared network entry',
  TEL: 'telephone-initiated entry',
  TRC: 'truncated check entry',
  TRX: 'truncated checks exchange',
  WEB: 'internet-initiated or mobile entry',
  XCK: 'destroyed check entry'
});

// SEC codes whose entries and addenda are checked in detail. Others are read, counted and
// totalled; their code-specific fields are not checked.
const CHECKED_SEC = Object.freeze(['PPD', 'CCD', 'CTX', 'WEB', 'TEL', 'IAT']);

const ACCOUNT_TYPES = Object.freeze({ '2': 'checking account', '3': 'savings account', '4': 'general ledger account', '5': 'loan account' });

const TX_KINDS = Object.freeze({
  '1': { direction: 'credit', kind: 'return', text: 'return or notification of change, credit' },
  '2': { direction: 'credit', kind: 'live', text: 'credit' },
  '3': { direction: 'credit', kind: 'prenote', text: 'prenotification of a credit (zero amount)' },
  '4': { direction: 'credit', kind: 'zero', text: 'zero-dollar credit with remittance data' },
  '5': { direction: 'debit', kind: 'live', text: 'debit (used for reversals)' },
  '6': { direction: 'debit', kind: 'return', text: 'return or notification of change, debit' },
  '7': { direction: 'debit', kind: 'live', text: 'debit' },
  '8': { direction: 'debit', kind: 'prenote', text: 'prenotification of a debit (zero amount)' },
  '9': { direction: 'debit', kind: 'zero', text: 'zero-dollar debit with remittance data' }
});

/**
 * Describes a two-character transaction code: { valid, code, account, direction, kind, label }.
 * Checking, savings and general ledger accounts use the second digits 1 to 4 and 6 to 9; loan
 * accounts use 1 to 6. Every other code is { valid: false }.
 */
function transactionCode(code) {
  const c = String(code || '');
  if (!/^[0-9]{2}$/.test(c)) return { valid: false, code: c };
  const account = ACCOUNT_TYPES[c[0]];
  const kind = TX_KINDS[c[1]];
  if (!account || !kind) return { valid: false, code: c };
  if (c[0] === '5' && '123456'.indexOf(c[1]) === -1) return { valid: false, code: c };
  if (c[0] !== '5' && c[1] === '5') return { valid: false, code: c };
  return { valid: true, code: c, account: account, direction: kind.direction, kind: kind.kind, label: account + ', ' + kind.text };
}

// Addenda type codes and what they carry.
const ADDENDA_TYPES = Object.freeze({
  '02': 'terminal and transaction details (point-of-sale, shared network and machine transfer entries)',
  '05': 'payment related information',
  '10': 'international: transaction type, foreign payment amount and receiver name',
  '11': 'international: originator name and street address',
  '12': 'international: originator city, state, country and postal code',
  '13': 'international: originating bank',
  '14': 'international: intermediary or receiving bank',
  '15': 'international: receiver identification and street address',
  '16': 'international: receiver city, state, country and postal code',
  '17': 'international: remittance information',
  '18': 'international: foreign correspondent bank',
  '98': 'notification of change',
  '99': 'return'
});

// Addenda types allowed per SEC code, and the largest number of addenda per entry (besides one
// return or change addenda, which any entry may carry). `null` = not checked for this code.
const ADDENDA_RULES = Object.freeze({
  PPD: { types: ['05'], max: 1 },
  CCD: { types: ['05'], max: 1 },
  WEB: { types: ['05'], max: 1 },
  TEL: { types: [], max: 0 },
  CTX: { types: ['05'], max: 9999 },
  IAT: { types: ['10', '11', '12', '13', '14', '15', '16', '17', '18'], max: 9999 },
  POS: { types: ['02'], max: 1 },
  SHR: { types: ['02'], max: 1 },
  MTE: { types: ['02'], max: 1 }
});

// Return reason codes found in addenda type 99, in short words of our own. Codes that are not
// listed here show "see your bank's list of return reason codes" in the hover.
const RETURN_CODES = Object.freeze({
  R01: 'not enough funds in the account',
  R02: 'the account is closed',
  R03: 'no account found, or the account does not match the name',
  R04: 'the account number is not valid',
  R05: 'debit to a consumer account sent with a business SEC code without authorisation',
  R06: 'returned at the request of the originating bank',
  R07: 'the receiver withdrew the authorisation',
  R08: 'the receiver stopped this payment',
  R09: 'the funds are not yet collected',
  R10: 'the receiver does not know the originator or did not authorise the debit',
  R11: 'the receiver says the debit does not match the terms of the authorisation',
  R12: 'the account was sold to another bank',
  R13: 'the routing number is not valid for ACH entries',
  R14: 'the representative payee has died or can no longer act',
  R15: 'the beneficiary or account holder has died',
  R16: 'the account is frozen',
  R17: 'the file or the record failed the edit criteria of the receiving bank',
  R18: 'the effective entry date is not correct',
  R19: 'the amount field is not correct',
  R20: 'the account does not allow this kind of transaction',
  R21: 'the company identification is not valid',
  R22: 'the individual identification number is not valid',
  R23: 'the receiver refused the credit',
  R24: 'duplicate entry',
  R25: 'the addenda record is not correct',
  R26: 'a mandatory field is missing or not correct',
  R27: 'the trace number is not correct',
  R28: 'the routing number check digit is not correct',
  R29: 'the business receiver did not authorise the debit',
  R30: 'the receiving bank does not take part in check truncation',
  R31: 'the receiving bank returned the entry late with the consent of the originating bank',
  R32: 'the receiving bank cannot settle the entry',
  R33: 'a destroyed check entry was returned',
  R34: 'the receiving bank takes part in the ACH system in a limited way',
  R35: 'the debit entry is not allowed',
  R36: 'the credit entry is not allowed',
  R37: 'the source document was presented for payment',
  R38: 'a stop payment was placed on the source document',
  R39: 'the source document is not valid',
  R40: 'an enrolment entry was returned by a government agency',
  R41: 'the transaction code is not valid',
  R42: 'the routing number or its check digit is not valid',
  R43: 'the account number is not valid',
  R44: 'the identification number is not valid',
  R45: 'the individual or company name is not valid',
  R46: 'the representative payee indicator is not valid',
  R47: 'the enrolment is a duplicate',
  R50: 'a state law affects the acceptance of the check entry',
  R51: 'the item behind the check entry is not eligible or the entry is not correct',
  R52: 'a stop payment was placed on the item behind the check entry',
  R53: 'the item and the check entry were both presented for payment',
  R61: 'the return was sent to the wrong bank',
  R62: 'the debit or reversal was sent in error',
  R67: 'the return is a duplicate',
  R68: 'the return came too late',
  R69: 'a field of the return is not correct',
  R70: 'the originating bank did not agree to a permitted return',
  R71: 'the dishonoured return was sent to the wrong bank',
  R72: 'the dishonoured return came too late',
  R73: 'the original return was on time',
  R74: 'the corrected return is a correction of an earlier one',
  R75: 'the return is not a duplicate',
  R76: 'no error was found in the return',
  R77: 'the dishonoured return was not accepted',
  R80: 'the international entry is coded incorrectly',
  R81: 'the foreign bank does not take part in the international ACH program',
  R82: 'the foreign receiving bank identification is not valid',
  R83: 'the foreign receiving bank cannot settle the entry',
  R84: 'the gateway did not process the entry',
  R85: 'the outbound international payment is coded incorrectly'
});

// Change codes found in addenda type 98 (notification of change), including the codes that refuse a
// notification of change (C61 to C69). Codes that are not listed show "see your bank's list of
// change codes" in the hover.
const CHANGE_CODES = Object.freeze({
  C01: 'use the corrected account number',
  C02: 'use the corrected routing number',
  C03: 'use the corrected routing number and account number',
  C04: 'use the corrected receiver name',
  C05: 'use the corrected transaction code',
  C06: 'use the corrected account number and transaction code',
  C07: 'use the corrected routing number, account number and transaction code',
  C08: 'use the corrected receiving bank identification (international entries)',
  C09: 'use the corrected individual identification number',
  C10: 'use the corrected company name',
  C11: 'use the corrected company identification',
  C12: 'use the corrected company name and company identification',
  C13: 'the addenda format was not correct',
  C14: 'use the corrected SEC code of the outbound international payment',
  C61: 'refused change: the notification was sent to the wrong originator',
  C62: 'refused change: the trace number is not correct',
  C63: 'refused change: the company identification is not correct',
  C64: 'refused change: the individual identification number is not correct',
  C65: 'refused change: the corrected data is not formatted correctly',
  C66: 'refused change: the discretionary data is not correct',
  C67: 'refused change: the routing number does not come from the original entry',
  C68: 'refused change: the account number does not come from the original entry',
  C69: 'refused change: the transaction code is not correct'
});

const ORIGINATOR_STATUS = Object.freeze({
  '0': 'file prepared by an ACH operator',
  '1': 'the originating bank is a depository financial institution',
  '2': 'the originating bank is a government agency'
});

module.exports = {
  RECORD_TYPES: RECORD_TYPES, SERVICE_CLASSES: SERVICE_CLASSES, SEC_CODES: SEC_CODES, CHECKED_SEC: CHECKED_SEC, ACCOUNT_TYPES: ACCOUNT_TYPES,
  transactionCode: transactionCode, ADDENDA_TYPES: ADDENDA_TYPES, ADDENDA_RULES: ADDENDA_RULES, RETURN_CODES: RETURN_CODES, CHANGE_CODES: CHANGE_CODES,
  ORIGINATOR_STATUS: ORIGINATOR_STATUS
};
