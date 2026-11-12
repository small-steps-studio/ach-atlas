'use strict';
// Licence service, trial and product allow-list, with an injected fetch, clock and stores.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/licence/config');
const messages = require('../src/licence/messages');
const L = require('../src/licence/licence');
const testEnvironment = require('./helpers/test-environment');

testEnvironment.register();

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function stores(options) {
  const o = options || {};
  const secrets = new Map();
  const global = new Map();
  const writes = [];
  return {
    secretsMap: secrets, globalMap: global, writes: writes, options: o,
    secrets: {
      get: async (k) => { if (o.failGet) throw new Error('no keyring'); return o.memoryOnly ? undefined : secrets.get(k); },
      store: async (k, v) => { if (o.failStore) throw new Error('no keyring'); writes.push(['secret', k, v]); secrets.set(k, v); },
      delete: async (k) => { secrets.delete(k); }
    },
    globalState: {
      get: (k) => global.get(k),
      update: async (k, v) => { if (o.readOnly) throw new Error('read only'); writes.push(['state', k, v]); if (v === undefined) global.delete(k); else global.set(k, v); }
    }
  };
}

// A stand-in for the public licence endpoints with the documented answer shapes.
function server(options) {
  const o = Object.assign({ keys: { 'KEY-PERSONAL': config.products.live.personal, 'KEY-BUSINESS': config.products.live.business, 'KEY-TEST-P': config.products.test.personal, 'KEY-TEST-B': config.products.test.business, 'KEY-OTHER': 'pdt_OtherProduct0001' }, limit: 3 }, options || {});
  const calls = [];
  const active = new Map();
  let seq = 0;
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    calls.push({ url: url, body: body });
    if (o.down) throw new Error('offline');
    const path = url.replace(/^https:\/\/[^/]+/, '');
    const reply = function (status, data) { return { status: status, json: async () => { if (data === undefined) throw new Error('no body'); return data; } }; };
    if (o.status) return reply(o.status, { code: 'X' });
    if (path === '/licenses/activate') {
      const product = o.keys[body.license_key];
      if (!product) return reply(404, { code: 'NOT_FOUND' });
      const used = Array.from(active.values()).filter((k) => k === body.license_key).length;
      if (used >= o.limit) return reply(422, { code: 'LIMIT' });
      const id = 'lki_' + (++seq);
      active.set(id, body.license_key);
      const answer = { id: id, business_id: 'bus_1', name: body.name, license_key_id: 'lic_1', created_at: '2026-11-12T00:00:00Z', customer: { customer_id: 'cus_1', name: 'Test Buyer', email: 'buyer@example.com', phone_number: null, metadata: {} } };
      if (!o.noProduct) answer.product = { product_id: product, name: 'Product' };
      return reply(201, answer);
    }
    if (path === '/licenses/validate') {
      if (o.validateStatus) return reply(o.validateStatus, { code: 'X' });
      return reply(200, { valid: o.invalid ? false : active.get(body.license_key_instance_id) === body.license_key });
    }
    if (path === '/licenses/deactivate') {
      if (o.deactivateStatus) return reply(o.deactivateStatus, { code: 'X' });
      active.delete(body.license_key_instance_id);
      return reply(200, undefined);
    }
    return reply(404, {});
  }
  return { fetch: fetch, calls: calls, active: active, options: o, seats: (key) => Array.from(active.values()).filter((k) => k === key).length };
}

function make(opts) {
  const o = opts || {};
  const s = o.stores || stores();
  const srv = o.server || server();
  let t = o.start || Date.UTC(2026, 10, 12, 10, 0, 0);
  const lic = L.createLicence({ secrets: s.secrets, globalState: s.globalState, fetch: srv.fetch, now: () => t, getMode: () => o.mode || 'live', platform: 'win32' });
  return { lic: lic, s: s, srv: srv, advance: (ms) => { t += ms; }, now: () => t };
}

test('config: allow-list lists exactly the Personal and Business products per environment', () => {
  const ids = { livePersonal: 'pdt_0Nrn49ziRXQQeuqiOIsFX', liveBusiness: 'pdt_0Nrn4FbqyfQSM3RYEI8Oq', testPersonal: 'pdt_0Nrn4yAMoImm329Kmlz9G', testBusiness: 'pdt_0Nrn53sFvU0jPTHvc3Dkc' };
  assert.deepEqual(config.allowedProductIds('test'), [ids.testPersonal, ids.testBusiness]);
  assert.deepEqual(config.allowedProductIds('live'), [ids.livePersonal, ids.liveBusiness]);
  assert.deepEqual(config.allowedProductIds(undefined), config.allowedProductIds('live'), 'the default environment is live');
  assert.equal(config.licenceTypeOf('test', ids.testBusiness), 'business');
  assert.equal(config.licenceTypeOf('live', ids.testPersonal), '', 'a test product never counts in live mode');
  assert.equal(config.licenceTypeOf('test', ids.livePersonal), '', 'a live product never counts in test mode');
  for (const bad of [undefined, null, '', 'PDT_PERSONAL_LIVE', ' ' + ids.livePersonal, ids.livePersonal.toLowerCase(), 42]) assert.equal(config.licenceTypeOf('live', bad), '', String(bad));
  assert.equal(config.mode, 'live');
  assert.equal(config.trialDays, 14);
  assert.equal(config.activationLimit, 3);
  assert.equal(config.maxUsers, 100);
});

test('config: the four product ids are real; placeholder detection stays', () => {
  const pkg = require('../package.json');
  assert.deepEqual(config.placeholderIds(), [], 'no placeholder is left in the configuration');
  assert.equal(config.productIdLive, config.products.live.personal);
  assert.equal(config.productIdTest, config.products.test.personal);
  // The detection itself still works: a placeholder or a malformed id is reported.
  const saved = config.products.live.business;
  try {
    config.products.live.business = 'PDT_BUSINESS_LIVE';
    assert.deepEqual(config.placeholderIds(), ['live business (PDT_BUSINESS_LIVE)']);
    assert.throws(() => config.assertShippable(pkg), /placeholder/);
    config.products.live.business = 'pdt_short';
    assert.equal(config.placeholderIds().length, 1);
  } finally { config.products.live.business = saved; }
  const withSetting = JSON.parse(JSON.stringify(pkg));
  withSetting.contributes.configuration.properties['achAtlas.licenceMode'] = { type: 'string', default: 'live' };
  assert.throws(() => config.assertShippable(withSetting, { allowPlaceholders: true }), /must not offer a licence or environment setting/);
});

test('config: buy links carry the product and the quantity', () => {
  assert.equal(config.buyUrlFor('live', 'personal', 1), 'https://checkout.dodopayments.com/buy/pdt_0Nrn49ziRXQQeuqiOIsFX?quantity=1');
  assert.equal(config.buyUrlFor('live', 'business', 7), 'https://checkout.dodopayments.com/buy/pdt_0Nrn4FbqyfQSM3RYEI8Oq?quantity=7');
  assert.equal(config.buyUrlFor('test', 'business', 100), 'https://test.checkout.dodopayments.com/buy/pdt_0Nrn53sFvU0jPTHvc3Dkc?quantity=100');
  for (const bad of [0, 101, 2.5, '3', NaN, -1, undefined]) assert.equal(config.buyUrlFor('live', 'business', bad), '', String(bad));
  assert.equal(config.buyUrlFor('live', 'personal', 50), 'https://checkout.dodopayments.com/buy/pdt_0Nrn49ziRXQQeuqiOIsFX?quantity=1', 'Personal is always one licence');
  assert.equal(config.buyUrlFor('live', 'enterprise', 1), '');
});

test('no network without a key', async () => {
  const m = make();
  assert.equal(await m.lic.isPro(), false);
  const st = await m.lic.status(true);
  assert.equal(st.hasKey, false);
  await m.lic.remove();
  await m.lic.peek();
  assert.equal(m.srv.calls.length, 0);
});

test('activation stores key, instance and product; never the customer block', async () => {
  const m = make();
  const r = await m.lic.activate('  KEY-PERSONAL  ');
  assert.deepEqual(r, { ok: true, licenceType: 'personal' });
  assert.equal(m.srv.calls[0].body.name, 'VS Code on Windows');
  assert.deepEqual(Object.keys(m.srv.calls[0].body).sort(), ['license_key', 'name']);
  assert.equal(m.s.secretsMap.get('licence.key.live'), 'KEY-PERSONAL');
  assert.equal(m.s.globalMap.get('licence.productId.live'), config.products.live.personal);
  const written = JSON.stringify(m.s.writes);
  assert.ok(!/buyer@example\.com|Test Buyer|cus_1|bus_1|lic_1/.test(written), 'customer details must not be stored');
  assert.equal(await m.lic.isPro(), true);
  const st = await m.lic.status(false);
  assert.equal(st.licenceType, 'personal');
  assert.equal(st.keyHint, '...ONAL');
});

test('a Business key activates as Business; each environment accepts its own products only', async () => {
  const m = make();
  assert.deepEqual(await m.lic.activate('KEY-BUSINESS'), { ok: true, licenceType: 'business' });
  assert.match(messages.activatedText('business', {}), /Business licence.*pass the key on to a colleague/);
  assert.equal(m.srv.calls[0].url, 'https://live.dodopayments.com/licenses/activate');
  assert.deepEqual(await make().lic.activate('KEY-TEST-P'), { ok: false, reason: 'product', released: true }, 'a test-product key in the live environment is refused');
  const test = make({ mode: 'test' });
  assert.deepEqual(await test.lic.activate('KEY-TEST-B'), { ok: true, licenceType: 'business' });
  assert.equal(test.srv.calls[0].url, 'https://test.dodopayments.com/licenses/activate');
  assert.deepEqual(await make({ mode: 'test' }).lic.activate('KEY-PERSONAL'), { ok: false, reason: 'product', released: true }, 'a live-product key in the test environment is refused');
});

test('a key of another product is refused and its activation released', async () => {
  const m = make();
  const r = await m.lic.activate('KEY-OTHER');
  assert.deepEqual(r, { ok: false, reason: 'product', released: true });
  assert.equal(m.srv.calls[1].url, 'https://live.dodopayments.com/licenses/deactivate');
  assert.equal(m.srv.active.size, 0);
  assert.equal(m.s.secretsMap.size, 0);
  assert.equal(await m.lic.isPro(), false);
  assert.match(messages.activationFailureText(r), /another product.*released again and nothing was stored/);
  const unconfirmed = make({ server: server({ deactivateStatus: 500 }) });
  const r2 = await unconfirmed.lic.activate('KEY-OTHER');
  assert.equal(r2.released, false);
  assert.match(messages.activationFailureText(r2), /could not be released/);
});

test('an answer without a product is refused as unverified and released', async () => {
  const m = make({ server: server({ noProduct: true }) });
  assert.deepEqual(await m.lic.activate('KEY-PERSONAL'), { ok: false, reason: 'unverified', released: true });
  assert.equal(m.srv.active.size, 0);
});

test('secret storage failure releases the seat and stores nothing', async () => {
  const s = stores({ failStore: true });
  const m = make({ stores: s });
  assert.deepEqual(await m.lic.activate('KEY-PERSONAL'), { ok: false, reason: 'storage', released: true });
  assert.equal(m.srv.active.size, 0, 'the activation must be given back');
  assert.equal(s.globalMap.has('licence.instanceId.live'), false);
  assert.equal(s.globalMap.has('licence.productId.live'), false);
  assert.match(messages.activationFailureText({ reason: 'storage', released: true }), /released again/);
});

test('seats: entering the same key again uses no further activation', async () => {
  const m = make();
  await m.lic.activate('KEY-PERSONAL');
  for (let k = 0; k < 4; k++) {
    const r = await m.lic.activate('KEY-PERSONAL');
    assert.deepEqual(r, { ok: true, licenceType: 'personal', already: true });
  }
  assert.equal(m.srv.seats('KEY-PERSONAL'), 1);
  assert.match(messages.activatedText('personal', { already: true }), /no further activation was used/);
});

test('seats: replacing a key releases the old activation after the new one is stored', async () => {
  const m = make();
  await m.lic.activate('KEY-PERSONAL');
  const r = await m.lic.activate('KEY-BUSINESS');
  assert.deepEqual(r, { ok: true, licenceType: 'business', replaced: true, previousReleased: true });
  assert.equal(m.srv.seats('KEY-PERSONAL'), 0);
  assert.equal(m.srv.seats('KEY-BUSINESS'), 1);
  assert.equal(m.s.secretsMap.get('licence.key.live'), 'KEY-BUSINESS');
  const urls = m.srv.calls.map((c) => c.url.replace(/^.*\/licenses\//, ''));
  assert.deepEqual(urls, ['activate', 'activate', 'deactivate'], 'the old activation is released only after the new key is active');
  assert.match(messages.activatedText('business', r), /stored before was released/);
});

test('seats: an editor that keeps secrets only in memory does not lose a seat on every restart', async () => {
  const srv = server();
  const s = stores();
  const first = make({ stores: s, server: srv });
  await first.lic.activate('KEY-PERSONAL');
  s.options.memoryOnly = true; // after a restart the key is gone, the activation id is still stored
  const again = make({ stores: s, server: srv });
  assert.equal(await again.lic.isPro(), false);
  const r = await again.lic.activate('KEY-PERSONAL');
  assert.deepEqual(r, { ok: true, licenceType: 'personal', already: true });
  assert.equal(srv.seats('KEY-PERSONAL'), 1);
});

test('seats: a stored activation that the server no longer knows is replaced, not added to', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  srv.active.clear();
  const r = await m.lic.activate('KEY-PERSONAL');
  assert.deepEqual(r, { ok: true, licenceType: 'personal' });
  assert.equal(srv.seats('KEY-PERSONAL'), 1);
});

test('seats: no clear answer from the server changes nothing', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  srv.options.validateStatus = 500;
  assert.deepEqual(await m.lic.activate('KEY-PERSONAL'), { ok: false, reason: 'error', status: 500 });
  assert.equal(srv.seats('KEY-PERSONAL'), 1);
  srv.options.validateStatus = 0;
  srv.options.down = true;
  assert.deepEqual(await m.lic.activate('KEY-PERSONAL'), { ok: false, reason: 'network' });
});

test('seats: the activation limit leaves a stored licence alone', async () => {
  const srv = server({ limit: 1 });
  await make({ server: srv }).lic.activate('KEY-BUSINESS');
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  const r = await m.lic.activate('KEY-BUSINESS');
  assert.deepEqual(r, { ok: false, reason: 'limit', hasStored: true });
  assert.equal(m.s.secretsMap.get('licence.key.live'), 'KEY-PERSONAL');
  assert.match(messages.activationFailureText(r), /maximum number of computers \(3\).*already stored on this computer was not changed/);
});

test('activation errors map to reasons', async () => {
  assert.equal((await make({ server: server({ status: 422 }) }).lic.activate('KEY-PERSONAL')).reason, 'limit');
  assert.equal((await make({ server: server({ status: 403 }) }).lic.activate('KEY-PERSONAL')).reason, 'inactive');
  assert.equal((await make({ server: server({ status: 400 }) }).lic.activate('KEY-PERSONAL')).reason, 'invalid');
  assert.equal((await make({ server: server({ status: 500 }) }).lic.activate('KEY-PERSONAL')).reason, 'error');
  assert.equal((await make({ server: server({ down: true }) }).lic.activate('KEY-PERSONAL')).reason, 'network');
  assert.equal((await make().lic.activate('NO-SUCH-KEY')).reason, 'invalid');
  for (const bad of ['', '   ', 'two words', 'x'.repeat(257), null, 42]) assert.equal((await make().lic.activate(bad)).reason, 'invalid');
});

test('24 hour cache, revalidation, grace period and expiry', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  const after = srv.calls.length;
  assert.equal(await m.lic.isPro(), true);
  assert.equal(srv.calls.length, after, 'trusted from the cache');
  m.advance(25 * HOUR);
  assert.equal(await m.lic.isPro(), true);
  assert.ok(srv.calls[srv.calls.length - 1].url.endsWith('/licenses/validate'));
  srv.options.down = true;
  m.advance(25 * HOUR);
  assert.equal(await m.lic.isPro(), true, 'grace while offline');
  const st = await m.lic.status(false);
  assert.equal(st.via, 'grace');
  assert.match(messages.licenceStatusText(st), /offline mode/);
  m.advance(14 * DAY);
  assert.equal(await m.lic.isPro(), false, 'grace ends after 14 days');
  srv.options.down = false;
  m.advance(6 * 60 * 1000);
  assert.equal(await m.lic.isPro(), true, 'Pro returns when the server answers again');
});

test('concurrent checks share one request; odd answers count as an outage', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  m.advance(25 * HOUR);
  const before = srv.calls.length;
  assert.deepEqual(await Promise.all([m.lic.isPro(), m.lic.isPro(), m.lic.isPro()]), [true, true, true]);
  assert.equal(srv.calls.length, before + 1);
  m.advance(25 * HOUR);
  srv.options.validateStatus = 429;
  assert.equal(await m.lic.isPro(), true, 'grace');
  assert.equal((await m.lic.status(false)).via, 'grace');
});

test('revoked key turns Pro off at once; a running trial is still named', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.startTrial();
  await m.lic.activate('KEY-PERSONAL');
  srv.options.invalid = true;
  const st = await m.lic.status(true);
  assert.equal(st.pro, false);
  assert.equal(st.via, 'rejected');
  assert.equal(await m.lic.hasAccess(), true, 'the trial still runs');
  assert.match(messages.licenceStatusText(st), /no longer valid.*does not unlock Pro.*stay on through your trial/);
});

test('peek reads the stored state without any request', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  const before = srv.calls.length;
  assert.equal((await m.lic.peek()).via, 'cache');
  m.advance(30 * HOUR);
  assert.equal((await m.lic.peek()).via, 'stale');
  assert.equal(srv.calls.length, before);
});

test('remove frees the activation and clears everything but the trial', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.startTrial();
  await m.lic.activate('KEY-PERSONAL');
  assert.deepEqual(await m.lic.remove(), { ok: true, deactivated: true });
  assert.equal(srv.active.size, 0);
  assert.equal(m.s.secretsMap.size, 0);
  assert.deepEqual(Array.from(m.s.globalMap.keys()).filter((k) => k.startsWith('licence.')), []);
  assert.equal(m.lic.trialStatus().state, 'active', 'the trial record stays');
});

test('remove while offline still clears the key and says so', async () => {
  const srv = server();
  const m = make({ server: srv });
  await m.lic.activate('KEY-PERSONAL');
  srv.options.down = true;
  assert.deepEqual(await m.lic.remove(), { ok: true, deactivated: false });
  assert.equal(m.s.secretsMap.size, 0);
});

test('trial: unused, started at the first Pro use, 14 days, reminders once a day, no network', async () => {
  const m = make();
  assert.equal(m.lic.trialStatus().state, 'unused');
  assert.equal(await m.lic.hasAccess(), false);
  const t = await m.lic.startTrial();
  assert.equal(t.state, 'active');
  assert.equal(t.daysLeft, 14);
  assert.equal(await m.lic.hasAccess(), true);
  assert.equal(await m.lic.noteTrialReminder(), true);
  assert.equal(await m.lic.noteTrialReminder(), false);
  m.advance(DAY + 1);
  assert.equal(await m.lic.noteTrialReminder(), true);
  assert.equal(m.lic.trialStatus().daysLeft, 13);
  m.advance(13 * DAY);
  assert.equal(m.lic.trialStatus().state, 'expired');
  assert.equal(await m.lic.hasAccess(), false);
  assert.equal((await m.lic.startTrial()).state, 'expired', 'never restarts');
  assert.equal(m.srv.calls.length, 0, 'the trial uses no network');
});

test('trial: a clock set back does not stretch it; a start in the future does not end it', async () => {
  const m = make();
  await m.lic.startTrial();
  m.advance(10 * DAY);
  await m.lic.touchTrial();
  m.advance(-9 * DAY);
  assert.equal(m.lic.trialStatus().daysLeft, 4);
  const f = make();
  f.s.globalMap.set('trial.startedAt', f.now() + 1000 * DAY);
  assert.deepEqual([f.lic.trialStatus().state, f.lic.trialStatus().daysLeft], ['active', 14], 'a start in the future (the clock was ahead, or the record was edited) does not end the trial: no used time is known, so it counts from now');
  await f.lic.touchTrial();
  assert.ok(f.s.globalMap.get('trial.startedAt') <= f.now(), 'the stored start is written again');
  f.advance(15 * DAY);
  assert.equal(f.lic.trialStatus().state, 'expired', 'and it ends 14 days after now, not 1000 days later');
});

test('trial: storage that cannot be written gives "unavailable" and the notice explains it', async () => {
  const m = make({ stores: stores({ readOnly: true }) });
  const t = await m.lic.startTrial();
  assert.equal(t.state, 'unavailable');
  assert.match(messages.proNoticeText('Create Test File', t), /could not be started/);
});

test('messages: status texts name the trial, the prices and the environment', () => {
  const base = { pro: false, hasKey: false, mode: 'live', trial: { state: 'unused' } };
  assert.match(messages.licenceStatusText(base), /free 14-day trial/);
  assert.ok(!/test environment/.test(messages.licenceStatusText(base)));
  assert.ok(!/test environment/.test(messages.licenceStatusText(Object.assign({}, base, { mode: 'test' }))), 'the status text has no wording for a test environment');
  assert.match(messages.licenceStatusText(Object.assign({}, base, { trial: { state: 'active', daysLeft: 1, endsAt: Date.now() } })), /1 day left/);
  assert.match(messages.licenceStatusText(Object.assign({}, base, { trial: { state: 'expired', endsAt: Date.now() } })), /USD 29.*USD 59 per user/);
  assert.match(messages.licenceStatusText({ pro: false, hasKey: true, via: 'product', keyHint: '...ABCD', mode: 'live' }), /belongs to another product/);
  assert.match(messages.proNoticeText('Compare With Another File', { state: 'expired', endsAt: Date.now() }), /^Compare With Another File is an ACH Atlas Pro feature\. Your 14-day trial ended/);
});

test('messages: buy choices and the users question', () => {
  const c = messages.buyChoices();
  assert.deepEqual(c.map((x) => x.tier), ['personal', 'business']);
  assert.match(c[0].description, /USD 29/);
  assert.match(c[1].description, /USD 59 per user/);
  assert.equal(messages.businessUsersQuestion(), 'How many users? (1-100)');
  for (const ok of ['1', '42', ' 100 ', '007']) assert.equal(messages.businessUsersError(ok), null, ok);
  for (const bad of ['0', '101', '1.5', 'ten', '', '-3', '1e2', '+5', '0x10', '1 000', '９', undefined]) assert.ok(messages.businessUsersError(bad), String(bad));
});

test('messages: every failure reason has an actionable sentence', () => {
  for (const reason of ['limit', 'invalid', 'inactive', 'network', 'product', 'unverified', 'storage', 'error']) {
    const t = messages.activationFailureText({ reason: reason, status: 500 });
    assert.ok(t.length > 40, reason);
  }
  assert.match(messages.activationFailureText({ reason: 'network' }), /live\.dodopayments\.com/);
  assert.match(messages.activationFailureText({ reason: 'storage', kept: true }), /nothing was changed/);
  assert.match(messages.lostKeyText(), /Dodo Payments/);
});
