'use strict';
// Stand-ins for the licence service tests: secret and state stores that can be told to fail, a
// fake of the public licence endpoints with the observed answer shapes, and a clock.
const config = require('../../src/licence/config');
const L = require('../../src/licence/licence');

/** Stores. `failWhen(kind, key, value)` returns true to make that write throw (kind: secret | state). */
function stores(options) {
  const o = options || {};
  const secrets = new Map();
  const global = new Map();
  const writes = [];
  return {
    secretsMap: secrets, globalMap: global, writes: writes, options: o,
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => { if (o.failWhen && o.failWhen('secret', k, v)) throw new Error('no keyring'); writes.push(['secret', k, v]); secrets.set(k, v); },
      delete: async (k) => { secrets.delete(k); }
    },
    globalState: {
      get: (k) => global.get(k),
      update: async (k, v) => { if (o.failWhen && o.failWhen('state', k, v)) throw new Error('read only'); writes.push(['state', k, v]); if (v === undefined) global.delete(k); else global.set(k, v); }
    }
  };
}

/** The public endpoints with the documented answers; `calls` lists every request, `seats(key)` the open activations. */
function server(options) {
  const o = Object.assign({
    keys: {
      'KEY-A': config.products.live.personal, 'KEY-B': config.products.live.business, 'KEY-OTHER': 'pdt_OtherProduct0001'
    }, limit: 3
  }, options || {});
  const calls = [];
  const active = new Map();
  let seq = 0;
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    calls.push({ url: url, body: body });
    if (o.down) throw new Error('offline');
    const path = url.replace(/^https:\/\/[^/]+/, '');
    const reply = function (status, data) { return { status: status, json: async () => { if (data === undefined) throw new Error('no body'); return data; } }; };
    if (path === '/licenses/activate') {
      const product = o.keys[body.license_key];
      if (!product) return reply(404, { code: 'NOT_FOUND' });
      const used = Array.from(active.values()).filter((k) => k === body.license_key).length;
      if (used >= o.limit) return reply(422, { code: 'LIMIT' });
      const id = 'lki_' + (++seq);
      active.set(id, body.license_key);
      return reply(201, { id: id, business_id: 'bus_1', name: body.name, license_key_id: 'lic_1', created_at: '2026-11-12T00:00:00Z', product: { product_id: product, name: 'Product' },
        customer: { customer_id: 'cus_1', name: 'Test Buyer', email: 'buyer@example.com', phone_number: null, metadata: {} } });
    }
    if (path === '/licenses/validate') {
      if (o.validateStatus) return reply(o.validateStatus, { code: 'X' });
      return reply(200, { valid: o.invalid ? false : active.get(body.license_key_instance_id) === body.license_key });
    }
    if (path === '/licenses/deactivate') {
      active.delete(body.license_key_instance_id);
      return reply(200, undefined);
    }
    return reply(404, {});
  }
  return { fetch: fetch, calls: calls, active: active, options: o, seats: (key) => Array.from(active.values()).filter((k) => k === key).length };
}

/** A licence service in the live environment with an injected clock. */
function make(opts) {
  const o = opts || {};
  const s = o.stores || stores();
  const srv = o.server || server();
  let t = o.start || Date.UTC(2026, 10, 12, 10, 0, 0);
  const lic = L.createLicence({ secrets: s.secrets, globalState: s.globalState, fetch: srv.fetch, now: () => t, platform: 'win32' });
  return { lic: lic, s: s, srv: srv, advance: (ms) => { t += ms; }, setClock: (v) => { t = v; }, now: () => t };
}

module.exports = { stores: stores, server: server, make: make, HOUR: 3600 * 1000, DAY: 24 * 3600 * 1000 };
