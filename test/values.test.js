'use strict';
// Exact amounts, routing-number check digits, dates and times.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/ach/values');

test('amounts are read as BigInt cents and written without floating point', () => {
  assert.equal(V.cents('0000184250'), 184250n);
  assert.equal(V.cents('0000000000'), 0n);
  assert.equal(V.cents('9999999999'), 9999999999n);
  for (const bad of ['00001234AB', ' 000001234', '-000000001', '', '12.50', null, undefined]) assert.equal(V.cents(bad), null, String(bad));
  assert.equal(V.formatCents(184250n), '1,842.50');
  assert.equal(V.formatCents(5n), '0.05');
  assert.equal(V.formatCents(0n), '0.00');
  assert.equal(V.formatCents(999999999999n), '9,999,999,999.99');
  assert.equal(V.formatCents(-1562040n), '-15,620.40');
  assert.equal(V.formatCents('100'), '1.00');
  assert.equal(V.plainCents(184250n), '1842.50');
  assert.equal(V.plainCents(7n), '0.07');
  assert.equal(V.plainCents(-7n), '-0.07');
});

test('sums of amounts beyond 2^53 stay exact', () => {
  let sum = 0n;
  for (let k = 0; k < 1000; k++) sum += V.cents('9999999999');
  assert.equal(sum, 9999999999000n);
  assert.equal(V.formatCents(sum), '99,999,999,990.00');
  assert.equal(V.formatCents(2n ** 60n + 1n), '11,529,215,046,068,469.77');
});

test('decimal amounts typed by a person', () => {
  assert.equal(V.parseDecimal('1234.5'), 123450n);
  assert.equal(V.parseDecimal('1,234.56'), 123456n);
  assert.equal(V.parseDecimal('12'), 1200n);
  assert.equal(V.parseDecimal(' 0.01 '), 1n);
  assert.equal(V.parseDecimal('99999999.99'), 9999999999n);
  for (const bad of ['', '1.234', '-1', '+1', '1e3', '1,23.00', 'abc', '1.2.3', '1 000']) assert.equal(V.parseDecimal(bad), null, bad);
});

test('zero padding refuses values that do not fit', () => {
  assert.equal(V.zeroPad(42, 6), '000042');
  assert.equal(V.zeroPad(123456n, 6), '123456');
  assert.equal(V.zeroPad(1234567n, 6), null);
  assert.equal(V.zeroPad('-1', 6), null);
  assert.equal(V.hashField(28897934212345n), '7934212345');
  assert.equal(V.hashField(288979342n), '0288979342');
});

test('routing-number check digits (weights 3, 7, 1)', () => {
  // Worked by hand: 5*3 + 9*7 + 0*1 + 1*3 + 2*7 + 3*1 + 4*3 + 0*7 = 110, so the check digit is 0.
  assert.equal(V.checkDigit('59012340'), 0);
  // 5*3 + 7*7 + 3*1 + 0 + 0 + 0 + 1*3 + 2*7 = 84, so (10 - 4) % 10 = 6.
  assert.equal(V.checkDigit('57300012'), 6);
  // 5*3 + 6*7 + 4*1 + 2*3 + 0 + 0 + 7*3 + 8*7 = 144, so 6.
  assert.equal(V.checkDigit('56420078'), 6);
  assert.equal(V.validRouting('590123400'), true);
  assert.equal(V.validRouting('590123401'), false);
  assert.equal(V.validRouting('573000126'), true);
  for (const bad of ['', '1234567', '12345678X', '5901234000', null]) assert.equal(V.validRouting(bad), false, String(bad));
  assert.equal(V.checkDigit('1234567'), null);
  assert.equal(V.checkDigit('ABCDEFGH'), null);
});

test('dates: YYMMDD in 2000-2099, leap years, weekdays', () => {
  const d = V.parseYYMMDD('261113');
  assert.deepEqual([d.y, d.m, d.d, d.key, d.iso, V.WEEKDAYS[d.weekday]], [2026, 11, 13, 20261113, '2026-11-13', 'Friday']);
  assert.equal(V.WEEKDAYS[V.parseYYMMDD('261112').weekday], 'Thursday');
  assert.equal(V.WEEKDAYS[V.parseYYMMDD('000101').weekday], 'Saturday');
  assert.ok(V.parseYYMMDD('280229'), '2028 is a leap year');
  assert.equal(V.parseYYMMDD('260229'), null);
  assert.ok(V.parseYYMMDD('000229'), '2000 is a leap year');
  for (const bad of ['261131', '261301', '260000', '26111', '2611130', 'ABCDEF', '      ', '']) assert.equal(V.parseYYMMDD(bad), null, bad);
  assert.equal(V.parseYYMMDD('261114').day - V.parseYYMMDD('261113').day, 1);
  assert.equal(V.yymmddOfDay(V.parseYYMMDD('261231').day + 1), '270101');
  assert.equal(V.yymmddOfDay(V.nextWeekday(V.parseYYMMDD('261113').day)), '261116', 'Friday -> Monday');
  assert.equal(V.yymmddOfDay(V.nextWeekday(V.parseYYMMDD('261111').day)), '261112');
});

test('times: HHMM', () => {
  assert.equal(V.parseHHMM('0915').text, '09:15');
  assert.equal(V.parseHHMM('2359').text, '23:59');
  for (const bad of ['2400', '1260', '915', 'ABCD', '    ']) assert.equal(V.parseHHMM(bad), null, bad);
});

test('date arithmetic does not depend on the time zone of the computer', () => {
  const saved = process.env.TZ;
  const results = [];
  try {
    for (const tz of ['UTC', 'Pacific/Auckland', 'America/St_Johns', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      const d = V.parseYYMMDD('261101');
      results.push([d.day, d.weekday, V.yymmddOfDay(d.day), V.yymmddOfDay(V.nextWeekday(d.day)), V.localDay(new Date(2026, 10, 1, 23, 30))]);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(results[0][2], '261101');
});
