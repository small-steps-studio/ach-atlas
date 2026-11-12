'use strict';
// Exact value handling for ACH fields: amounts in cents as BigInt (never floating point), decimal
// text in and out, routing-number check digits, and dates and times. Dates are calendar dates
// without a time zone; every calculation uses UTC arithmetic so the result does not depend on the
// time zone of the computer.

const DIGITS = /^[0-9]+$/;

/** Cents as BigInt for a field of digits, or null when the field holds anything else. */
function cents(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw);
  return DIGITS.test(s) ? BigInt(s) : null;
}

/** Formats cents (BigInt or digit string) as 1,234.56; negative values get a leading minus. */
function formatCents(value) {
  let v = typeof value === 'bigint' ? value : BigInt(String(value));
  const negative = v < 0n;
  if (negative) v = -v;
  const s = v.toString().padStart(3, '0');
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + whole + '.' + s.slice(-2);
}

/** Formats cents as plain decimal text without grouping: 1234.56 (for CSV and JSON). */
function plainCents(value) {
  let v = typeof value === 'bigint' ? value : BigInt(String(value));
  const negative = v < 0n;
  if (negative) v = -v;
  const s = v.toString().padStart(3, '0');
  return (negative ? '-' : '') + s.slice(0, -2) + '.' + s.slice(-2);
}

/**
 * Reads a decimal amount typed by a person ("1234.5", "1,234.56", "12") into cents (BigInt).
 * Returns null for anything else: signs, more than two decimals, exponents, empty text.
 */
function parseDecimal(text) {
  const s = String(text === undefined || text === null ? '' : text).trim();
  const m = /^((?:[0-9]{1,3}(?:,[0-9]{3})+)|[0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/,/g, '');
  const frac = (m[2] || '').padEnd(2, '0');
  return BigInt(whole) * 100n + BigInt(frac);
}

/** A non-negative BigInt or digit string written as `width` digits, or null when it does not fit. */
function zeroPad(value, width) {
  const s = typeof value === 'bigint' ? value.toString() : String(value);
  if (!DIGITS.test(s) || s.length > width) return null;
  return s.padStart(width, '0');
}

const HASH_MOD = 10000000000n;

/** The entry hash field value (rightmost ten digits) of a full sum. */
function hashField(sum) { return zeroPad(sum % HASH_MOD, 10); }

// ---- routing numbers ----------------------------------------------------------------------------

const WEIGHTS = [3, 7, 1, 3, 7, 1, 3, 7];

/** The check digit (0-9) for an 8-digit routing identification, or null for other input. */
function checkDigit(eight) {
  const s = String(eight || '');
  if (!/^[0-9]{8}$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (s.charCodeAt(i) - 48) * WEIGHTS[i];
  return (10 - (sum % 10)) % 10;
}

/** True for nine digits whose last digit is the correct check digit. */
function validRouting(nine) {
  const s = String(nine || '');
  if (!/^[0-9]{9}$/.test(s)) return false;
  return checkDigit(s.slice(0, 8)) === s.charCodeAt(8) - 48;
}

// ---- dates and times ----------------------------------------------------------------------------

const DAY_MS = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Reads a YYMMDD field as a date in the years 2000 to 2099:
 * { y, m, d, key (yyyymmdd as a number), day (days since 1970-01-01), weekday (0 = Sunday), iso }
 * or null when the field is not a valid date.
 */
function parseYYMMDD(raw) {
  const s = String(raw || '');
  if (!/^[0-9]{6}$/.test(s)) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  if (m < 1 || m > 12 || d < 1) return null;
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y: y, m: m, d: d, key: y * 10000 + m * 100 + d, day: Math.round(ms / DAY_MS), weekday: check.getUTCDay(), iso: y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') };
}

/** YYMMDD for a day number (days since 1970-01-01). */
function yymmddOfDay(day) {
  const t = new Date(day * DAY_MS);
  return String(t.getUTCFullYear() % 100).padStart(2, '0') + String(t.getUTCMonth() + 1).padStart(2, '0') + String(t.getUTCDate()).padStart(2, '0');
}

/** The day number of a calendar date taken from a Date object in the computer's own time zone. */
function localDay(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** The first Monday-to-Friday day after `day`. */
function nextWeekday(day) {
  let d = day + 1;
  while ([0, 6].indexOf(new Date(d * DAY_MS).getUTCDay()) !== -1) d++;
  return d;
}

/** Reads an HHMM field: { h, m, text } or null. */
function parseHHMM(raw) {
  const s = String(raw || '');
  if (!/^[0-9]{4}$/.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (h > 23 || m > 59) return null;
  return { h: h, m: m, text: s.slice(0, 2) + ':' + s.slice(2) };
}

module.exports = {
  cents: cents, formatCents: formatCents, plainCents: plainCents, parseDecimal: parseDecimal, zeroPad: zeroPad, hashField: hashField, HASH_MOD: HASH_MOD,
  checkDigit: checkDigit, validRouting: validRouting, parseYYMMDD: parseYYMMDD, yymmddOfDay: yymmddOfDay, localDay: localDay, nextWeekday: nextWeekday,
  parseHHMM: parseHHMM, WEEKDAYS: WEEKDAYS, DAY_MS: DAY_MS
};
