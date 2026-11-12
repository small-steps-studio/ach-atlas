'use strict';
// Keyed replacement values for Anonymise. Everything here is derived from one secret key of at least
// 128 bits (256 by default, drawn from the system's random source for every run, kept only in memory,
// never shown, stored or logged), with HMAC-SHA256 as the only primitive:
//
//   * permute(kind, value): a keyed permutation of the letters and digits of a value that keeps its
//     shape (digits stay digits, letters stay letters in their case, everything else stays). It is a
//     Feistel network over the positions of the value: in each round one half of the positions gets
//     a pseudo-random value added (digit by digit, modulo 10 or 26) that HMAC-SHA256 computes from
//     the other half, the round number and the shape. Such a network is a bijection, so two different
//     values of the same shape never get the same replacement, no table of the values is needed, and
//     the same value gets the same replacement for as long as the key lives. Where the number of
//     possible values is small (at most one million) the permutation is turned into one without a
//     fixed point, so that such a value is always replaced by another one. A value with a single
//     letter or digit has no halves to mix, so it is replaced through a keyed cycle through all the
//     digits (or all the letters): a random single cycle, different for every key.
//   * a random stream (int, big, digit, letter) for everything that has no original to follow: new
//     routing numbers, new amounts, shifted dates, replacement free text. It is HMAC-SHA256 of a
//     counter, used as a keystream.
//
// Without the key the copy tells nothing about the original except which values were equal (and the
// parts that Anonymise keeps on purpose). With the key, or with the seed of a reproducible test run,
// anyone can compute the same replacements again: a seed is for tests only and is not reachable from
// any command.

const crypto = require('node:crypto');

const ROUNDS = 4;
const SMALL_DOMAIN = 1000000;
const MIN_KEY_BYTES = 16;

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

/** The master key from the options: a given key (Buffer, at least 16 bytes), a seed of a test run, or 32 random bytes. */
function masterKey(options) {
  const o = options || {};
  if (o.key !== undefined && o.key !== null) {
    const key = Buffer.isBuffer(o.key) ? o.key : Buffer.from(o.key);
    if (key.length < MIN_KEY_BYTES) throw new Error('The anonymisation key must have at least ' + MIN_KEY_BYTES + ' bytes.');
    return key;
  }
  if (o.seed !== undefined && o.seed !== null) return crypto.createHash('sha256').update('seed:' + String(o.seed)).digest();
  return crypto.randomBytes(32);
}

function createStream(streamKey) {
  const counter = Buffer.alloc(8);
  let n = 0;
  let block = null;
  let pos = 32;
  function refill() {
    counter.writeUInt32BE(Math.floor(n / 4294967296), 0);
    counter.writeUInt32BE(n % 4294967296, 4);
    n++;
    block = hmac(streamKey, counter);
    pos = 0;
  }
  function byte() {
    if (pos >= 32) refill();
    return block[pos++];
  }
  function u32() { return ((byte() * 16777216) + (byte() << 16) + (byte() << 8) + byte()); }
  return {
    /** Integer from min to max inclusive (a span of at most 2^32). */
    int: function (min, max) {
      const span = max - min + 1;
      if (!(span >= 1 && span <= 4294967296)) throw new RangeError('span out of range');
      if (span === 4294967296) return min + u32();
      const limit = 4294967296 - (4294967296 % span);
      let v = u32();
      while (v >= limit) v = u32();
      return min + (v % span);
    },
    /** BigInt from min to max inclusive. */
    big: function (min, max) {
      const span = max - min + 1n;
      const bits = span.toString(2).length;
      const bytes = Math.ceil(bits / 8);
      const mask = (1n << BigInt(bits)) - 1n;
      for (;;) {
        let hex = '';
        for (let k = 0; k < bytes; k++) hex += (byte() + 256).toString(16).slice(1);
        const v = BigInt('0x' + hex) & mask;
        if (v < span) return min + v;
      }
    },
    /** Character code of a random digit. */
    digit: function () { let b = byte(); while (b >= 250) b = byte(); return 48 + (b % 10); },
    /** Index 0-25 of a random letter. */
    letter: function () { let b = byte(); while (b >= 234) b = byte(); return b % 26; }
  };
}

function createPermuter(permKey) {
  const keys = new Map();
  function keyOf(kind) {
    let k = keys.get(kind);
    if (!k) { k = crypto.createSecretKey(hmac(permKey, 'kind:' + kind)); keys.set(kind, k); }
    return k;
  }

  // The replacement of a value with one letter or digit: the digits (or letters) are put in a key-dependent
  // random order (Fisher-Yates driven by HMAC-SHA256) and each one is replaced by the next one in that
  // order, the last by the first. That is a single cycle: no fixed point, a bijection, and which digit
  // follows which depends on the key (a plain "add one" would be the same for every key).
  const cycles = new Map();
  function cycleOf(kind, radix) {
    const id = kind + ':' + radix;
    let next = cycles.get(id);
    if (next) return next;
    const key = keyOf(kind);
    const order = [];
    for (let i = 0; i < radix; i++) order.push(i);
    let pool = Buffer.alloc(0);
    let at = 0;
    let block = 0;
    const draw = function () {
      if (at + 4 > pool.length) { pool = crypto.createHmac('sha256', key).update(Buffer.from([255, radix, block++])).digest(); at = 0; }
      const v = pool.readUInt32BE(at);
      at += 4;
      return v;
    };
    for (let i = radix - 1; i > 0; i--) {
      const j = draw() % (i + 1);
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    next = new Uint8Array(radix);
    for (let i = 0; i < radix; i++) next[order[i]] = order[(i + 1) % radix];
    cycles.set(id, next);
    return next;
  }

  // Adds (sign 1) or subtracts (sign -1) the round value to the digits of the target half.
  function round(key, r, dig, rad, n, u, sign, msg) {
    const targetA = r % 2 === 0;
    const from = targetA ? 0 : u;
    const to = targetA ? u : n;
    if (from === to) return;
    msg[0] = r;
    msg[1] = n;
    for (let j = 0; j < n; j++) {
      const inTarget = j >= from && j < to;
      msg[2 + j] = (rad[j] === 26 ? 128 : 0) | (inTarget ? 0 : dig[j]);
    }
    let h = null;
    for (let j = from; j < to; j++) {
      const t = j - from;
      if (t % 10 === 0) { msg[n + 2] = t / 10; h = crypto.createHmac('sha256', key).update(msg).digest(); }
      const o = 3 * (t % 10);
      const add = ((h[o] << 16) | (h[o + 1] << 8) | h[o + 2]) % rad[j];
      dig[j] = sign > 0 ? (dig[j] + add) % rad[j] : (dig[j] - add + rad[j]) % rad[j];
    }
  }
  function encrypt(key, dig, rad, n, u, msg) { for (let r = 0; r < ROUNDS; r++) round(key, r, dig, rad, n, u, 1, msg); }
  function decrypt(key, dig, rad, n, u, msg) { for (let r = ROUNDS - 1; r >= 0; r--) round(key, r, dig, rad, n, u, -1, msg); }

  /** `value` with every digit and letter replaced (shape kept); the value itself when it has none. */
  function permute(kind, value) {
    const len = value.length;
    const at = [];
    for (let k = 0; k < len; k++) {
      const c = value.charCodeAt(k);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) at.push(k);
    }
    const n = at.length;
    if (n === 0) return value;
    const dig = new Uint8Array(n);
    const rad = new Uint8Array(n);
    const base = new Uint8Array(n);
    let size = 1;
    for (let j = 0; j < n; j++) {
      const c = value.charCodeAt(at[j]);
      if (c <= 57) { base[j] = 48; rad[j] = 10; } else if (c <= 90) { base[j] = 65; rad[j] = 26; } else { base[j] = 97; rad[j] = 26; }
      dig[j] = c - base[j];
      if (size <= SMALL_DOMAIN) size *= rad[j];
    }
    const u = n >> 1;
    const key = keyOf(kind);
    const msg = Buffer.alloc(n + 3);
    if (n === 1) {
      dig[0] = cycleOf(kind, rad[0])[dig[0]];
    } else {
      if (size <= SMALL_DOMAIN) {
      // f(f^-1(x) + 1): a permutation with no fixed point, because adding one has none.
        decrypt(key, dig, rad, n, u, msg);
        for (let j = n - 1; j >= 0; j--) { dig[j]++; if (dig[j] < rad[j]) break; dig[j] = 0; }
      }
      encrypt(key, dig, rad, n, u, msg);
    }
    const codes = new Array(len);
    for (let k = 0; k < len; k++) codes[k] = value.charCodeAt(k);
    for (let j = 0; j < n; j++) codes[at[j]] = base[j] + dig[j];
    return String.fromCharCode.apply(null, codes);
  }
  return { permute: permute };
}

/** { random, permute, reproducible } for one run. */
function createKeyed(options) {
  const master = masterKey(options);
  const streamKey = crypto.createSecretKey(hmac(master, 'stream'));
  const permuter = createPermuter(hmac(master, 'permutation'));
  return { random: createStream(streamKey), permute: permuter.permute };
}

module.exports = { createKeyed: createKeyed, ROUNDS: ROUNDS, MIN_KEY_BYTES: MIN_KEY_BYTES };
