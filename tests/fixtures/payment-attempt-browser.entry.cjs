/* eslint-disable @typescript-eslint/no-require-imports -- Offline real React payment regression. */
const React = require('react');
const { createRoot } = require('react-dom/client');
const { flushSync } = require('react-dom');
const { PaymentAttemptView } = require('../../components/subscription/payment-attempt-view.tsx');
const { BuySubscriptionView } = require('../../components/subscription/buy-subscription-view.tsx');
const { SubscriptionPaymentView } = require('../../components/subscription/subscription-payment-view.tsx');
const h = React.createElement;
const nativeTimeout = window.setTimeout.bind(window);
const pause = ms => new Promise(resolve => nativeTimeout(resolve, ms));
window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay >= 3000 && delay <= 30000 && !(delay === 30000 && window.fixtureBuyPreflight) ? 120 : delay, ...args);
const businessA = '00000000-0000-4000-8000-000000000001', businessB = '00000000-0000-4000-8000-000000000002';
const manualA = '00000000-0000-4000-8000-000000000101', manualB = '00000000-0000-4000-8000-000000000102';
const params = new URLSearchParams(location.search);
window.fixtureLanguage = params.get('lang') === 'km' ? 'km' : 'en';
const t = (en, km) => window.fixtureLanguage === 'km' ? km : en;
const restored = params.get('fixture_reload') === '1' ? JSON.parse(sessionStorage.getItem('payment-attempt-fixture') || 'null') : null;
const checks = [], requests = restored?.requests || [], uploads = restored?.uploads || [], navigations = restored?.navigations || [];
let attempts = new Map(restored?.attempts || []), denied = new Set(), scenario = {}, mount = 0, secureTransfers = restored?.secureTransfers || 0;
let gate = null, paywaySequence = 0;
let signedOut = false;
const authListeners = new Set();
const root = createRoot(document.getElementById('root'));
const key = (kind, id) => `${kind}:${id}`;
const copy = value => JSON.parse(JSON.stringify(value));
const buttons = () => [...document.querySelectorAll('button')];
const heading = () => document.querySelector('h1')?.textContent.trim() || '';
const button = (en, km) => buttons().find(element => element.textContent.trim() === t(en, km));
const persist = () => sessionStorage.setItem('payment-attempt-fixture', JSON.stringify({ attempts: [...attempts], requests, uploads, navigations, secureTransfers }));
function check(name, value, detail) {
  checks.push({ name, passed: Boolean(value), ...(detail ? { detail } : {}) });
  if (!value) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}
async function until(predicate, label) {
  for (let index = 0; index < 180; index++) { if (predicate()) return; await pause(20); }
  throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(0, 1500)}`);
}
function saved(kind = 'manual', id = manualA, status = 'submitted', application = 'pending', businessId = businessA) {
  return { kind, id, businessId, businessName: businessId === businessA ? 'Fixture Workspace A' : 'Fixture Workspace B', planCode: 'mini', billingCycle: 'monthly', amount: 12, currency: 'USD', reference: id,
    status, application, environment: kind === 'manual' ? 'manual' : 'production', invoiceId: null, effectiveAt: null,
    ...(status === 'prepared' ? { upload: { fileName: 'fixture-proof.png', mimeType: 'image/png', sizeBytes: 4 } } : {}) };
}
function put(attempt) { attempts.set(key(attempt.kind, attempt.id), attempt); persist(); return attempt; }
function dto(attempt) { return { id: attempt.id, planCode: attempt.planCode, billingCycle: attempt.billingCycle, amount: attempt.amount, currency: attempt.currency, status: attempt.status, proofFileName: 'fixture-proof.png', reviewNote: null, reviewedAt: null, approvedAt: null, createdAt: '2026-10-15T00:00:00Z' }; }
function render(mode, props, fresh = true) {
  if (fresh) mount++;
  const Component = mode === 'buy' ? BuySubscriptionView : mode === 'checkout' ? SubscriptionPaymentView : PaymentAttemptView;
  flushSync(() => root.render(h(React.StrictMode, null, h('main', { className: 'min-h-dvh bg-slate-50' }, h(Component, { ...props, key: mount })))));
}
function reset(next = {}) { attempts = new Map(); denied = new Set(); gate = null; signedOut = false; scenario = next; persist(); }
window.fixtureRouter = { replace(url) { navigations.push({ url, failed: Boolean(scenario.failNavigation) }); persist(); if (scenario.failNavigation) throw new Error('Synthetic navigation interruption'); } };
window.TenhAbaPaywayBridge = { isReady: () => true, checkout: () => { secureTransfers++; persist(); } };
window.fixtureSupabase = { auth: { onAuthStateChange(callback) { authListeners.add(callback); return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } }; } }, storage: { from: bucket => ({ uploadToSignedUrl: async (path, token, file, options) => {
  uploads.push({ bucket, path, metadataBytes: file.size, mimeType: options.contentType, mocked: true }); persist(); return { error: null };
} }) } };
window.confirm = () => true;
window.fetch = async (url, options = {}) => {
  if (options.signal?.aborted) throw new DOMException('Synthetic request aborted', 'AbortError');
  const target = new URL(url, location.href), method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  const request = { path: target.pathname, query: target.search, method, cache: options.cache, ...(body ? { body } : {}), mocked: true, aborted: false };
  requests.push(request); options.signal?.addEventListener('abort', () => { request.aborted = true; persist(); }); persist();
  if (target.origin !== location.origin) throw new Error('No external payment request allowed');
  if (target.pathname === '/api/workspaces/create-subscription') return Response.json({success:true,businessId:businessA,paymentUrl:`/dashboard/subscription/payment?plan=mini&cycle=monthly&purchase_business=${businessA}`});
  if (target.pathname === '/api/bakong/checkout' && method === 'GET') return Response.json({ success: true, enabled: false,
    environment: null, pendingAttemptId: null, businessId: target.searchParams.get('purchase_business') || businessA,
    userId: 'fixture-user', memberId: 'fixture-member' });
  if (target.pathname === '/api/subscription/payment-status') {
    if (signedOut) return Response.json({ success: false }, { status: 401 });
    const kind = target.searchParams.has('manual_request') ? 'manual' : 'payway';
    const id = target.searchParams.get(kind === 'manual' ? 'manual_request' : 'tran_id');
    if (denied.has(id)) return Response.json({ success: false }, { status: 403 });
    const attempt = attempts.get(key(kind, id));
    if (!attempt) return Response.json({ success: false }, { status: 404 });
    const snapshot = copy(attempt);
    if (gate?.id === id) await gate.promise;
    return Response.json({ success: true, attempt: snapshot });
  }
  if (target.pathname === '/api/payway/status') {
    const id = target.searchParams.get('tran_id'), attempt = attempts.get(key('payway', id));
    check('provider verification uses secure POST for an existing saved eligible transaction', method === 'POST' && Boolean(attempt) && (['pending', 'draft', 'processing'].includes(attempt.status) || (scenario.explicitPaywayReview && attempt.status === 'cancelled')));
    check('provider verification preserves the active workspace', target.searchParams.get('preserve_workspace') === '1');
    if (scenario.explicitPaywayReview) put({ ...attempt, status: 'recovery_required', application: 'review' });
    return Response.json({ success: true, paymentState: attempt.status });
  }
  if (target.pathname === '/api/payway/checkout') {
    const existing = [...attempts.values()].find(value => value.kind === 'payway' && value.status === 'pending');
    if (existing) return Response.json({ success: false, transactionId: existing.id, error: 'Saved pending checkout exists' }, { status: 409 });
    const attempt = put(saved('payway', `fixture-txn-${++paywaySequence}`, 'pending'));
    if (scenario.paywayLost) { scenario.paywayLost = false; throw new TypeError('Synthetic checkout response lost after commit'); }
    return Response.json({ success: true, transactionId: attempt.id, checkoutUrl: 'https://checkout.synthetic.invalid/pay', fields: { tran_id: attempt.id, amount: '12.00', hash: 'synthetic' } });
  }
  if (target.pathname === '/api/manual-payments' && method === 'GET') {
    if(scenario.holdDiscovery)await scenario.discoveryPromise;
    const businessId = target.searchParams.get('purchase_business') || businessA;
    const active = [...attempts.values()].find(value => value.businessId === businessId && value.kind === 'manual' && value.status === 'submitted');
    const prepared = [...attempts.values()].find(value => value.businessId === businessId && value.status === 'prepared');
    return Response.json({ success: true, businessId, config: { enabled: true, bankName: 'Fixture Bank', accountName: 'Synthetic Account', accountNumber: '00000000', qrImageUrl: null, supportText: null }, request: active ? dto(active) : null, payWayAttemptId:[...attempts.values()].find(value=>value.businessId===businessId&&value.kind==='payway'&&value.status==='pending')?.id??null,
      preparedAttempt: prepared ? { id: prepared.id, businessId, canResume: !scenario.otherInitiator } : null });
  }
  if (target.pathname === '/api/manual-payments' && method === 'POST') {
    if (body.action === 'prepare-upload') {
      if (scenario.prepareRejected) return Response.json({ success: false, error: 'Synthetic proof validation rejected' }, { status: 400 });
      put(saved('manual', body.requestId, 'prepared', 'pending', body.purchaseBusinessId || businessA));
    }
    const attempt = attempts.get(key('manual', body.requestId));
    if (!attempt) return Response.json({ success: false, error: 'No saved request' }, { status: 404 });
    if (body.action === 'finalize-upload') {
      attempt.status = 'submitted'; delete attempt.upload; persist();
      if (scenario.finalizeLost) { scenario.finalizeLost = false; throw new TypeError('Synthetic finalize response lost after commit'); }
      return Response.json({ success: true, request: dto(attempt) });
    }
    if (body.action === 'abort-upload') { attempt.status = 'cancelled'; attempt.application = 'historical'; persist(); return Response.json({ success: true }); }
    if (body.action === 'prepare-upload' || body.action === 'resume-upload') return Response.json({ success: true, requestId: body.requestId, proofUploaded: Boolean(scenario.proofUploaded), upload: { bucket: 'fixture-private', path: `${attempt.businessId}/${body.requestId}/fixture-proof.png`, token: scenario.proofUploaded ? null : 'synthetic-upload-token' } });
  }
  if (target.pathname === '/api/workspaces/switch') return scenario.workspaceSwitchFailure ? Response.json({success:false},{status:503}) : Response.json({ success: true, businessId: body.businessId });
  throw new Error(`Unexpected fixture request: ${method} ${target.pathname}`);
};
function setFile() {
  const input = document.querySelector('input[type=file]'); check('proof input is available', Boolean(input));
  const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array([0, 1, 2, 3])], 'fixture-proof.png', { type: 'image/png' }));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}
function noPayControls(label) {
  check(`${label}: payment methods, Checkout and proof input are absent`, !document.querySelector('input[type=file]') && !buttons().some(element => element.textContent.trim() === t('Checkout', 'ទូទាត់') || element.textContent.includes(t('Manual bank transfer', 'ផ្ទេរប្រាក់តាមធនាគារដោយដៃ'))));
}
function layout(label) { check(`${label}: no horizontal overflow`, document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`); }
async function checkout(next = {}) {
  reset(next); render('checkout', { planCode: 'mini', billingCycle: 'monthly', purchaseBusinessId: businessA });
  await until(() => buttons().some(element => element.textContent.includes(t('Manual bank transfer', 'ផ្ទេរប្រាក់តាមធនាគារដោយដៃ'))), 'StrictMode checkout discovery completes');
  check('StrictMode checkout enables existing methods after identity discovery', true);
}
async function chooseManual() {
  buttons().find(element => element.textContent.includes(t('Manual bank transfer', 'ផ្ទេរប្រាក់តាមធនាគារដោយដៃ'))).click();
  await until(() => document.querySelector('input[type=file]'), 'manual proof form'); setFile(); await pause(35);
  return buttons().find(element => /Submit payment|ដាក់ស្នើការទូទាត់/.test(element.textContent));
}
async function paywayButton() {
  await until(() => { const control = button('Checkout', 'ទូទាត់'); return control && !control.disabled; }, 'PayWay plugin ready');
  return button('Checkout', 'ទូទាត់');
}
async function submissionChecks() {
  await checkout({ failNavigation: true, finalizeLost: true });
  const before = requests.length, submit = await chooseManual(); check('selected proof enables explicit submission', submit && !submit.disabled); submit.click();
  await until(() => heading() === t('Under review', 'កំពុងពិនិត្យ'), 'committed manual response reconciles');
  const mutations = requests.slice(before).filter(request => request.method === 'POST');
  const prepares = mutations.filter(request => request.body?.action === 'prepare-upload'), finalizes = mutations.filter(request => request.body?.action === 'finalize-upload');
  check('one manual prepare and finalize despite lost response and failed navigation', prepares.length === 1 && finalizes.length === 1);
  check('manual same ID survives prepare, finalize and exact status', prepares[0].body.requestId === finalizes[0].body.requestId && [...attempts.values()][0].id === prepares[0].body.requestId);
  check('navigation failure leaves the saved status mounted', navigations.at(-1)?.failed === true);
  noPayControls('submitted manual'); layout('submitted manual');
  check('manual submission shows the approved amber review clock and receipt copy without automatic approval', Boolean(document.querySelector('[class*="text-amber-500"]')) && !document.querySelector('[class*="animate-spin"]') && document.body.textContent.includes(t('Receipt submitted','បានផ្ញើបង្កាន់ដៃ')));
  const close=document.querySelector('a[aria-label]'), beforeClose=requests.length;
  check('status close is a compact keyboard accessible link to Subscription', close?.getAttribute('href')==='/dashboard/subscription' && close.classList.contains('h-11') && close.classList.contains('w-11'));
  close.focus(); check('close accepts keyboard focus',document.activeElement===close);
  close.addEventListener('click',event=>event.preventDefault(),{once:true}); close.click();
  check('closing the status has no payment mutation',requests.length===beforeClose);
  const id = prepares[0].body.requestId; sessionStorage.setItem('payment-reload-id', id); persist(); return { id };
}
function prepareReload() {
  const id = sessionStorage.getItem('payment-reload-id');
  history.replaceState(null, '', `/fixture.html?manual_request=${encodeURIComponent(id)}&fixture_reload=1&lang=${window.fixtureLanguage}`);
  persist(); return id;
}
async function reloadChecks() {
  await until(() => heading() === t('Under review', 'កំពុងពិនិត្យ'), 'real document reload restores exact submitted request');
  check('reload retains exact request identity', params.get('manual_request') === sessionStorage.getItem('payment-reload-id'));
  noPayControls('reloaded submitted manual'); layout('reloaded status');
}
async function statusChecks() {
  for (const [status, application, en, km] of [['approved', 'active', 'Payment successful', 'ការទូទាត់ជោគជ័យ'], ['rejected', 'historical', 'Payment rejected', 'ការទូទាត់ត្រូវបានបដិសេធ']]) {
    reset(); put(saved('manual', manualA, status, application)); render('status', { kind: 'manual', attemptId: manualA });
    await until(() => heading() === t(en, km), `initial ${status}`); const initial = heading(); noPayControls(`initial ${status}`);
    reset(); put(saved()); render('status', { kind: 'manual', attemptId: manualA }); await until(() => heading() === t('Under review', 'កំពុងពិនិត្យ'), 'pending before actual poll');
    put(saved('manual', manualA, status, application)); await until(() => heading() === initial, `poll reaches ${status}`);
    check(`initial and automatically polled ${status} use the same state`, heading() === initial); noPayControls(`polled ${status}`);
  }
  reset(); put(saved('manual', manualA, 'approved', 'historical')); render('status', { kind: 'manual', attemptId: manualA });
  await until(() => document.body.textContent.includes(t('Saved payment. This does not confirm current access.', 'ការទូទាត់ចាស់។ មិនបញ្ជាក់សិទ្ធិប្រើបច្ចុប្បន្នទេ។')), 'historical approval');
  check('historical approval cannot claim current access or offer Continue', heading() !== t('Payment successful', 'ការទូទាត់ជោគជ័យ') && !button('Go to inbox', 'ទៅប្រអប់សារ'));
  put(saved('manual', manualA, 'approved', 'active')); render('status', { kind: 'manual', attemptId: manualA });
  await until(() => heading() === t('Payment successful', 'ការទូទាត់ជោគជ័យ'), 'terminal view before online recheck');
  put(saved('manual', manualA, 'approved', 'historical')); window.dispatchEvent(new Event('online'));
  await until(() => !button('Go to inbox', 'ទៅប្រអប់សារ') && heading() !== t('Payment successful', 'ការទូទាត់ជោគជ័យ'), 'online revalidates stopped terminal view');
  check('online event revalidates current access after polling stopped', !button('Go to inbox', 'ទៅប្រអប់សារ'));
  signedOut = true; for (const callback of authListeners) callback('SIGNED_OUT', null);
  await until(() => document.querySelector('[role=alert]'), 'signout revokes visible payment data');
  check('signout clears stale authorized payment data and Continue', !document.body.textContent.includes('Fixture Workspace A') && !button('Go to inbox', 'ទៅប្រអប់សារ'));
  for (const status of ['failed', 'cancelled', 'recovery_required', 'unrecognized']) {
    reset(); put(saved('manual', manualA, status, status === 'recovery_required' ? 'review' : 'historical')); render('status', { kind: 'manual', attemptId: manualA });
    await until(() => document.body.textContent.includes('Fixture Workspace A'), status);
    check(`${status} cannot claim payment received or active access`, ![t('Payment received', 'បានទទួលការទូទាត់'), t('Payment successful', 'ការទូទាត់ជោគជ័យ')].includes(heading())); noPayControls(status);
  }
  reset(); put(saved('manual', manualA, 'approved', 'active')); put(saved('manual', manualB, 'approved', 'historical', businessB));
  let release; const promise = new Promise(resolve => { release = resolve; }); gate = { id: manualA, promise }; const begin = requests.length;
  render('status', { kind: 'manual', attemptId: manualA }); await until(() => requests.slice(begin).some(request => request.query.includes(manualA)), 'deferred A request');
  render('status', { kind: 'manual', attemptId: manualB }); await until(() => document.body.textContent.includes('Fixture Workspace B'), 'destination B'); release(); await pause(70);
  check('late aborted A cannot overwrite B or claim active access', document.body.textContent.includes('Fixture Workspace B') && !document.body.textContent.includes('Fixture Workspace A') && heading() !== t('Payment successful', 'ការទូទាត់ជោគជ័យ'));
  check('retired A request was aborted', requests.slice(begin).some(request => request.query.includes(manualA) && request.aborted)); layout('terminal states');
  reset(); put(saved('payway', 'fixture-signout-deferred', 'pending'));
  let releaseSignedOut; gate = { id: 'fixture-signout-deferred', promise: new Promise(resolve => { releaseSignedOut = resolve; }) };
  const signoutStart = requests.length;
  render('status', { kind: 'payway', attemptId: 'fixture-signout-deferred' });
  await until(() => requests.slice(signoutStart).some(request => request.query.includes('fixture-signout-deferred')), 'deferred authorized response before signout');
  let leakedSignedOutData = false;
  const observer = new MutationObserver(() => { leakedSignedOutData ||= document.body.textContent.includes('Fixture Workspace A'); });
  observer.observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true });
  signedOut = true; for (const callback of authListeners) callback('SIGNED_OUT', null); releaseSignedOut();
  await until(() => document.querySelector('[role=alert]'), 'same-tick signout rejects deferred response'); await pause(70); observer.disconnect();
  check('same-tick signout prevents stale payment rendering and provider verification before effect cleanup', !leakedSignedOutData && !document.body.textContent.includes('Fixture Workspace A') && !button('Go to inbox', 'ទៅប្រអប់សារ') && !requests.slice(signoutStart).some(request => request.path === '/api/payway/status'));
}
async function preparedChecks() {
  reset(); put(saved('manual', manualA, 'prepared')); render('status', { kind: 'manual', attemptId: manualA });
  await until(() => document.querySelector('input[type=file]'), 'prepared recovery'); setFile(); await pause(40); const before = requests.length;
  button('Resume upload', 'បន្តផ្ទុក').click(); await until(() => heading() === t('Under review', 'កំពុងពិនិត្យ'), 'resume same proof');
  const recovery = requests.slice(before).filter(request => request.method === 'POST');
  check('prepared recovery resumes and finalizes the exact saved ID without prepare', recovery.some(request => request.body?.action === 'resume-upload' && request.body.requestId === manualA) && recovery.some(request => request.body?.action === 'finalize-upload' && request.body.requestId === manualA) && !recovery.some(request => request.body?.action === 'prepare-upload'));
  noPayControls('resumed proof');
  reset({ proofUploaded: true }); put(saved('manual', manualA, 'prepared')); render('status', { kind: 'manual', attemptId: manualA });
  await until(() => document.querySelector('input[type=file]'), 'prepared recovery with existing proof'); setFile(); await pause(40);
  const existingProofStart = requests.length, existingUploadCount = uploads.length;
  button('Resume upload', 'បន្តផ្ទុក').click();
  await until(() => heading() === t('Under review', 'កំពុងពិនិត្យ'), 'existing proof finalizes without another upload');
  const existingProofRecovery = requests.slice(existingProofStart).filter(request => request.method === 'POST');
  check('verified existing proof with null upload token skips SDK upload and finalizes same saved ID', uploads.length === existingUploadCount && existingProofRecovery.some(request => request.body?.action === 'resume-upload' && request.body.requestId === manualA) && existingProofRecovery.some(request => request.body?.action === 'finalize-upload' && request.body.requestId === manualA) && attempts.get(key('manual', manualA)).status === 'submitted' && !existingProofRecovery.some(request => request.body?.action === 'prepare-upload'));
  reset(); put(saved('manual', manualA, 'prepared')); denied.add(manualA); render('status', { kind: 'manual', attemptId: manualA });
  await until(() => document.querySelector('[role=alert]'), 'inaccessible private recovery');
  check('private inaccessible attempt exposes no workspace or upload controls', !document.body.textContent.includes('Fixture Workspace A') && !document.querySelector('input[type=file]'));
  reset({ otherInitiator: true }); put(saved('manual', manualA, 'prepared')); render('checkout', { planCode: 'mini', billingCycle: 'monthly', purchaseBusinessId: businessA });
  await until(() => document.querySelector('[role=alert]'), 'another initiator blocks checkout'); noPayControls('another initiator');
  await checkout({ prepareRejected: true }); const submit = await chooseManual(); const start = navigations.length; submit.click();
  await until(() => document.body.textContent.includes('Synthetic proof validation rejected'), 'definite validation error');
  check('definite prepare rejection preserves editable proof form without nonexistent status navigation', Boolean(document.querySelector('input[type=file]')) && navigations.length === start);
  layout('proof validation error');
}
async function paywayChecks() {
  reset(); put(saved('payway', 'fixture-pending', 'pending')); const before = requests.length;
  render('checkout', { planCode: 'mini', billingCycle: 'monthly', purchaseBusinessId: businessA, initialTransactionId: 'fixture-pending', initialPayWayReturn: 'approved' });
  await until(() => requests.slice(before).some(request => request.path === '/api/payway/status'), 'saved pending verification');
  check('approved browser return hint cannot fabricate saved approval', heading() !== t('Payment successful', 'ការទូទាត់ជោគជ័យ')); noPayControls('PayWay pending');
  reset(); put(saved('payway', 'fixture-approved', 'approved', 'active')); const approvedStart = requests.length; render('status', { kind: 'payway', attemptId: 'fixture-approved' });
  await until(() => heading() === t('Payment successful', 'ការទូទាត់ជោគជ័យ'), 'saved PayWay approval');
  check('already approved attempt performs no provider verification or new checkout', !requests.slice(approvedStart).some(request => request.path === '/api/payway/status' || request.path === '/api/payway/checkout'));
  reset(); put(saved('payway', 'fixture-cancelled', 'cancelled', 'historical'));
  const cancelledStart = requests.length;
  render('status', { kind: 'payway', attemptId: 'fixture-cancelled' });
  await until(() => heading() === t('Cancelled', 'បានបោះបង់'), 'persisted cancelled PayWay'); await pause(260);
  check('cancelled PayWay stays stopped without automatic provider verification', !requests.slice(cancelledStart).some(request => request.path === '/api/payway/status'));
  scenario.explicitPaywayReview = true; button('Check status', 'ពិនិត្យស្ថានភាព').click();
  await until(() => heading() === t('Payment needs review', 'ការទូទាត់ត្រូវការពិនិត្យ'), 'explicit cancelled verification resolves saved recovery');
  check('explicit cancelled PayWay verification uses saved recovery state without claiming active access or creating another attempt', requests.slice(cancelledStart).some(request => request.path === '/api/payway/status' && request.method === 'POST') && attempts.get(key('payway', 'fixture-cancelled')).status === 'recovery_required' && !button('Go to inbox', 'ទៅប្រអប់សារ') && !requests.slice(cancelledStart).some(request => request.path === '/api/payway/checkout'));
  noPayControls('cancelled PayWay recovery review');
  await checkout(); const checkoutButton = await paywayButton(); const transferStart = secureTransfers; checkoutButton.click();
  await until(() => document.body.textContent.includes('fixture-txn-'), 'PayWay enters exact status');
  check('explicit PayWay checkout invokes only the mocked secure bridge once', secureTransfers === transferStart + 1); noPayControls('created PayWay'); layout('PayWay status');
  await checkout({ paywayLost: true }); const lostStart = requests.length; (await paywayButton()).click();
  await until(() => document.querySelector('[role=alert]'), 'ambiguous PayWay create response blocks retry');
  check('lost PayWay create response preserves one saved transaction and blocks another POST', [...attempts.values()].filter(attempt => attempt.kind === 'payway').length === 1 && requests.slice(lostStart).filter(request => request.path === '/api/payway/checkout').length === 1);
  noPayControls('ambiguous PayWay create');
  await checkout(); put(saved('payway', 'fixture-existing', 'pending')); const existingStart = requests.length, secureStart = secureTransfers;
  (await paywayButton()).click(); await until(() => document.body.textContent.includes('fixture-existing'), '409 resumes existing exact transaction');
  check('409 restores the saved PayWay identity without creating a new transaction or provider transfer', attempts.size === 1 && secureTransfers === secureStart && requests.slice(existingStart).filter(request => request.path === '/api/payway/checkout').length === 1);
  noPayControls('existing PayWay restored');
  await until(()=>heading()===t('Checking payment','កំពុងពិនិត្យការទូទាត់'),'approved checking card');
  check('saved PayWay pending uses the teal spinner and no copied sample amount',Boolean(document.querySelector('[class*="border-t-teal-600"]')) && document.body.textContent.includes('$12.00') && !document.body.textContent.includes('$25.00'));
  check('production pending has no test-payment label or direct Bakong option',!document.body.textContent.includes('Test payment')&&!document.body.textContent.includes('Bakong'));
  const timed={...saved('payway','fixture-countdown','pending'),checkoutExpiresAt:new Date(Date.now()+600000).toISOString(),serverTime:new Date().toISOString()};put(timed);render('status',{kind:'payway',attemptId:timed.id});
  await until(()=>document.querySelector('time'),'server-saved countdown');
  const time=document.querySelector('time'),close=document.querySelector('a[aria-label]'),card=document.querySelector('[data-payment-card]');
  check('countdown and accessible X share card without overlap',card.contains(time)&&card.contains(close)&&time.getBoundingClientRect().right+4<=close.getBoundingClientRect().left);
  check('details are inside card and redundant Back link is absent',card.contains(document.querySelector('details'))&&!document.body.textContent.includes(t('Back to subscription','ត្រឡប់ទៅការជាវ')));
  layout('approved checking card');
}
async function popupCloseChecks(){
 reset();const pending={...saved('payway','fixture-closed','pending'),checkoutExpiresAt:new Date(Date.now()+600000).toISOString(),serverTime:new Date().toISOString()};put(pending);render('status',{kind:'payway',attemptId:pending.id});await until(()=>heading()===t('Checking payment','កំពុងពិនិត្យការទូទាត់'),'mounted payment before close return');render('status',{kind:'payway',attemptId:pending.id,checkoutClosed:true},false);
 await until(()=>heading()===t('Checkout closed','បានបិទការទូទាត់'),'closed provider presentation');
 check('provider close leaves saved pending and no false financial cancellation',attempts.get(key('payway',pending.id)).status==='pending'&&!document.querySelector('[class*="animate-spin"]'));
 layout('provider closed card');
}
async function sandboxDetailsChecks(){
 reset();const pending={...saved('payway','fixture-sandbox','pending'),environment:'sandbox',checkoutExpiresAt:new Date(Date.now()+600000).toISOString(),serverTime:new Date().toISOString()};put(pending);render('status',{kind:'payway',attemptId:pending.id,checkoutClosed:true});
 await until(()=>document.querySelector('details')&&document.querySelector('time'),'saved sandbox details');const details=document.querySelector('details');details.open=true;
 check('sandbox truth is concise and inside payment details',details.textContent.includes(t('Test payment','ការទូទាត់សាកល្បង'))&&details.closest('[data-payment-card]'));
 layout('sandbox payment details');
}
async function prepareBuy(){
 let resolve;const discoveryPromise=new Promise(done=>{resolve=done;});reset({holdDiscovery:true,discoveryPromise,resolveDiscovery:resolve});window.fixtureBuyPreflight=true;render('buy',{});
 await until(()=>button('Buy Standard','ទិញ Standard'),'Buy page');button('Buy Standard','ទិញ Standard').click();
 await until(()=>document.querySelector('button[aria-busy=true]'),'Buy preflight spinner');document.querySelector('button[aria-busy=true]').scrollIntoView({block:'center'});
 check('Buy stays on plan page while discovery runs without standalone legacy page',Boolean(document.querySelector('button[aria-busy=true][disabled] [class*="animate-spin"]'))&&!document.body.textContent.includes('Checking existing payment'));
 layout('Buy preflight button');
}
async function finishBuy(){
 const before=secureTransfers;scenario.holdDiscovery=false;scenario.resolveDiscovery();window.fixtureBuyPreflight=false;
 await until(()=>secureTransfers===before+1,'guarded Buy opens inline provider');await until(()=>heading()===t('Checking payment','កំពុងពិនិត្យការទូទាត់'),'saved Buy status');
 check('Buy opens one inline checkout after preflight, without window.open',secureTransfers===before+1);noPayControls('Buy saved status');layout('Buy status');
}
async function successChecks() {
  reset({workspaceSwitchFailure:true}); put({...saved('payway','fixture-confirmed','approved','active'),invoiceId:'fixture-invoice'});
  render('status',{kind:'payway',attemptId:'fixture-confirmed'});
  await until(()=>heading()===t('Payment successful','ការទូទាត់ជោគជ័យ'),'confirmed success card');
  check('success uses saved workspace, amount and provider without copied test/sample claims', document.body.textContent.includes('Fixture Workspace A') && document.body.textContent.includes('$12.00') && document.body.textContent.includes('ABA PayWay') && !document.body.textContent.includes('Test payment'));
  check('success has exact saved receipt and inbox navigation', Boolean(button('Go to inbox','ទៅប្រអប់សារ')) && document.querySelector('a[href*="fixture-invoice"]'));
  noPayControls('confirmed success'); layout('confirmed success');
}
async function navigationChecks() {
  const before=requests.length,title=heading(),go=button('Go to inbox','ទៅប្រអប់សារ');go.click();go.click();
  await until(()=>document.querySelector('[role=alert]'),'workspace navigation error');
  check('workspace navigation failure preserves confirmed success and never verifies payment again',heading()===title && requests.slice(before).filter(r=>r.path==='/api/workspaces/switch').length===1 && !requests.slice(before).some(r=>r.path==='/api/payway/status'||r.path==='/api/payway/checkout'));
}
function motionChecks(){check('reduced motion stops the decorative checking animation',matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('[class*="border-t-teal-600"]')).animationName==='none');}
window.paymentAttemptFixture = { prepareBuy, finishBuy, popupCloseChecks, sandboxDetailsChecks, successChecks, navigationChecks, motionChecks, submissionChecks, prepareReload, reloadChecks, statusChecks, preparedChecks, paywayChecks,
  result: () => ({ checks: [...checks], requests: [...requests], uploads: [...uploads], navigations: [...navigations], secureTransfers, mockedOnly: true, paymentBytesTransferred: 0, language: window.fixtureLanguage }) };
if (restored && params.get('manual_request')) render('status', { kind: 'manual', attemptId: params.get('manual_request') });
