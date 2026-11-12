'use strict';
// A stand-in "test" licence environment for the unit tests. The package knows the live
// environment only (see src/licence/config.js); a test that needs a second environment registers
// this one. This file is not part of the package.

const config = require('../../src/licence/config');

const TEST_ENVIRONMENT = Object.freeze({
  api: 'https://test.dodopayments.com',
  checkoutBase: 'https://test.checkout.dodopayments.com/buy/'
});

/** Registers the stand-in environment in the config module of the current process. */
function register() { config.registerTestEnvironment(TEST_ENVIRONMENT); }

module.exports = { register: register, TEST_ENVIRONMENT: TEST_ENVIRONMENT };
