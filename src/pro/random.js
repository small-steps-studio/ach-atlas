'use strict';
// A small seeded random number source (mulberry32), so that a run with the same seed gives the
// same result. Used for invented test data and replacement values, never for anything secret.

function createRandom(seed) {
  let a = (Number(seed) >>> 0) || 0x9E3779B9;
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next: next,
    /** Integer from min to max inclusive (both safe integers). */
    int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
    /** BigInt from min to max inclusive. */
    big: function (min, max) {
      const span = max - min + 1n;
      let v = 0n;
      const parts = Math.ceil(span.toString(2).length / 30) + 1;
      for (let k = 0; k < parts; k++) v = (v << 30n) + BigInt(Math.floor(next() * 1073741824));
      return min + (v % span);
    },
    digit: function () { return String(Math.floor(next() * 10)); },
    letter: function () { return String.fromCharCode(65 + Math.floor(next() * 26)); },
    pick: function (list) { return list[Math.floor(next() * list.length)]; }
  };
}

module.exports = { createRandom: createRandom };
