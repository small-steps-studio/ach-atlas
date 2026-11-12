'use strict';
// The sample files behind "Open Sample File" and "Open Sample File With Problems". Every name,
// account and number is invented; the routing numbers start with 5, a range that is not assigned
// to banks, and carry correct check digits.

const W = require('./ach/write');
const B = require('./pro/build');

const t = W.text;

function validRecords() {
  const header = '101' + ' 590123400' + '1520749386' + '261112' + '0915' + 'A' + '094' + '10' + '1' + t('RIVERSTONE TEST BANK', 23) + t('HARBOR LANE CO', 23) + t('', 8);
  const payroll = '5' + '220' + t('HARBOR LANE CO', 16) + t('', 20) + '1520749386' + 'PPD' + t('PAYROLL', 10) + t('NOV 13', 6) + '261113' + '   ' + '1' + '59012340' + '0000001';
  const invoices = '5' + '225' + t('HARBOR LANE CO', 16) + t('', 20) + '1520749386' + 'CCD' + t('INVOICES', 10) + t('', 6) + '261116' + '   ' + '1' + '59012340' + '0000002';
  const batch1 = [
    '6' + '22' + '58123456' + '0' + t('4410027719', 17) + '0000184250' + t('EMP0001', 15) + t('ALMA ASHGROVE', 22) + '  ' + '0' + '590123400000001',
    '6' + '32' + '57300012' + '6' + t('9001834', 17) + '0000215075' + t('EMP0002', 15) + t('BORIS FERNHALL', 22) + '  ' + '1' + '590123400000002',
    '7' + '05' + t('SALARY NOVEMBER PART 1', 80) + '0001' + '0000002',
    '6' + '22' + '59012340' + '0' + t('120044871', 17) + '0000097300' + t('EMP0003', 15) + t('CELIA DUNMORE', 22) + '  ' + '0' + '590123400000003'
  ];
  const batch2 = [
    '6' + '27' + '56420078' + '6' + t('77120045', 17) + '0001250000' + t('INV-2026-114', 15) + t('GREYSTONE MILLWORK', 22) + '  ' + '1' + '590123400000004',
    '7' + '05' + t('INVOICE 2026-114 NET 30', 80) + '0001' + '0000004',
    '6' + '27' + '58123456' + '0' + t('300218', 17) + '0000312040' + t('INV-2026-117', 15) + t('PINECREST DENTAL', 22) + '  ' + '0' + '590123400000005'
  ];
  return B.assemble(header, [{ header: payroll, body: batch1, control: '' }, { header: invoices, body: batch2, control: '' }], { filler: true });
}

function problemRecords() {
  const r = validRecords();
  r[0] = r[0].replace(/ +$/, '');
  r[2] = W.setField(r[2], 12, '1');
  r[7] = W.setField(r[7], 70, '261131');
  r[11] = W.setField(r[11], 11, '0114543535');
  return r;
}

const SAMPLES = {
  valid: { fileName: 'sample-payroll-and-invoices.ach', title: 'sample ACH file', build: validRecords },
  problems: { fileName: 'sample-with-problems.ach', title: 'sample ACH file with four problems', build: problemRecords }
};

/** { fileName, title, text, languageId } of a sample, or null. */
function sampleFor(kind) {
  const s = SAMPLES[kind];
  if (!s) return null;
  return { fileName: s.fileName, title: s.title, text: W.join(s.build(), '\n', true), languageId: 'ach' };
}

module.exports = { sampleFor: sampleFor };
