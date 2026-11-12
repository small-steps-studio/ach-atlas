'use strict';
// Stored state written by hand, broken on disk or from another environment must never unlock Pro
// by mistake, never throw and never block the free features.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/licence/licence');

function make(initial, secret) {
  const global = new Map(Object.entries(initial || {}));
  const secrets = new Map(Object.entries(secret || {}));
  const calls = [];
  const lic = L.createLicence({
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { if (v === undefined) global.delete(k); else global.set(k, v); } },
    fetch: async (url) => { calls.push(url); return { status: 200, json: async () => ({ valid: true }) }; },
    now: () => Date.UTC(2026, 10, 12)
  });
  return { lic: lic, calls: calls, global: global };
}

test('the installed default environment is live', async () => {
  const m = make({ 'licence.instanceId.live': 'lki_1', 'licence.productId.live': 'pdt_0Nrn49ziRXQQeuqiOIsFX' }, { 'licence.key.live': 'K' });
  assert.equal(await m.lic.isPro(), true);
  assert.ok(m.calls[0].startsWith('https://live.dodopayments.com/'));
});

test('a stored activation without a product id does not unlock Pro (no earlier version existed)', async () => {
  const m = make({ 'licence.instanceId.live': 'lki_1' }, { 'licence.key.live': 'SOME-KEY' });
  assert.equal(await m.lic.isPro(), false);
  const st = await m.lic.status(true);
  assert.equal(st.via, 'product');
  assert.equal(m.calls.length, 0, 'no request for a key that cannot count');
});

test('a stored product id of another product does not unlock Pro', async () => {
  const m = make({ 'licence.instanceId.live': 'lki_1', 'licence.productId.live': 'pdt_SomethingElse001' }, { 'licence.key.live': 'K' });
  assert.equal(await m.lic.isPro(), false);
});

test('a test-environment licence never counts in the live environment', async () => {
  const m = make({ 'licence.instanceId.test': 'lki_1', 'licence.productId.test': 'pdt_0Nrn4yAMoImm329Kmlz9G' }, { 'licence.key.test': 'K' });
  assert.equal(await m.lic.isPro(), false);
});

test('wrong types in stored values are ignored', async () => {
  for (const bad of [null, 42, {}, [], 'text', NaN, Infinity, -1]) {
    const m = make({ 'trial.startedAt': bad, 'trial.lastSeenAt': bad, 'licence.instanceId.live': bad, 'licence.checkedAt.live': bad, 'licence.productId.live': bad }, {});
    const t = m.lic.trialStatus();
    assert.ok(['unused', 'active', 'expired'].indexOf(t.state) !== -1, String(bad));
    assert.equal(await m.lic.isPro(), false);
  }
});

test('a cached check from the future (clock moved back) is asked again', async () => {
  const now = Date.UTC(2026, 10, 12);
  const m = make({ 'licence.instanceId.live': 'lki_1', 'licence.productId.live': 'pdt_0Nrn4FbqyfQSM3RYEI8Oq', 'licence.checkedAt.live': now + 10 * 86400000, 'licence.checkedValid.live': true }, { 'licence.key.live': 'K' });
  assert.equal(await m.lic.isPro(), true);
  assert.equal(m.calls.length, 1);
});
