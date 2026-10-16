/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { loader } = require('./tenh-seven/harness.cjs');
const load = loader({ 'server-only': {} }, { process, TextDecoder });
const { getBakongConfig } = load('lib/bakong/config.ts');
const { generateBakongQr, parseBakongResponse, checkBakongTransaction, QR_LIFETIME_MS } = load('lib/bakong/provider.ts');
const { decimalMinorUnits } = load('lib/bakong/money.ts');
const { BakongKHQR } = require('bakong-khqr');
const { paymentProvenance, paymentMethodLabel, paymentVerificationLabel } = load('lib/billing/payment-display.ts');
const config = { token: 'synthetic-secret-not-real', fingerprint: 'f'.repeat(64), accountId: 'merchant@devb', merchantName: 'TENH CHAT',
  accountType: 'merchant',
  merchantCity: 'Phnom Penh', merchantId: '12345', acquiringBank: 'DEV BANK', environment: 'sandbox',
  baseUrl: 'https://sit-api-bakong.nbc.gov.kh', dailyBudget: 90, checkoutRequested: true };
const expected = { md5: 'd'.repeat(32), recipient: config.accountId, amount: '9.99', environment: 'production' };
const success = () => ({ responseCode: 0, errorCode: null, data: { hash: 'a'.repeat(64), toAccountId: config.accountId, currency: 'USD', amount: 9.99 } });

test('official pinned merchant SDK emits a unique exact-amount dynamic QR with millisecond expiry', () => {
  const now = Date.now(), one = generateBakongQr(config, randomUUID(), 999, now), two = generateBakongQr(config, randomUUID(), 999, now);
  const decoded = BakongKHQR.decode(one.qr).data;
  assert.equal(QR_LIFETIME_MS, 15 * 60 * 1000);
  assert.equal(one.expiresAt, new Date(now + 900000).toISOString());
  assert.equal(decoded.merchantType, '30'); assert.equal(decoded.bakongAccountID, config.accountId);
  assert.equal(decoded.transactionAmount, '9.99'); assert.equal(decoded.transactionCurrency, '840');
  assert.equal(decoded.billNumber, one.reference); assert.ok(one.reference.length <= 25);
  assert.equal(decoded.expirationTimestamp, String(now + QR_LIFETIME_MS));
  assert.equal(decoded.expirationTimestamp.length, 13); assert.notEqual(one.md5, two.md5);
  assert.throws(() => generateBakongQr(config, randomUUID(), 0));
  assert.throws(() => generateBakongQr(config, randomUUID(), 9007199254740991));
  assert.throws(() => generateBakongQr(config, 'forged-id', 999));
});

test('individual accounts generate dynamic USD KHQR without a merchant ID or acquiring bank', () => {
  const values = { BAKONG_ENVIRONMENT: 'sandbox', BAKONG_API_BASE_URL: config.baseUrl, BAKONG_ACCOUNT_TYPE: 'individual',
    BAKONG_API_CONTRACT: 'v1-md5', BAKONG_API_TOKEN: config.token, BAKONG_ACCOUNT_ID: 'individual@devb',
    BAKONG_MERCHANT_ID: '', BAKONG_MERCHANT_NAME: 'Individual payee', BAKONG_MERCHANT_CITY: 'Phnom Penh',
    BAKONG_ACQUIRING_BANK: '', BAKONG_CHECKOUT_ENABLED: 'false' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const individual = getBakongConfig();
    assert.ok(individual, 'individual configuration is supported without merchant-only fields');
    assert.equal(individual.accountType, 'individual'); assert.equal(individual.checkoutRequested, false);
    assert.notEqual(individual.fingerprint, createHash('sha256').update(config.token).digest('hex'), 'merchant capacity approval cannot enable individual checkout');
    const now = Date.now(), generated = generateBakongQr(individual, randomUUID(), 1300, now);
    const decoded = BakongKHQR.decode(generated.qr).data;
    assert.equal(decoded.merchantType, '29'); assert.equal(decoded.bakongAccountID, 'individual@devb');
    assert.equal(decoded.merchantName, 'Individual payee'); assert.equal(decoded.transactionCurrency, '840');
    assert.equal(decimalMinorUnits(decoded.transactionAmount, 'USD'), BigInt(1300)); assert.equal(decoded.billNumber, generated.reference);
    assert.equal(decoded.expirationTimestamp, String(now + QR_LIFETIME_MS));
    assert.equal(decoded.merchantID ?? decoded.merchantId ?? null, null);
    process.env.BAKONG_MERCHANT_NAME = ''; assert.equal(getBakongConfig(), null);
    process.env.BAKONG_MERCHANT_NAME = values.BAKONG_MERCHANT_NAME;
    process.env.BAKONG_ACQUIRING_BANK = 'X'.repeat(33); assert.equal(getBakongConfig(), null);
    process.env.BAKONG_ACQUIRING_BANK = 'DEV BANK';
    const withBank = BakongKHQR.decode(generateBakongQr(getBakongConfig(), randomUUID(), 1300).qr).data;
    assert.equal(withBank.acquiringBank, 'DEV BANK');
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('configuration requires explicit contract, environment, merchant fields and server secret; account ID alone never enables', () => {
  const values = { BAKONG_ENVIRONMENT: 'sandbox', BAKONG_API_BASE_URL: config.baseUrl, BAKONG_ACCOUNT_TYPE: 'merchant',
    BAKONG_API_CONTRACT: 'v1-md5', BAKONG_API_TOKEN: config.token, BAKONG_ACCOUNT_ID: config.accountId,
    BAKONG_MERCHANT_ID: config.merchantId, BAKONG_MERCHANT_NAME: config.merchantName, BAKONG_MERCHANT_CITY: config.merchantCity,
    BAKONG_ACQUIRING_BANK: config.acquiringBank, BAKONG_CHECKOUT_ENABLED: 'false', BAKONG_DAILY_REQUEST_BUDGET: '90' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values); assert.equal(getBakongConfig().checkoutRequested, false);
    for (const [key, value] of [['BAKONG_API_TOKEN', ''], ['BAKONG_API_BASE_URL', 'https://attacker.invalid'],
      ['BAKONG_ENVIRONMENT', 'production'], ['BAKONG_ACCOUNT_TYPE', 'unknown'], ['BAKONG_API_CONTRACT', 'guessed-v2'],
      ['BAKONG_MERCHANT_NAME', 'X'.repeat(26)], ['BAKONG_DAILY_REQUEST_BUDGET', '1.5'], ['BAKONG_MERCHANT_ID', '']]) {
      process.env[key] = value; assert.equal(getBakongConfig(), null, key); process.env[key] = values[key];
    }
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('decimal verification rejects fractional cents, conversion, malformed money and every mismatched settlement field', () => {
  assert.equal(decimalMinorUnits('9.9900', 'USD'), BigInt(999));
  assert.equal(decimalMinorUnits('1000', 'KHR'), BigInt(1000));
  for (const value of ['9.991', '-1', '+9.99', '1e3', '09.99', '', NaN, Infinity, 0.1 + 0.2]) assert.equal(decimalMinorUnits(value, 'USD'), null);
  assert.equal(decimalMinorUnits('1000.5', 'KHR'), null);
  assert.equal(parseBakongResponse(success(), expected).state, 'paid');
  for (const [key, value] of [['toAccountId', 'another@bank'], ['currency', 'KHR'], ['amount', '10.00'], ['amount', '9.9901'], ['md5', 'e'.repeat(32)]]) {
    const response = success(); response.data[key] = value; assert.equal(parseBakongResponse(response, expected).state, 'mismatch', key);
  }
  for (const value of [null, [], {}, { responseCode: 0, data: null }, { responseCode: 0, data: { ...success().data, hash: 'short-hash' } }, { ...success(), responseCode: '0' }]) assert.equal(parseBakongResponse(value, expected).state, 'unresolved');
  assert.equal(parseBakongResponse({ responseCode: 1, errorCode: 1, data: null }, expected).state, 'pending');
});

test('verification makes exactly one authenticated server request, honors rate limits and never treats transport errors as unpaid/paid', async () => {
  let calls = 0;
  const paid = await checkBakongTransaction(config, expected, async (url, init) => {
    calls++; assert.equal(url, config.baseUrl + '/v1/check_transaction_by_md5');
    assert.equal(init.headers.Authorization, 'Bearer ' + config.token);
    assert.deepEqual(JSON.parse(init.body), { md5: expected.md5 }); assert.equal(init.redirect, 'error');
    return Response.json(success());
  });
  assert.equal(calls, 1); assert.equal(paid.state, 'paid'); assert.ok(!JSON.stringify(paid).includes(config.token));
  for (const status of [401, 403, 429, 500, 503]) {
    const result = await checkBakongTransaction(config, expected, async () => new Response('not payment evidence', { status, headers: { 'Retry-After': '7200' } }));
    assert.ok(['credential_error', 'unresolved'].includes(result.state)); if (status === 429) assert.equal(result.retryAfterSeconds, 7200);
  }
  assert.equal((await checkBakongTransaction(config, expected, async () => { throw new Error(config.token); })).state, 'unresolved');
  assert.equal((await checkBakongTransaction(config, expected, async () => new Response('{invalid'))).state, 'unresolved');
});

test('saved Bakong provenance is distinct from ABA/manual; unknown and test records cannot become confirmed production revenue', () => {
  const payment = { id: randomUUID(), business_id: randomUUID(), provider: 'bakong', provider_transaction_id: 'TC-reference', status: 'approved', amount: '9.99', currency: 'USD',
    metadata: { environment: 'production', live_enabled: true, bakong_verification: { ...expected, hash: 'a'.repeat(64), environment: 'production', currency: 'USD' } } };
  const verified = paymentProvenance('bakong', payment);
  assert.equal(verified.provider, 'bakong'); assert.equal(verified.confirmedPaid, true);
  assert.equal(paymentMethodLabel('bakong'), 'Bakong KHQR');
  assert.equal(paymentVerificationLabel({ ...verified, status: 'approved' }), 'Bakong payment verified');
  const sandbox = structuredClone(payment); sandbox.metadata.environment = 'sandbox'; sandbox.metadata.live_enabled = false; sandbox.metadata.bakong_verification.environment = 'sandbox';
  assert.equal(paymentProvenance('bakong', sandbox).confirmedPaid, false);
  const unknown = structuredClone(payment); delete unknown.metadata.environment;
  assert.equal(paymentProvenance('bakong', unknown).environment, 'unknown'); assert.equal(paymentProvenance('bakong', unknown).confirmedPaid, false);
  assert.equal(paymentProvenance('payway', payment).provider, 'unknown');
});
