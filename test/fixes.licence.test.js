'use strict';
// Regression tests for licence, trial and environment defects found in the independent review:
// a rejected key and the offline grace period, trial clock and state tampering, storage failure
// while a key is replaced, and the test environment.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const config = require('../src/licence/config');
const messages = require('../src/licence/messages');
const { stores, server, make, HOUR, DAY } = require('./helpers/licence-fakes');

const root = path.join(__dirname, '..');

test('a key the server rejected does not come back through the offline grace period', async () => {
  const srv = server();
  const m = make({ server: srv });
  assert.equal((await m.lic.activate('KEY-A')).ok, true);
  m.advance(25 * HOUR);
  srv.options.invalid = true;
  assert.equal(await m.lic.isPro(), false, 'the server says the key is not valid');
  srv.options.invalid = false;
  srv.options.down = true;
  m.advance(25 * HOUR);
  assert.equal(await m.lic.isPro(), false, 'blocking the licence host must not bring Pro back');
  const st = await m.lic.status(false);
  assert.equal(st.via, 'rejected');
  assert.equal(st.pro, false);
  // When the server answers again and the key is valid, Pro returns at once.
  srv.options.down = false;
  m.advance(6 * 60 * 1000);
  assert.equal(await m.lic.isPro(), true);
});

test('a key refused with 403, 404 or 422 does not come back through the offline grace period either', async () => {
  for (const status of [403, 404, 422]) {
    const srv = server();
    const m = make({ server: srv });
    await m.lic.activate('KEY-A');
    m.advance(25 * HOUR);
    srv.options.validateStatus = status;
    assert.equal(await m.lic.isPro(), false, 'status ' + status);
    srv.options.validateStatus = 0;
    srv.options.down = true;
    m.advance(25 * HOUR);
    assert.equal(await m.lic.isPro(), false, 'offline after status ' + status);
  }
});

test('the offline grace period still works after a successful check', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-A');
  srv.options.down = true;
  m.advance(13 * DAY);
  assert.equal(await m.lic.isPro(), true);
  m.advance(2 * DAY);
  assert.equal(await m.lic.isPro(), false);
});

test('trial: an ended trial stays ended when the clock is set back', async () => {
  const m = make();
  const start = m.now();
  await m.lic.startTrial();
  m.advance(13 * DAY);
  await m.lic.touchTrial();
  m.advance(7 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired', 'day 20: the trial has ended');
  m.setClock(start + 2 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired', 'the clock is set back to day 2');
  assert.equal(await m.lic.hasAccess(), false);
  m.setClock(start + 1 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired');
  assert.equal((await m.lic.startTrial()).state, 'expired', 'never restarts');
});

test('trial: a start time and last use far in the future give the trial from now, never more', async () => {
  const m = make();
  m.s.globalMap.set('trial.startedAt', m.now() + 1000 * DAY);
  m.s.globalMap.set('trial.lastSeenAt', m.now() + 1000 * DAY);
  assert.deepEqual([m.lic.trialStatus().state, m.lic.trialStatus().daysLeft], ['active', 14]);
  await m.lic.touchTrial();
  m.advance(13 * DAY);
  assert.equal(await m.lic.hasAccess(), true, 'day 13');
  m.advance(2 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired', 'day 15: it ends 14 days after now, not 1000 days later');
  assert.equal(await m.lic.hasAccess(), false);
  m.advance(30 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired', '30 days later');
});

test('trial: a start time moved into the future after the end does not give a fresh trial', async () => {
  const m = make();
  await m.lic.startTrial();
  m.advance(20 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired');
  m.s.globalMap.set('trial.startedAt', m.now() + 5 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired');
  await m.lic.touchTrial();
  assert.equal(m.lic.trialStatus().state, 'expired');
  assert.equal(m.s.globalMap.get('trial.startedAt') > m.now(), true, 'the stored start time is not rewritten to now');
  assert.equal((await m.lic.startTrial()).state, 'expired');
  assert.equal(await m.lic.hasAccess(), false);
});

test('trial: the normal course is unchanged (13 days still active, 14 days ended)', async () => {
  const m = make();
  await m.lic.startTrial();
  m.advance(13 * DAY);
  assert.deepEqual([m.lic.trialStatus().state, m.lic.trialStatus().daysLeft], ['active', 1]);
  assert.equal(await m.lic.hasAccess(), true);
  m.advance(1 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired');
  assert.equal(await m.lic.hasAccess(), false);
});

test('replacing a key: when the new key cannot be stored the working licence is kept and no seat is left open', async () => {
  const s = stores({ failWhen: (kind, key, value) => kind === 'secret' && value === 'KEY-B' });
  const srv = server();
  const m = make({ stores: s, server: srv });
  assert.equal((await m.lic.activate('KEY-A')).ok, true);
  const r = await m.lic.activate('KEY-B');
  assert.deepEqual([r.ok, r.reason, r.released, r.previousKept], [false, 'storage', true, true]);
  assert.equal(srv.seats('KEY-B'), 0, 'the new activation was given back');
  assert.equal(srv.seats('KEY-A'), 1, 'the working licence keeps its seat');
  assert.equal(s.secretsMap.get('licence.key.live'), 'KEY-A');
  assert.equal(await m.lic.isPro(), true);
  assert.equal((await m.lic.status(true)).licenceType, 'personal');
  assert.match(messages.activationFailureText(r), /previous licence was kept and still works/);
  assert.ok(!/Pro stays off|nothing was stored/i.test(messages.activationFailureText(r)));
  // Remove Licence can still free the seat of the kept licence.
  assert.deepEqual(await m.lic.remove(), { ok: true, deactivated: true });
  assert.equal(srv.seats('KEY-A'), 0);
});

test('replacing a key: a failing state write after the key was stored restores the previous licence', async () => {
  let armed = false;
  const s = stores({ failWhen: (kind, key, value) => armed && kind === 'state' && key === 'licence.instanceId.live' && value === 'lki_2' });
  const srv = server();
  const m = make({ stores: s, server: srv });
  await m.lic.activate('KEY-A');
  armed = true;
  const r = await m.lic.activate('KEY-B');
  assert.deepEqual([r.ok, r.reason, r.released, r.previousKept], [false, 'storage', true, true]);
  assert.equal(s.secretsMap.get('licence.key.live'), 'KEY-A', 'the previous key is back in the secret storage');
  assert.equal(s.globalMap.get('licence.instanceId.live'), 'lki_1');
  assert.equal(s.globalMap.get('licence.productId.live'), config.products.live.personal);
  assert.equal(srv.seats('KEY-B'), 0);
  assert.equal(srv.seats('KEY-A'), 1);
  assert.equal(await m.lic.isPro(), true);
});

test('first activation with failing storage still stores nothing and releases the seat', async () => {
  const s = stores({ failWhen: (kind) => kind === 'secret' });
  const srv = server();
  const m = make({ stores: s, server: srv });
  const r = await m.lic.activate('KEY-A');
  assert.deepEqual(r, { ok: false, reason: 'storage', released: true });
  assert.equal(srv.seats('KEY-A'), 0);
  assert.equal(s.secretsMap.size, 0);
  assert.deepEqual(Array.from(s.globalMap.keys()).filter((k) => k.startsWith('licence.')), []);
  assert.equal(await m.lic.isPro(), false);
});

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...sourceFiles(rel)); else out.push(rel);
  }
  return out;
}

test('the test licence environment cannot be reached: no address, no variable, nothing to select it', () => {
  for (const f of sourceFiles('src').concat(['package.json', 'README.md', 'PRIVACY.md', 'TERMS.md', 'LICENSE.txt', 'CHANGELOG.md'])) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/test\.(checkout\.)?dodopayments\.com/.test(text), f + ' names a test licence address');
    if (f.startsWith('src/')) assert.ok(!/process\.env/.test(text), f + ' reads an environment variable');
  }
  // A fresh process that loads the shipped configuration knows the live environment only.
  const code = "const c=require('./src/licence/config');const e=c.resolve('test');process.stdout.write(JSON.stringify({known:c.knownEnvironments?c.knownEnvironments():null,mode:e.mode,api:e.api,buy:c.buyUrlFor('test','personal',1),allowed:c.allowedProductIds('test')}));";
  const out = JSON.parse(cp.execFileSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8', windowsHide: true }));
  assert.deepEqual(out.known, ['live']);
  assert.equal(out.mode, 'live');
  assert.equal(out.api, 'https://live.dodopayments.com');
  assert.ok(out.buy.startsWith('https://checkout.dodopayments.com/buy/'));
  assert.deepEqual(out.allowed, config.allowedProductIds('live'));
});

test('registering a stand-in environment needs https addresses and is something only tests do', () => {
  assert.throws(() => config.registerTestEnvironment({ api: 'http://x.example', checkoutBase: 'https://x.example/' }), /https/);
  assert.throws(() => config.registerTestEnvironment(null), /https/);
  const src = sourceFiles('src').map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
  for (const [f, text] of src) if (f !== 'src/licence/config.js') assert.ok(!/registerTestEnvironment/.test(text), f + ' registers a test environment');
});
