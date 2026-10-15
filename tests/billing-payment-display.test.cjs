/* eslint-disable @typescript-eslint/no-require-imports -- Existing node:test TypeScript loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./tenh-seven/harness.cjs');
const display = loader()('lib/billing/payment-display.ts');
const { paymentProvenance: provenance } = display;

function payment(overrides = {}) {
  return {
    id: 'payment-1', business_id: 'workspace-1', provider: 'payway',
    provider_transaction_id: 'transaction-1', amount: '12.30', currency: 'USD',
    status: 'approved', verified_at: '2026-10-01T12:00:00Z',
    provider_status: 'APPROVED', provider_status_code: '0', provider_original_amount: '12.30',
    provider_payment_amount: 49200, provider_payment_currency: 'KHR',
    metadata: { environment: 'production', live_enabled: true }, ...overrides,
  };
}
function payload() {
  return {
    status: { code: '00', tran_id: 'transaction-1' },
    data: { payment_status: 'APPROVED', payment_status_code: 0, original_amount: 12.30, original_currency: 'USD',
      transaction_id: 'transaction-1', private_payer: 'must not leave server' },
  };
}
function invoice(row = payment(), overrides = {}) {
  return {
    business_id: row.business_id, source_type: row.provider, provider: row.provider,
    source_payment_id: row.id, source_transaction_id: row.provider_transaction_id,
    amount: row.amount, currency: row.currency, status: 'paid',
    snapshot: { provider_status: row.provider_status, provider_status_code: row.provider_status_code,
      provider_original_amount: row.provider_original_amount, provider_payment_amount: row.provider_payment_amount,
      provider_payment_currency: row.provider_payment_currency }, ...overrides,
  };
}
function observation(overrides = {}) {
  return { checked_at: '2026-10-01T12:01:00Z', provider_status_code: '00', provider_transaction_id: 'transaction-1',
    payment_status: 'APPROVED', payment_status_code: 0, original_amount: 12.30, ...overrides };
}
function unconfirmed(result, environment = 'unknown') {
  assert.equal(result.environment, environment);
  assert.equal(result.confirmedPaid, false);
  assert.equal(result.providerVerified, false);
}

test('production approval accepts saved direct columns and optional corroborating private payload', () => {
  for (const raw of [undefined, payload()]) {
    const row = payment();
    if (raw) row.metadata.payway_verified_payload = raw;
    assert.deepEqual({ ...provenance('payway', row, invoice(row)) }, {
      provider: 'payway', environment: 'production', providerVerified: true, confirmedPaid: true,
    });
  }
});

test('environment uses saved metadata only and test approvals never count as real paid', () => {
  const sandbox = payment({ metadata: { environment: 'sandbox', live_enabled: false } });
  assert.deepEqual({ ...provenance('payway', sandbox) }, {
    provider: 'payway', environment: 'sandbox', providerVerified: true, confirmedPaid: false,
  });
  for (const metadata of [undefined, null, [], {}, { environment: null }, { environment: 'PRODUCTION' }, { live_enabled: true }]) {
    const result = provenance('payway', payment({ metadata }));
    assert.equal(result.environment, 'unknown');
    assert.equal(result.confirmedPaid, false);
  }
  for (const metadata of [
    { environment: 'sandbox', live_enabled: true }, { environment: 'production', live_enabled: false },
    { environment: 'production', live_enabled: null }, { environment: 'production', live_enabled: 'true' },
  ]) unconfirmed(provenance('payway', payment({ metadata })));
  assert.equal(provenance('payway', payment({ metadata: { environment: 'production' } })).confirmedPaid, true);
});

test('invoice source, provider, workspace, reference and amount must match saved source', () => {
  for (const change of [
    { source_type: 'manual' }, { provider: 'manual' }, { provider: null }, { source_payment_id: 'another' },
    { business_id: 'another' }, { source_transaction_id: 'another' }, { source_transaction_id: null },
    { amount: 12.31 }, { amount: null }, { currency: 'KHR' }, { currency: null }, { status: 'void' },
  ]) unconfirmed(provenance('payway', payment(), invoice(payment(), change)));
  for (const change of [{ id: null }, { business_id: null }, { provider: 'manual' }, { provider_transaction_id: '' }]) {
    unconfirmed(provenance('payway', payment(change)));
  }
  unconfirmed(provenance('other', payment()));
  unconfirmed(provenance('payway', null));
});

test('supplied invoice snapshot environment and provider evidence cannot contradict its source', () => {
  for (const snapshot of [
    null, [], { environment: 'sandbox' }, { environment: null }, { live_enabled: false },
    { metadata: null }, { metadata: [] }, { metadata: { environment: 'sandbox' } },
    { metadata: { live_enabled: false } }, { metadata: { provider: 'manual' } },
    { source_type: 'manual' }, { source_payment_id: 'other' }, { business_id: 'other' },
    { provider_status: 'DECLINED' }, { provider_status: null },
    { provider_status_code: '00' }, { provider_original_amount: 12.31 }, { provider_original_amount: null },
    { provider_payment_amount: 12.30 }, { provider_payment_currency: 'USD' },
  ]) unconfirmed(provenance('payway', payment(), invoice(payment(), { snapshot })));
  assert.equal(provenance('payway', payment(), invoice(payment(), {
    snapshot: { environment: 'production', metadata: { environment: 'production', live_enabled: true } },
  })).confirmedPaid, true);
});

test('present raw verified payload must be complete, matched and approved', () => {
  const invalid = [null, [], {}, { status: null, data: null }];
  for (const [part, key, value] of [
    ['status', 'code', '0'], ['status', 'tran_id', 'other'], ['status', 'tran_id', null],
    ['data', 'payment_status', 'DECLINED'], ['data', 'payment_status_code', null],
    ['data', 'payment_status_code', false], ['data', 'payment_status_code', 1],
    ['data', 'original_amount', null], ['data', 'original_amount', 12.31],
    ['data', 'original_currency', 'KHR'], ['data', 'transaction_id', 'other'],
    ['data', 'payment_amount', 12.30], ['data', 'payment_currency', 'USD'],
  ]) {
    const raw = payload(); raw[part][key] = value; invalid.push(raw);
  }
  for (const raw of invalid) {
    const row = payment(); row.metadata.payway_verified_payload = raw;
    unconfirmed(provenance('payway', row));
  }
});

test('money confirmation requires matching positive integer cents and trusted USD purchase currency', () => {
  for (const amount of [0, -1, null, '', false, 'not-money', '0x0c', '1e1', Infinity, 0.001, 12.301, Number.MAX_SAFE_INTEGER]) {
    const result = provenance('payway', payment({ amount, provider_original_amount: amount }));
    assert.equal(result.providerVerified, false);
    assert.equal(result.confirmedPaid, false);
  }
  for (const amount of [0.01, 0.1, 0.29, '12.30', '12.3000']) {
    assert.equal(provenance('payway', payment({ amount, provider_original_amount: amount })).confirmedPaid, true);
  }
  for (const change of [
    { currency: 'KHR' }, { provider_original_amount: null }, { provider_original_amount: 12.31 },
    { verified_at: null }, { verified_at: 'invalid' }, { provider_status: null },
    { provider_status: 'DECLINED' }, { provider_status_code: '00' }, { provider_status_code: null },
  ]) {
    const result = provenance('payway', payment(change));
    assert.equal(result.providerVerified, false);
    assert.equal(result.confirmedPaid, false);
  }
});

test('new conflicting observations downgrade approval while older pending observations remain historical', () => {
  for (const saved of [null, {}, observation({ payment_status: 'PENDING' }), observation({ payment_status_code: null }),
    observation({ original_amount: null }), observation({ conflict_reason: 'MISMATCH' }),
    observation({ provider_transaction_id: 'other' }), observation({ checked_at: null, payment_status: 'DECLINED' })]) {
    const row = payment(); row.metadata.payway_last_verification = saved;
    unconfirmed(provenance('payway', row));
  }
  const row = payment();
  row.metadata.payway_last_verification = observation({ checked_at: '2026-10-01T11:59:00Z', payment_status: 'PENDING' });
  assert.equal(provenance('payway', row).confirmedPaid, true);
  row.metadata.payway_last_verification = observation();
  assert.equal(provenance('payway', row).confirmedPaid, true);
});

test('manual approval uses source identity and never claims provider verification', () => {
  const row = { id: 'manual-1', business_id: 'workspace-1', status: 'approved', amount: 12.30, currency: 'USD' };
  const document = { source_type: 'manual', provider: 'manual', source_payment_id: row.id,
    business_id: row.business_id, source_transaction_id: 'saved TENH reference', amount: row.amount, currency: 'USD', status: 'paid' };
  assert.deepEqual({ ...provenance('manual', row, document) }, {
    provider: 'manual', environment: 'manual', providerVerified: false, confirmedPaid: true,
  });
  for (const change of [{ source_type: 'payway' }, { provider: 'payway' }, { business_id: 'other' }, { amount: 13 }]) {
    unconfirmed(provenance('manual', row, { ...document, ...change }));
  }
  unconfirmed(provenance('manual', row, { ...document, snapshot: { metadata: { environment: 'sandbox' } } }));
  for (const status of ['draft', 'pending', 'submitted', 'rejected', 'cancelled', 'recovery_required']) {
    assert.equal(provenance('manual', { ...row, status }).confirmedPaid, false);
  }
});

test('labels distinguish every supported state in English and Khmer', () => {
  const labels = { draft: 'Draft', submitted: 'Payment pending.', pending: 'Payment pending.', declined: 'Declined',
    rejected: 'Rejected', cancelled: 'Cancelled', canceled: 'Cancelled', failed: 'Failed', recovery_required: 'Needs review' };
  for (const [status, english] of Object.entries(labels)) {
    const row = { status, environment: 'production', confirmedPaid: false };
    assert.equal(display.paymentStatusLabel(row), english);
    assert.match(display.paymentStatusLabel(row, true), /[\u1780-\u17ff]/);
    assert.equal(display.paymentVerificationLabel({ ...row, provider: 'payway', providerVerified: false }), english);
  }
  assert.equal(display.paymentStatusLabel({ status: 'approved', environment: 'sandbox', confirmedPaid: false }), 'Test payment');
  assert.equal(display.paymentStatusLabel({ status: 'approved', environment: 'production', confirmedPaid: true }), 'Paid');
  assert.equal(display.paymentStatusLabel({ status: 'approved', environment: 'unknown', confirmedPaid: false }), 'Approved · unverified');
  assert.equal(display.paymentStatusLabel({ status: 'mystery', environment: 'unknown', confirmedPaid: false }), 'Unknown status');
});

test('provenance returns only public classification and has no runtime configuration dependency', () => {
  const row = payment(); row.metadata.payway_verified_payload = payload();
  const result = provenance('payway', row, invoice(row));
  assert.deepEqual(Object.keys(result).sort(), ['confirmedPaid', 'environment', 'provider', 'providerVerified']);
  assert.equal(JSON.stringify(result).includes('must not leave server'), false);
  assert.doesNotMatch(fs.readFileSync('lib/billing/payment-display.ts', 'utf8'), /process\.env|payway\/config|supabase|fetch\(/);
});
