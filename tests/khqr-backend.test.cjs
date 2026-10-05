/* eslint-disable @typescript-eslint/no-require-imports -- Isolated node:test harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const load = loader({}, { AbortController });
const { createMockKhqrProvider } = load('lib/khqr/provider.ts');
const { createMockKhqrService } = load('lib/khqr/service.ts');
const { KhqrError } = load('lib/khqr/contracts.ts');
const { getTrustedSubscriptionQuote } = load('lib/subscription/plan-catalog.ts');
const now = 1790985600000;
const context = { businessId: 'workspace-one', memberId: 'member-one' };
const selection = { planCode: 'mini', billingCycle: 'monthly', renewSame: false, customUpgrade: false };
const id = 'khqr_mock_intent_0001';
function fixture(options = {}) {
  let intent;
  let savedKey;
  let savedSelection;
  let clock = now;
  const effects = { creates: 0, activations: 0, invoices: 0, inquiries: 0, observations: 0 };
  const hashes = new Set();
  const facade = {
    environment: 'mock',
    async prepareIntent(ctx, pick, key, generate) {
      if (options.blocked) throw new KhqrError('KHQR_BILLING_CONFLICT', 409, 'Another payment requires review.');
      if (intent) {
        if (key !== savedKey || JSON.stringify(pick) !== savedSelection) throw new KhqrError('KHQR_IDEMPOTENCY_CONFLICT', 409, 'Idempotency key conflict.');
        return intent;
      }
      // Reuse the actual shared catalog; this fixture does not model upgrades.
      const quote = getTrustedSubscriptionQuote(pick);
      if (!quote) throw new KhqrError('KHQR_QUOTE_INVALID', 400, 'Invalid quote.');
      const seed = { id, businessId: ctx.businessId, memberId: ctx.memberId, environment: 'mock', recipient: 'synthetic@mock', currency: 'USD', amountMinor: quote.totalCents,
        expiresAtMs: now + 300000, baseline: 'subscription-v1', state: 'pending', planCode: pick.planCode, billingCycle: pick.billingCycle, invoiceId: null };
      const generated = generate(seed);
      intent = { ...seed, payload: generated.payload, qrMd5: generated.md5 };
      savedKey = key; savedSelection = JSON.stringify(pick); effects.creates++;
      return intent;
    },
    async getIntent(ctx, requested) { return requested === id && ctx.businessId === intent?.businessId ? intent : null; },
    async observe(ctx, requested, decision) {
      assert.equal(ctx.businessId, intent.businessId); assert.equal(requested, id);
      effects.observations++;
      if (intent.state === 'pending' && decision.state === 'recovery_required') intent = { ...intent, state: 'recovery_required' };
      return intent;
    },
    async activateVerified(ctx, requested, proof) {
      assert.equal(ctx.businessId, intent.businessId); assert.equal(requested, id);
      assert.equal(proof.requestedMd5, intent.qrMd5);
      if (intent.state === 'approved') return intent;
      if (options.stale || proof.observedAtMs >= intent.expiresAtMs || hashes.has(proof.transactionHash)) {
        intent = { ...intent, state: 'recovery_required' }; return intent;
      }
      if (options.invoiceFailure) throw new Error('Synthetic invoice rollback');
      hashes.add(proof.transactionHash); effects.activations++; effects.invoices++;
      intent = { ...intent, state: 'approved', invoiceId: 'mock-invoice' }; return intent;
    },
  };
  const provider = createMockKhqrProvider(async request => {
    effects.inquiries++;
    assert.equal(request.md5, intent.qrMd5);
    if (options.throwTransport) throw new Error('Synthetic transport error');
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (options.response) return options.response;
    return { httpStatus: 200, body: { responseCode: 0, errorCode: null, data: { hash: 'b'.repeat(64), toAccountId: intent.recipient, currency: 'USD', amount: String(intent.amountMinor / 100) } } };
  }, options.timeout || 2000);
  const service = createMockKhqrService(facade, provider, () => clock);
  return { facade, provider, service, effects, setClock: value => { clock = value; }, getIntent: () => intent,
    checkout: (pick = selection, key = 'mock_idempotency_0001') => service.checkout(context, pick, key) };
}

test('mock intent uses shared quote, nonpayable payload, and stable idempotency', async () => {
  const f = fixture();
  const first = await f.checkout(); const again = await f.checkout();
  assert.equal(first.amountMinor, getTrustedSubscriptionQuote(selection).totalCents);
  assert.equal(first.payable, false); assert.match(first.mockPayload, /^TENH-NONPAYABLE-MOCK:/);
  assert.equal(first.intentId, again.intentId); assert.equal(f.effects.creates, 1);
  await assert.rejects(f.checkout({ ...selection, planCode: 'pro' }), error => error.code === 'KHQR_IDEMPOTENCY_CONFLICT');
});
test('equal amount/time intents generate distinct payload and digest', () => {
  const provider = createMockKhqrProvider(async () => ({ httpStatus: 503, body: null }));
  const seed = { id: 'one', recipient: 'synthetic@mock', amountMinor: 1300, currency: 'USD', expiresAtMs: now };
  const one = provider.generate(seed), two = provider.generate({ ...seed, id: 'two' });
  assert.notEqual(one.payload, two.payload); assert.notEqual(one.md5, two.md5);
});
test('authoritative mocked status delegates activation/invoice once', async () => {
  const f = fixture({ delay: 5 }); await f.checkout();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.service.status(context, id)));
  assert.ok(responses.every(result => result.state === 'approved' && result.mockPayload === null));
  assert.equal(f.effects.inquiries, 1); assert.equal(f.effects.activations, 1); assert.equal(f.effects.invoices, 1);
  await f.service.status(context, id); assert.equal(f.effects.inquiries, 1);
});
test('cross-workspace status fails before provider inquiry', async () => {
  const f = fixture(); await f.checkout();
  await assert.rejects(f.service.status({ ...context, businessId: 'other' }, id), error => error.code === 'KHQR_NOT_FOUND');
  assert.equal(f.effects.inquiries, 0);
});
test('incorrect facade intent identity fails before inquiry', async () => {
  const f = fixture(); await f.checkout();
  f.facade.getIntent = async () => ({ ...f.getIntent(), id: 'other_intent_same_workspace' });
  await assert.rejects(f.service.status(context, id), error => error.code === 'KHQR_NOT_FOUND');
  assert.equal(f.effects.inquiries, 0);
});
test('transport cannot overwrite server lookup binding', async () => {
  const f = fixture(); await f.checkout();
  const i = f.getIntent();
  const provider = createMockKhqrProvider(async () => ({ environment: 'production', requestedMd5: 'wrong', httpStatus: 200,
    body: { responseCode: 0, data: { hash: 'b'.repeat(64), toAccountId: i.recipient, currency: 'USD', amount: i.amountMinor / 100 } } }));
  assert.equal((await provider.verify(i, () => now)).state, 'verified');
});
test('facade conflict prevents QR presentation/creation', async () => {
  const f = fixture({ blocked: true });
  await assert.rejects(f.checkout(), error => error.code === 'KHQR_BILLING_CONFLICT');
  assert.equal(f.effects.creates, 0);
});
test('expired success is retained for recovery without activation', async () => {
  const f = fixture(); await f.checkout(); f.setClock(now + 300000);
  const status = await f.service.status(context, id);
  assert.equal(status.state, 'recovery_required'); assert.equal(status.mockPayload, null); assert.equal(f.effects.activations, 0);
});
test('stale shared subscription baseline delegates to recovery', async () => {
  const f = fixture({ stale: true }); await f.checkout();
  assert.equal((await f.service.status(context, id)).state, 'recovery_required'); assert.equal(f.effects.activations, 0);
});
test('transport timeout and failure remain pending and clear inquiry for retry', async () => {
  for (const options of [{ delay: 20, timeout: 1 }, { throwTransport: true }]) {
    const f = fixture(options); await f.checkout();
    assert.equal((await f.service.status(context, id)).state, 'pending');
    assert.equal((await f.service.status(context, id)).state, 'pending');
    assert.equal(f.effects.inquiries, 2); assert.equal(f.effects.activations, 0);
  }
});
test('invoice failure surfaces without fake approved response', async () => {
  const f = fixture({ invoiceFailure: true }); await f.checkout();
  await assert.rejects(f.service.status(context, id), /invoice rollback/);
  assert.equal(f.getIntent().state, 'pending'); assert.equal(f.effects.activations, 0); assert.equal(f.effects.invoices, 0);
});
test('mock parser rejects recipient mismatch and missing current-contract evidence', async () => {
  for (const data of [{ hash: 'b'.repeat(64), toAccountId: 'other', currency: 'USD', amount: 13 }, { transactionStatus: 'PAID' }]) {
    const f = fixture({ response: { httpStatus: 200, body: { responseCode: 0, data } } }); await f.checkout();
    assert.equal((await f.service.status(context, id)).state, 'recovery_required'); assert.equal(f.effects.activations, 0);
  }
});
test('configuration never enables an unapproved environment', () => {
  const { getKhqrReadiness } = load('lib/khqr/config.ts');
  for (const value of [undefined, 'mock', 'sit', 'production', 'guess']) {
    const readiness = getKhqrReadiness(value);
    assert.equal(readiness.enabled, false); assert.equal(readiness.liveEnabled, false);
  }
});

function routes(options = {}) {
  const strictCalls = [];
  const backend = fixture(options.backend || {});
  const routeLoad = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth/get-current-member': { getCurrentMember: async strict => {
      strictCalls.push(strict); return options.denied ? { success: false, status: 401, error: 'Unauthorized' } : { success: true, member: { id: context.memberId, business_id: context.businessId } };
    } },
    '@/lib/auth/require-permission': { memberHasPermission: async (_member, key, level) => {
      assert.equal(key, 'billing'); assert.equal(level, 'manage'); return !options.permissionDenied;
    } },
    // Override runtime only; real routes and real HTTP parsing are exercised.
    './runtime': { getKhqrRuntime: () => ({ readiness: { provider: 'khqr', enabled: false, liveEnabled: false }, service: options.disabled ? null : backend.service }) },
    './contracts': { KhqrError },
  }, { AbortController });
  const checkout = routeLoad('app/api/khqr/checkout/route.ts').POST;
  const status = routeLoad('app/api/khqr/status/route.ts').POST;
  const readiness = routeLoad('app/api/khqr/readiness/route.ts').GET;
  const req = (body, key = 'mock_idempotency_0001') => new Request('https://example.invalid/api/khqr/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
  const body = { purchaseBusinessId: context.businessId, ...selection };
  return { backend, checkout, status, readiness, req, body, strictCalls };
}
test('real checkout/status routes traverse mocked backend with no-store', async () => {
  const r = routes(); const created = await r.checkout(r.req(r.body));
  assert.equal(created.status, 200); assert.match(created.headers.get('cache-control'), /no-store/);
  const payment = (await created.json()).payment;
  const result = await r.status(r.req({ purchaseBusinessId: context.businessId, intentId: payment.intentId }));
  assert.equal(result.status, 200); assert.equal((await result.json()).payment.state, 'approved');
  assert.ok(r.strictCalls.every(Boolean));
});
test('unauthenticated, forbidden and disabled routes have zero billing effects', async () => {
  for (const [options, code] of [[{ denied: true }, 401], [{ permissionDenied: true }, 403], [{ disabled: true }, 503]]) {
    const r = routes(options); assert.equal((await r.checkout(r.req(r.body))).status, code);
    assert.equal(r.backend.effects.creates, 0); assert.equal(r.backend.effects.inquiries, 0);
  }
});
test('workspace mismatch, secret/proof/amount injection and missing idempotency are rejected', async () => {
  const cases = [ [{ purchaseBusinessId: 'other' }, 409], [{ amount: 1 }, 400], [{ recipient: 'other' }, 400], [{ token: 'synthetic' }, 400], [{ paid: true }, 400], [{ md5: 'a'.repeat(32) }, 400], [{ users: '1' }, 400] ];
  for (const [patch, code] of cases) {
    const r = routes(); assert.equal((await r.checkout(r.req({ ...r.body, ...patch }))).status, code); assert.equal(r.backend.effects.creates, 0);
  }
  const r = routes(); assert.equal((await r.checkout(r.req(r.body, ''))).status, 400);
});
test('status never accepts browser-supplied approval/hash or other workspace', async () => {
  const r = routes(); await r.checkout(r.req(r.body));
  for (const patch of [{ hash: 'b'.repeat(64) }, { success: true }]) assert.equal((await r.status(r.req({ purchaseBusinessId: context.businessId, intentId: id, ...patch }))).status, 400);
  assert.equal((await r.status(r.req({ purchaseBusinessId: 'other', intentId: id }))).status, 409);
  assert.equal(r.backend.effects.inquiries, 0);
});
test('route errors redact internal facade/transport messages', async () => {
  const r = routes({ backend: { invoiceFailure: true } }); await r.checkout(r.req(r.body));
  const response = await r.status(r.req({ purchaseBusinessId: context.businessId, intentId: id }));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /invoice rollback|synthetic@mock/);
});
test('real runtime exposes readiness and cannot select a financial facade', async () => {
  assert.equal(load('lib/khqr/runtime.ts').getKhqrRuntime().service, null);
  const r = routes({ disabled: true });
  const response = await r.readiness(new Request('https://example.invalid/api/khqr/readiness'));
  assert.equal(response.status, 200); assert.equal((await response.json()).liveEnabled, false);
});
