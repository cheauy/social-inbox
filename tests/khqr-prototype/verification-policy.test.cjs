/* eslint-disable @typescript-eslint/no-require-imports -- Isolated node:test prototype. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../lib/khqr/verification-policy.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const isolated = { exports: {} };
vm.runInNewContext(code, { exports: isolated.exports, module: isolated });
const { amountToMinor, evaluateMockLookup } = isolated.exports;
const now = 1790985600000;
const md5 = 'a'.repeat(32);
const hash = 'b'.repeat(64);
function intent(changes = {}) {
  return { id: 'mock-one', businessId: 'workspace-one', environment: 'mock', recipient: 'synthetic@mock', currency: 'USD', amountMinor: 1200, qrMd5: md5, expiresAtMs: now + 300000, baseline: 'subscription-v1', state: 'pending', ...changes };
}
function lookup(dataChanges = {}, changes = {}) {
  return { environment: 'mock', requestedMd5: md5, httpStatus: 200, body: { responseCode: 0, errorCode: null, data: { hash, toAccountId: 'synthetic@mock', currency: 'USD', amount: '12.00', ...dataChanges } }, ...changes };
}
function decision(i = intent(), l = lookup(), at = now) { return evaluateMockLookup(i, l, at); }

test('strict amounts preserve cents and reject rounding/exponents/unsafe values', () => {
  for (const input of ['12.00', '12', 12, '12.000']) assert.equal(amountToMinor(input, 'USD'), 1200);
  for (const input of ['12.001', '1e2', '-12', '', ' 12', null, true, '9007199254740992']) assert.equal(amountToMinor(input, 'USD'), null);
  assert.equal(amountToMinor('1200.00', 'KHR'), 1200);
  assert.equal(amountToMinor('1200.01', 'KHR'), null);
});
test('matching server lookup verifies payment', () => assert.equal(decision().state, 'verified'));
for (const [label, i, l, reason] of [
  ['recipient', intent(), lookup({ toAccountId: 'other@mock' }), 'RECIPIENT_MISMATCH'],
  ['currency', intent(), lookup({ currency: 'KHR' }), 'CURRENCY_MISMATCH'],
  ['amount', intent(), lookup({ amount: '12.01' }), 'AMOUNT_MISMATCH'],
  ['fraction', intent(), lookup({ amount: '12.001' }), 'AMOUNT_MISMATCH'],
  ['hash', intent(), lookup({ hash: 'short' }), 'TRANSACTION_HASH_MISSING'],
  ['lookup binding', intent(), lookup({}, { requestedMd5: 'c'.repeat(32) }), 'LOOKUP_BINDING_MISMATCH'],
  ['environment', intent(), lookup({}, { environment: 'production' }), 'ENVIRONMENT_UNCONFIRMED'],
  ['provider failure', intent(), lookup({}, { body: { responseCode: 1, errorCode: 3, data: null } }), 'INQUIRY_NOT_VERIFIED'],
  ['contradictory success', intent(), lookup({}, { body: { responseCode: 0, errorCode: 3, data: null } }), 'INQUIRY_NOT_VERIFIED'],
  ['review hold', intent({ state: 'recovery_required' }), lookup(), 'EXISTING_REVIEW_HOLD'],
]) test(`conflicting ${label} preserves recovery`, () => {
  const result = decision(i, l);
  assert.equal(result.state, 'recovery_required');
  assert.equal(result.reason, reason);
});
test('not found stays pending; expired not found holds recovery', () => {
  const missing = lookup({}, { body: { responseCode: 1, errorCode: 1, data: null } });
  assert.equal(decision(intent(), missing).state, 'pending');
  assert.equal(decision(intent(), missing, now + 300000).reason, 'EXPIRED_UNRECONCILED');
});
test('late success does not activate; exact expiry is late', () => {
  assert.equal(decision(intent(), lookup(), now + 299999).state, 'verified');
  assert.equal(decision(intent(), lookup(), now + 300000).reason, 'LATE_SUCCESS_REQUIRES_RECONCILIATION');
});
test('timeouts/auth/rate limiting/malformed responses cannot approve or cancel', () => {
  for (const httpStatus of [401, 403, 429, 500]) assert.equal(decision(intent(), lookup({}, { httpStatus })).state, 'pending');
  for (const body of [null, [], 'success', { responseCode: '0' }, { responseCode: 0, data: null }]) assert.notEqual(decision(intent(), lookup({}, { body })).state, 'verified');
});
test('cancelled account never reactivates; approved intent is idempotent', () => {
  assert.equal(decision(intent({ state: 'cancelled' })).state, 'cancelled');
  assert.equal(decision(intent({ state: 'approved' })).state, 'already_approved');
});
test('inquiry outages never downgrade an existing review hold', () => {
  for (const httpStatus of [200, 401, 429, 500]) {
    assert.equal(decision(intent({ state: 'recovery_required' }), lookup({}, { httpStatus })).reason, 'EXISTING_REVIEW_HOLD');
  }
});
test('equal amount intents are separated by server lookup identity', () => {
  const second = intent({ id: 'mock-two', qrMd5: 'c'.repeat(32) });
  assert.equal(decision(second).reason, 'LOOKUP_BINDING_MISMATCH');
  assert.equal(decision(second, lookup({}, { requestedMd5: second.qrMd5 })).state, 'verified');
});

// Synchronous commit models one atomic database transaction. This is a model,
// not a PostgreSQL lock/isolation test or a runtime subscription implementation.
function ledger() {
  let state = { intents: new Map(), hashes: new Map(), active: new Map(), invoices: new Map(), baseline: 'subscription-v1', activations: 0 };
  return {
    snapshot: () => state,
    setBaseline: baseline => { state.baseline = baseline; },
    commit(i, proof, failInvoice = false) {
      if (state.intents.has(i.id)) return 'already_approved';
      if (proof.state !== 'verified') return 'unverified';
      if (state.hashes.has(proof.transactionHash)) return 'replay';
      if (state.active.has(i.businessId) || state.baseline !== i.baseline) return 'baseline_changed';
      const next = structuredClone(state);
      next.hashes.set(proof.transactionHash, i.id);
      next.intents.set(i.id, 'approved');
      next.active.set(i.businessId, i.id);
      next.activations++;
      if (failInvoice) throw new Error('mock invoice failure');
      next.invoices.set(i.id, 'paid');
      state = next;
      return 'approved';
    },
  };
}
test('parallel verification completions activate and invoice once', async () => {
  const db = ledger();
  const results = await Promise.all(Array.from({ length: 12 }, async () => db.commit(intent(), decision())));
  assert.equal(results.filter(x => x === 'approved').length, 1);
  assert.equal(db.snapshot().activations, 1);
  assert.equal(db.snapshot().invoices.size, 1);
});
test('same full hash cannot credit two workspaces, even at equal amounts', () => {
  const db = ledger();
  assert.equal(db.commit(intent(), decision()), 'approved');
  const other = intent({ id: 'mock-two', businessId: 'workspace-two', qrMd5: 'c'.repeat(32) });
  assert.equal(db.commit(other, decision(other, lookup({}, { requestedMd5: other.qrMd5 }))), 'replay');
  assert.equal(db.snapshot().activations, 1);
});
test('competing provider/subscription baseline requires recovery', () => {
  const db = ledger();
  db.setBaseline('manual-payment-activated');
  assert.equal(db.commit(intent(), decision()), 'baseline_changed');
  assert.equal(db.snapshot().activations, 0);
});
test('invoice failure rolls back hash claim, approval and entitlement together', () => {
  const db = ledger();
  assert.throws(() => db.commit(intent(), decision(), true), /invoice failure/);
  assert.equal(db.snapshot().hashes.size, 0);
  assert.equal(db.snapshot().intents.size, 0);
  assert.equal(db.snapshot().activations, 0);
  assert.equal(db.snapshot().invoices.size, 0);
  assert.equal(db.commit(intent(), decision()), 'approved');
});
