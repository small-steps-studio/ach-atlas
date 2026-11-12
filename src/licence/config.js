'use strict';
// Licence server settings, product ids, prices, the trial length and the support links: the one
// place where these values live. The extension only talks to the public licence endpoints of the
// payment provider, so no secret key is ever shipped.
//
// ALLOWED_PRODUCT_IDS lists, per environment, the products whose keys unlock Pro. A key of any
// other product of the same seller is refused when it is activated, and the activation made for
// the check is released again.
//
// The installed extension knows the live environment only: this file holds no address of the
// provider's test environment, nothing in the extension reads an environment variable, and no
// setting or command can select another environment. The unit tests register a stand-in "test"
// environment from test/helpers/test-environment.js, a file that is not part of the package. The
// release gate refuses to build a package while any product id is a placeholder, while the
// manifest offers a way to change the environment, or while a shipped file names a test address.

const PRODUCTS = {
  live: { personal: 'pdt_0Nrn49ziRXQQeuqiOIsFX', business: 'pdt_0Nrn4FbqyfQSM3RYEI8Oq' },
  test: { personal: 'pdt_0Nrn4yAMoImm329Kmlz9G', business: 'pdt_0Nrn53sFvU0jPTHvc3Dkc' }
};

const ALLOWED_PRODUCT_IDS = Object.freeze({
  live: Object.freeze([PRODUCTS.live.personal, PRODUCTS.live.business]),
  test: Object.freeze([PRODUCTS.test.personal, PRODUCTS.test.business])
});

const PLACEHOLDER_IDS = Object.freeze(['PDT_PERSONAL_LIVE', 'PDT_BUSINESS_LIVE', 'PDT_PERSONAL_TEST', 'PDT_BUSINESS_TEST']);
const PRODUCT_ID = /^pdt_[A-Za-z0-9]{10,60}$/;

const config = {
  productName: 'ACH Atlas',
  commandPrefix: 'achAtlas',
  mode: 'live',
  apiBaseLive: 'https://live.dodopayments.com',
  checkoutBaseLive: 'https://checkout.dodopayments.com/buy/',
  productIdLive: PRODUCTS.live.personal,
  productIdTest: PRODUCTS.test.personal,
  products: PRODUCTS,

  // Length of the free Pro trial in days. Every message, document and test reads this value.
  trialDays: 14,
  // Days a validated licence keeps working while the licence server cannot be reached.
  graceDays: 14,
  // Hours a successful licence check is trusted before the server is asked again.
  cacheHours: 24,
  // Number of computers one key may be active on (set on the payment provider's product).
  activationLimit: 3,
  // One-time prices as shown in messages (the checkout page shows the final amount and taxes).
  priceText: 'USD 29',
  businessPriceText: 'USD 59 per user',
  // Largest number of users the Buy command accepts for one Business checkout.
  maxUsers: 100,
  businessSeatsText: 'One key per user: a purchase for N users gives N keys, each for up to 3 computers.',
  // Name of the payment provider and merchant of record, as shown in licence messages.
  providerName: 'Dodo Payments',

  // Support and documentation links. Never put a personal name or a private address here.
  supportEmail: '',
  issuesUrl: 'https://github.com/small-steps-studio/ach-atlas/issues',
  docsUrl: 'https://github.com/small-steps-studio/ach-atlas#readme',
  repositoryUrl: 'https://github.com/small-steps-studio/ach-atlas'
};

const TIERS = ['personal', 'business'];

// The environments this build knows. Only the live one is part of the package.
const environments = { live: { api: config.apiBaseLive, checkoutBase: config.checkoutBaseLive } };

/**
 * Registers a stand-in environment named "test" (https addresses only). Only the unit tests call
 * this; nothing in the package does, so an installed copy, a development host and every setting
 * or command stay on the live environment.
 */
function registerTestEnvironment(spec) {
  if (!spec || !/^https:\/\//.test(spec.api) || !/^https:\/\//.test(spec.checkoutBase)) throw new Error('a test environment needs https addresses');
  environments.test = { api: spec.api, checkoutBase: spec.checkoutBase };
}

/** The names of the environments known to this process (a shipped build knows "live" only). */
function knownEnvironments() { return Object.keys(environments); }

/** 'test' only when the tests registered that environment; everything else is the built-in mode (live). */
function modeOf(modeOverride) { return (modeOverride === 'live' || (modeOverride === 'test' && environments.test)) ? modeOverride : config.mode; }

/** The environment: { mode, api, buyUrl } (buyUrl is the Personal checkout link). */
function resolve(modeOverride) {
  const mode = modeOf(modeOverride);
  return { mode: mode, api: environments[mode].api, buyUrl: buyUrlFor(mode, 'personal', 1) };
}

/** The product ids whose keys unlock Pro in the given environment. */
function allowedProductIds(modeOverride) { return ALLOWED_PRODUCT_IDS[modeOf(modeOverride)].slice(); }

/** 'personal' or 'business' for a product id of the given environment, or '' for any other id. */
function licenceTypeOf(modeOverride, productId) {
  if (typeof productId !== 'string' || !productId) return '';
  const set = PRODUCTS[modeOf(modeOverride)];
  for (const t of TIERS) if (set[t] === productId) return t;
  return '';
}

/**
 * The checkout link of a tier in the given environment. `users` (1 to maxUsers) is the quantity
 * of a Business purchase; a Personal purchase is always one licence. '' when the input is invalid.
 */
function buyUrlFor(modeOverride, tier, users) {
  const mode = modeOf(modeOverride);
  const set = PRODUCTS[mode];
  const id = set ? set[tier] : undefined;
  if (typeof id !== 'string' || !id) return '';
  let quantity = 1;
  if (tier === 'business') {
    quantity = users;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > config.maxUsers) return '';
  }
  return environments[mode].checkoutBase + id + '?quantity=' + quantity;
}

/** The support contact in one phrase for messages. */
function supportContact() {
  return config.supportEmail ? config.supportEmail + ' or ' + config.issuesUrl : config.issuesUrl;
}

/** The product ids that are still placeholders (the release gate refuses to ship while any is). */
function placeholderIds() {
  const out = [];
  for (const env of ['live', 'test']) for (const t of TIERS) {
    const id = PRODUCTS[env][t];
    if (PLACEHOLDER_IDS.indexOf(id) !== -1 || !PRODUCT_ID.test(id)) out.push(env + ' ' + t + ' (' + id + ')');
  }
  return out;
}

/**
 * Throws when this build must not be published. `options.allowPlaceholders` skips only the
 * placeholder product id rule (for a local test package that is never uploaded).
 */
function assertShippable(manifest, options) {
  const problems = [];
  const opts = options || {};
  const props = manifest && manifest.contributes && manifest.contributes.configuration && manifest.contributes.configuration.properties;
  if (config.mode !== 'live') problems.push('the built-in licence mode must be live');
  if (knownEnvironments().join(',') !== 'live') problems.push('a build for publishing knows the live environment only');
  if (props) for (const key of Object.keys(props)) if (/licen[cs]e|mode|environment/i.test(key)) problems.push('the manifest must not offer a licence or environment setting (' + key + ')');
  if (!/^https:\/\//.test(config.apiBaseLive)) problems.push('licence API base URL must be https');
  if (config.apiBaseLive !== 'https://live.dodopayments.com') problems.push('the live licence host must be live.dodopayments.com');
  if (config.checkoutBaseLive !== 'https://checkout.dodopayments.com/buy/') problems.push('the live checkout base is wrong');
  if (!/^https:\/\//.test(config.issuesUrl) || !/^https:\/\//.test(config.docsUrl)) problems.push('support links must be https URLs');
  if (PRODUCTS.live.personal === PRODUCTS.live.business || PRODUCTS.test.personal === PRODUCTS.test.business) problems.push('the Personal and Business products must be different');
  if (PRODUCTS.live.personal === PRODUCTS.test.personal || PRODUCTS.live.business === PRODUCTS.test.business) problems.push('live and test product ids must differ');
  if (config.productIdLive !== PRODUCTS.live.personal || config.productIdTest !== PRODUCTS.test.personal) problems.push('productIdLive/productIdTest must be the Personal products');
  if (!opts.allowPlaceholders) {
    const ph = placeholderIds();
    if (ph.length) problems.push('product ids are still placeholders: ' + ph.join(', '));
  }
  if (!(config.trialDays >= 1 && config.trialDays <= 90)) problems.push('trialDays must be between 1 and 90');
  if (problems.length) throw new Error('Refusing to build: ' + problems.join('; '));
  return true;
}

module.exports = Object.assign(config, {
  resolve: resolve, allowedProductIds: allowedProductIds, licenceTypeOf: licenceTypeOf, buyUrlFor: buyUrlFor, supportContact: supportContact,
  placeholderIds: placeholderIds, assertShippable: assertShippable, registerTestEnvironment: registerTestEnvironment, knownEnvironments: knownEnvironments,
  ALLOWED_PRODUCT_IDS: ALLOWED_PRODUCT_IDS, PLACEHOLDER_IDS: PLACEHOLDER_IDS, TIERS: TIERS
});
