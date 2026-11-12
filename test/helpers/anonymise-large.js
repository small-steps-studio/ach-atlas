'use strict';
// Child process of the large-file test: builds a file of 500,000 entries with distinct accounts,
// identification numbers and names (about 47 MB), anonymises it and prints the milliseconds. The
// parent starts it with a limit on the heap, so that running out of memory fails the test.
//   node --max-old-space-size=<MB> test/helpers/anonymise-large.js <project folder> [entries]

const path = require('node:path');

const root = process.argv[2] || path.join(__dirname, '..', '..');
const entries = Number(process.argv[3]) || 500000;
const A = require(path.join(root, 'src/pro/anonymise'));

function bigFile(count) {
  const header = '101 590123400' + '1520749386' + '2611120915A094101' + 'RIVERSTONE TEST BANK   ' + 'HARBOR LANE CO         ' + '        ';
  const batchHeader = '5220' + 'HARBOR LANE CO'.padEnd(16) + ''.padEnd(20) + '1520749386' + 'PPD' + 'PAYROLL'.padEnd(10) + ''.padEnd(6) + '261113' + '   1' + '59012340' + '0000001';
  const chunks = [header + '\n' + batchHeader + '\n'];
  let part = [];
  for (let k = 1; k <= count; k++) {
    const amount = String(100 + (k % 900000)).padStart(10, '0');
    part.push('622581234560' + ('ACCT' + k * 7).padEnd(17) + amount + ('EMP' + k).padEnd(15) + ('PERSON ' + k).padEnd(22) + '  0' + '59012340' + String(k % 10000000).padStart(7, '0'));
    if (part.length === 20000) { chunks.push(part.join('\n') + '\n'); part = []; }
  }
  if (part.length) chunks.push(part.join('\n') + '\n');
  chunks.push('8220' + ' '.repeat(90) + '\n' + '9' + ' '.repeat(93) + '\n');
  return chunks.join('');
}

const text = bigFile(entries);
const t0 = Date.now();
const res = A.createAnonymiser({ seed: 3, amounts: 'replace' }).anonymise(text);
process.stdout.write(JSON.stringify({ ms: Date.now() - t0, changed: res.changed, length: res.text.length, sameLength: res.text.length === text.length, megabytes: Math.round(text.length / 1048576) }) + '\n');
