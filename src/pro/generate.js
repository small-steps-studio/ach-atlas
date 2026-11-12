'use strict';
// Create Test File (Pro): builds a complete ACH file of invented entries with correct batch and
// file controls, entry hash, check digits, trace numbers and filler. All names, numbers and bank
// identifications are invented; the default routing numbers start with 5, a range that is not
// assigned to banks, so they never point to a real institution.

const V = require('../ach/values');
const W = require('../ach/write');
const R = require('./random');
const B = require('./build');

const SEC_OPTIONS = Object.freeze(['PPD', 'CCD', 'CTX', 'WEB', 'TEL']);
const MAX_ENTRIES = 100000;
const MAX_BATCHES = 50;
const MAX_TOTAL = 999999999999n;
const MAX_AMOUNT = 9999999999n;

const GIVEN = ['ALMA', 'BORIS', 'CELIA', 'DARIO', 'EDITH', 'FINN', 'GRETA', 'HUGO', 'IRIS', 'JONAS', 'KIRA', 'LEON', 'MIRA', 'NILS', 'OLGA', 'PAVEL', 'RUTH', 'SVEN', 'TILDA', 'VIGO', 'WANDA', 'YARA'];
const FAMILY = ['ASHGROVE', 'BRAMBLE', 'COLDWELL', 'DUNMORE', 'ELMSTEAD', 'FERNHALL', 'GLENROSE', 'HALLOWAY', 'IVYBRIDGE', 'JUNIPER', 'KESTREL', 'LINDQVIST', 'MOORCROFT', 'NETTLEFORD', 'OAKSHOTT', 'PELLWORTH', 'QUILLAN', 'ROWANSEY', 'STAVEN', 'THORNBURY'];
const FIRMS = ['GREYSTONE MILLWORK', 'PINECREST DENTAL', 'COPPERLEAF TEXTILE', 'BLUE HERON CAFE', 'NORTHFIELD SUPPLY', 'SILVERBIRCH PRINT', 'MARIGOLD CATERING', 'IRONWOOD HAULAGE', 'BRIGHTWATER LABS', 'OLD MILL BAKERY'];

const DEFAULTS = Object.freeze({
  odfi: '590123400',
  destination: '581234560',
  destinationName: 'LAKESIDE TEST BANK',
  companyName: 'HARBOR LANE CO',
  companyId: '1520749386'
});

function description(sec, direction) {
  if (sec === 'PPD') return direction === 'credit' ? 'PAYROLL' : direction === 'debit' ? 'PAYMENT' : 'PAYROLL';
  if (sec === 'CCD') return direction === 'debit' ? 'COLLECTION' : 'VENDOR PAY';
  if (sec === 'CTX') return 'REMITTANCE';
  if (sec === 'WEB') return 'ONLINE PAY';
  return 'PHONE PAY';
}

/**
 * Checks the options of Create Test File; returns an error sentence or null. See generate() for the options.
 */
function checkOptions(o) {
  if (SEC_OPTIONS.indexOf(o.sec) === -1) return 'Choose one of the SEC codes ' + SEC_OPTIONS.join(', ') + '.';
  if (['credit', 'debit', 'mixed'].indexOf(o.direction) === -1) return 'Choose credits, debits or mixed.';
  if (o.sec === 'TEL' && o.direction !== 'debit') return 'TEL entries are debits only.';
  if (!Number.isInteger(o.count) || o.count < 1 || o.count > MAX_ENTRIES) return 'The number of entries must be a whole number from 1 to ' + MAX_ENTRIES.toLocaleString('en-US') + '.';
  if (!Number.isInteger(o.batches) || o.batches < 1 || o.batches > MAX_BATCHES || o.batches > o.count) return 'The number of batches must be a whole number from 1 to ' + Math.min(MAX_BATCHES, o.count) + '.';
  if (typeof o.min !== 'bigint' || typeof o.max !== 'bigint' || o.min < 1n || o.max < o.min) return 'The amount range must be two amounts from 0.01 upwards, the smaller first.';
  if (o.max > MAX_AMOUNT) return 'The largest amount of one entry is 99,999,999.99.';
  if (BigInt(o.count) * o.max > MAX_TOTAL) return 'The count times the largest amount would exceed the largest total a control record can hold (9,999,999,999.99). Lower the count or the maximum amount.';
  if (!V.parseYYMMDD(o.effectiveDate)) return 'The effective entry date must be a valid date (YYMMDD).';
  if (!V.validRouting(o.odfi)) return 'The originating bank routing number must be nine digits with a correct check digit.';
  if (!V.validRouting(o.destination)) return 'The destination routing number must be nine digits with a correct check digit.';
  return null;
}

/**
 * Builds the file. Options: sec, direction ('credit' | 'debit' | 'mixed'), count, batches, min and
 * max (BigInt cents), effectiveDate (YYMMDD), created ({ date: YYMMDD, time: HHMM }), addenda
 * (boolean), odfi and destination (nine-digit routing numbers), companyName, companyId,
 * destinationName, seed, lineBreak. Returns { ok: true, text, summary } or { ok: false, reason }.
 */
function generate(options) {
  const o = Object.assign({ batches: 1, addenda: false, seed: 1, lineBreak: '\n' }, DEFAULTS, options || {});
  const problem = checkOptions(o);
  if (problem) return { ok: false, reason: problem };
  const rnd = R.createRandom(o.seed);
  const odfi8 = o.odfi.slice(0, 8);
  const created = o.created || { date: o.effectiveDate, time: '0900' };
  const header = '101' + ' ' + o.destination + W.text(o.companyId, 10) + created.date + created.time + 'A' + '094' + '10' + '1' +
    W.text(o.destinationName, 23) + W.text(o.companyName, 23) + W.text('', 8);
  const rdfis = [];
  for (let k = 0; k < 24; k++) {
    const eight = '5' + String(rnd.int(0, 9999999)).padStart(7, '0');
    rdfis.push(eight + V.checkDigit(eight));
  }
  const service = o.direction === 'credit' ? '220' : o.direction === 'debit' ? '225' : '200';
  const batches = [];
  let seq = 0;
  let debit = 0n;
  let credit = 0n;
  const per = Math.floor(o.count / o.batches);
  let extra = o.count % o.batches;
  for (let n = 1; n <= o.batches; n++) {
    const size = per + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    const bh = '5' + service + W.text(o.companyName, 16) + W.text('', 20) + W.text(o.companyId, 10) + o.sec + W.text(description(o.sec, o.direction), 10) +
      W.text('', 6) + o.effectiveDate + '   ' + '1' + odfi8 + W.num(n, 7);
    const body = [];
    for (let k = 0; k < size; k++) {
      seq++;
      const isDebit = o.direction === 'debit' || (o.direction === 'mixed' && rnd.next() < 0.5);
      const savings = rnd.next() < 0.2;
      const tx = (savings ? '3' : '2') + (isDebit ? '7' : '2');
      const routing = rnd.pick(rdfis);
      const account = String(rnd.int(100000, 999999)) + String(rnd.int(0, 999999)).slice(0, rnd.int(0, 6));
      const amount = rnd.big(o.min, o.max);
      if (isDebit) debit += amount; else credit += amount;
      const trace = odfi8 + W.num(seq, 7, 'The trace sequence');
      const business = o.sec === 'CCD' || o.sec === 'CTX';
      const who = business ? rnd.pick(FIRMS) : rnd.pick(GIVEN) + ' ' + rnd.pick(FAMILY);
      const ident = (business ? 'INV' : isDebit ? 'CUST' : 'EMP') + String(rnd.int(10000, 999999));
      let addenda = [];
      if (o.sec === 'CTX') {
        const n05 = o.addenda ? rnd.int(1, 3) : 1;
        for (let a = 1; a <= n05; a++) addenda.push('705' + W.text('REMITTANCE ' + ident + ' PART ' + a + ' OF ' + n05 + ' AMOUNT ' + V.plainCents(amount), 80) + W.num(a, 4) + trace.slice(8));
      } else if (o.addenda && o.sec !== 'TEL') {
        addenda = ['705' + W.text((isDebit ? 'PAYMENT FOR ' : 'PAYMENT ') + ident, 80) + '0001' + trace.slice(8)];
      }
      let middle;
      if (o.sec === 'CTX') middle = W.text(ident, 15) + W.num(addenda.length, 4) + W.text(who, 16) + '  ' + '  ';
      else middle = W.text(ident, 15) + W.text(who, 22) + (o.sec === 'WEB' && isDebit ? (rnd.next() < 0.5 ? 'R ' : 'S ') : '  ');
      body.push('6' + tx + routing + W.text(account, 17) + W.num(amount, 10, 'An amount') + middle + (addenda.length ? '1' : '0') + trace);
      for (const a of addenda) body.push(a);
    }
    batches.push({ header: bh, body: body, control: '' });
  }
  let records;
  try { records = B.assemble(header, batches, { filler: true }); } catch (e) { return { ok: false, reason: e.message }; }
  return {
    ok: true,
    text: W.join(records, o.lineBreak, true),
    summary: { entries: o.count, batches: o.batches, records: records.length, debit: debit, credit: credit }
  };
}

module.exports = { generate: generate, checkOptions: checkOptions, DEFAULTS: DEFAULTS, SEC_OPTIONS: SEC_OPTIONS, MAX_ENTRIES: MAX_ENTRIES, MAX_BATCHES: MAX_BATCHES };
