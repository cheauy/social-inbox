/* eslint-disable @typescript-eslint/no-require-imports -- Offline React authentication regression. */
const React = require('react');
const { createRoot } = require('react-dom/client');
const { flushSync } = require('react-dom');
const LoginPage = require('../../app/login/page.tsx').default;
const ForgotPage = require('../../app/forgot-password/page.tsx').default;
const ResetPage = require('../../app/reset-password/page.tsx').default;
const VerifyPage = require('../../app/verify-email/page.tsx').default;
const { AdminLoginSessionsPanel } = require('../../components/admin/admin-login-sessions-panel.tsx');
const { DashboardSessionBoundary } = require('../../components/dashboard/dashboard-session-boundary.tsx');
const { ProfileMenu } = require('../../components/dashboard/profile-menu.tsx');
const { readWorkspaceStorageCache, refreshWorkspaceStorageCache, workspaceStorageCacheKey } = require('../../lib/storage/workspace-storage-cache.ts');
const h = React.createElement, root = createRoot(document.getElementById('root'));
const checks = [], requests = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const nativeTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
const sessionTimers = new Map(); let timerId = 100000000;
window.setTimeout = (callback, delay, ...args) => { if (window.fixtureControlledSessionTimers && delay >= 500) { const id = ++timerId; sessionTimers.set(id, { callback: () => callback(...args), delay }); return id; } return nativeTimeout(callback, delay, ...args); };
window.clearTimeout = id => { if (!sessionTimers.delete(id)) nativeClearTimeout(id); };
function fireSessionTimer(delay) { const entry = [...sessionTimers].find(([, value]) => value.delay === delay); if (!entry) throw new Error(`No pending session timer ${delay}: ${JSON.stringify([...sessionTimers.values()].map(value => value.delay))}`); sessionTimers.delete(entry[0]); entry[1].callback(); }
const authListeners = new Set(), sdk = { channels: 0, stop: 0, start: 0 };
let privateMounts = 0, privateUnmounts = 0;
window.fixtureSessionReloads = 0;
function PrivateWorkspace() { React.useEffect(() => { privateMounts++; return () => { privateUnmounts++; }; }, []); return h('section', { 'data-private-workspace': true, className: 'p-5' }, h('h1', null, 'Synthetic private customer workspace'), h('div', { className: 'flex justify-end' }, h(ProfileMenu, { name: 'Synthetic agent', email: 'synthetic@example.invalid' }))); }
function SessionDemo() { return h(DashboardSessionBoundary, { initialSessionId: scenario.initialSessionId === undefined ? scenario.sessionId || 'session-A' : scenario.initialSessionId, initialUserId: scenario.initialUserId || 'user-A' }, h(PrivateWorkspace)); }
window.fixtureLanguage = new URLSearchParams(location.search).get('lang') === 'km' ? 'km' : 'en';
window.addEventListener('tenh:display-language-change', event => { window.fixtureLanguage = event.detail.id; });
const t = (en, km) => window.fixtureLanguage === 'km' ? km : en;
let scenario = {}, mount = 0;
function check(name, value, detail) { checks.push({ name, passed: Boolean(value), ...(detail ? { detail } : {}) }); if (!value) throw new Error(name + (detail ? `: ${detail}` : '')); }
async function until(predicate, label) { for (let i = 0; i < 160; i++) { if (predicate()) return; await pause(15); } throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(0, 1800)}`); }
function render(mode, next = {}) {
  scenario = next; history.replaceState(null, '', location.pathname + location.search); mount++; window.fixtureControlledSessionTimers = mode === 'session';
  const Component = { login: LoginPage, forgot: ForgotPage, reset: ResetPage, verify: VerifyPage, admin: AdminLoginSessionsPanel, session: SessionDemo }[mode];
  flushSync(() => root.render(h(React.StrictMode, null, h(Component, { key: mount }))));
}
function fill(id, value) { const input = document.getElementById(id); if (!input) throw new Error(`Missing input ${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
const button = (en, km) => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === t(en, km));
function submitTwice() { const form = document.querySelector('form'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
function layout(label) { check(`${label}: no horizontal overflow`, document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`); }
const destination = hash => location.pathname + location.search + `#${hash}`;
window.fixtureBrowserAuthCalls = 0;
const forbiddenAuth = () => { window.fixtureBrowserAuthCalls++; throw new Error('Browser auth mutations are forbidden in the offline fixture'); };
window.fixtureSupabase = { removeAllChannels: async () => { sdk.channels++; }, auth: { onAuthStateChange(callback) { authListeners.add(callback); return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } }; }, stopAutoRefresh: async () => { sdk.stop++; }, startAutoRefresh: async () => { sdk.start++; }, signOut: forbiddenAuth, signInWithPassword: forbiddenAuth, signInWithOAuth: forbiddenAuth, verifyOtp: forbiddenAuth } };
window.fetch = async (url, options = {}) => {
  if (options.signal?.aborted) throw new DOMException('Synthetic abort', 'AbortError');
  const target = new URL(url, location.href), body = options.body ? JSON.parse(options.body) : null;
  if (target.origin !== location.origin) throw new Error('External auth request prohibited in fixture');
  const request = { path: target.pathname, method: options.method || 'GET', ...(body ? { body } : {}), cache: options.cache, mocked: true };
  requests.push(request);
  options.signal?.addEventListener('abort', () => { request.aborted = true; });
  if (target.pathname === '/api/auth/session') {
    const snapshot = { sessionId: scenario.sessionId || 'session-A', userId: scenario.userId || 'user-A', kind: scenario.kind || 'password', expiresAt: scenario.expiresAt === undefined ? '2026-10-16T00:00:00Z' : scenario.expiresAt, serverTime: '2026-10-15T00:00:00Z', remembered: scenario.remembered === undefined ? true : scenario.remembered, status: scenario.status || 200 };
    if (scenario.holdSession) await scenario.holdSession;
    if (snapshot.status === 401) return new Response(null, { status: 401 });
    return Response.json(snapshot.status === 200 ? { success: true, ...snapshot } : { success: false }, { status: snapshot.status });
  }
  if (target.pathname === '/api/auth/policy') return Response.json(scenario.policyUnavailable ? { success: false } : { success: true, rememberDays: scenario.days ?? 30 }, { status: scenario.policyUnavailable ? 503 : 200 });
  if (target.pathname === '/api/auth/login') {
    if (scenario.holdLogin) await scenario.holdLogin;
    return Response.json(scenario.loginSuccess ? { success: true, redirect: destination('password-complete') } : { success: false, error: 'Generic sign-in failure' }, { status: scenario.loginSuccess ? 200 : 401 });
  }
  if (target.pathname === '/api/auth/oauth') return Response.json({ success: true, url: destination(`${body.provider}-complete`) });
  if (target.pathname === '/api/auth/recover') return Response.json(scenario.rateLimited ? { success: false } : { success: true }, { status: scenario.rateLimited ? 429 : 200 });
  if (target.pathname === '/api/auth/recovery-status') {
    if (scenario.holdStatus) await scenario.holdStatus;
    return Response.json(scenario.invalid ? { success: false } : { success: true, valid: true }, { status: scenario.invalid ? 410 : 200 });
  }
  if (target.pathname === '/api/auth/reset-password') return Response.json({ success: true, redirect: '/login?reset=complete', revocationPending: true });
  if (target.pathname === '/api/auth/confirm') return Response.json(scenario.confirmSuccess ? { success: true, redirect: destination('confirmation-complete') } : { success: false }, { status: scenario.confirmSuccess ? 200 : 400 });
  if (target.pathname === '/api/auth/resend') return Response.json({ success: true });
  if (target.pathname === '/api/tenh-admin/login-sessions') {
    if (request.method === 'GET') return Response.json(scenario.forbidden || scenario.unavailable ? { success: false } : { success: true, rememberDays: scenario.days ?? 30, requiresMfa: Boolean(scenario.requiresMfa) }, { status: scenario.forbidden ? 403 : scenario.unavailable ? 503 : 200 });
    if (scenario.recentAuthRequired) return Response.json({ success: false, code: 'recent_auth_required' }, { status: 403 });
    scenario.days = body.rememberDays; return Response.json({ success: true, rememberDays: body.rememberDays });
  }
  throw new Error(`Unexpected auth fixture request ${request.method} ${target.pathname}`);
};

async function loginChecks() {
  render('login', { days: 45 }); await until(() => document.getElementById('remember-me'), 'login mounted');
  check('Remember me starts unchecked', document.getElementById('remember-me').checked === false);
  check('unchecked Remember me helper is hidden', !document.getElementById('remember-me').closest('div').querySelector('p'));
  check('Forgot password opens real request page', document.querySelector('a[href="/forgot-password"]')?.textContent === t('Forgot password?', 'ភ្លេចពាក្យសម្ងាត់?'));
  await until(() => requests.some(request => request.path === '/api/auth/policy'), 'server policy loaded'); await pause(30);
  document.getElementById('remember-me').click(); await until(() => document.body.textContent.includes('45'), 'checked copy uses server duration');
  check('checked Remember me copy uses server-provided days', document.body.textContent.includes('45') && !document.body.textContent.includes('30 days'));
  fill('login-email', 'SYNTHETIC@example.invalid'); fill('login-password', 'Synthetic-only-password1!'); await pause(20);
  button('Show', 'បង្ហាញ').click(); await pause(10); check('password visibility button is accessible and works', document.getElementById('login-password').type === 'text' && button('Hide', 'លាក់').getAttribute('aria-label') === t('Hide password', 'លាក់ពាក្យសម្ងាត់'));
  let release; scenario.holdLogin = new Promise(resolve => { release = resolve; }); const before = requests.length; submitTwice();
  await until(() => requests.slice(before).some(request => request.path === '/api/auth/login'), 'password server handshake');
  check('in-flight login blocks duplicate submissions', requests.slice(before).filter(request => request.path === '/api/auth/login').length === 1 && button('Signing in…', 'កំពុងចូល…').disabled);
  const login = requests.slice(before).find(request => request.path === '/api/auth/login');
  check('password login sends checked preference and return path to server', login.body.rememberMe === true && login.body.email === 'synthetic@example.invalid' && login.body.next === '/dashboard/settings/security');
  release(); await until(() => document.querySelector('[role=alert]'), 'generic failed login');
  check('failed login retains editable fields with generic error', !document.getElementById('login-email').disabled && !document.querySelector('[role=alert]').textContent.includes('exists'));
  render('login', { loginSuccess: true }); await until(() => document.getElementById('login-email'), 'new login'); fill('login-email', 'synthetic@example.invalid'); fill('login-password', 'Synthetic-only-password1!'); await pause(20);
  const uncheckedStart = requests.length; submitTwice(); await until(() => location.hash === '#password-complete', 'server-owned password destination');
  check('unchecked password preference stays false and success follows server destination', requests.slice(uncheckedStart).find(request => request.path === '/api/auth/login').body.rememberMe === false);
  for (const provider of ['google', 'facebook']) {
    render('login'); await until(() => document.getElementById('remember-me'), `${provider} login`); document.getElementById('remember-me').click(); await pause(15);
    const start = requests.length; button(`Continue with ${provider === 'google' ? 'Google' : 'Facebook'}`, `បន្តជាមួយ ${provider === 'google' ? 'Google' : 'Facebook'}`).click();
    await until(() => location.hash === `#${provider}-complete`, `${provider} trusted server handshake`);
    const request = requests.slice(start).find(value => value.path === '/api/auth/oauth');
    check(`${provider} preference is sent through trusted server handshake`, request.method === 'POST' && request.body.provider === provider && request.body.rememberMe === true && request.body.next === '/dashboard/settings/security');
  }
  render('login', { policyUnavailable: true }); await until(() => document.getElementById('remember-me'), 'policy outage login'); document.getElementById('remember-me').click(); await pause(35);
  check('policy outage never invents duration or changes preference', document.getElementById('remember-me').checked && !document.body.textContent.includes('30 days'));
  const originalLanguage = window.fixtureLanguage, other = originalLanguage === 'en' ? 'km' : 'en';
  [...document.querySelectorAll('button')].find(element => element.textContent === (other === 'en' ? 'EN' : 'ខ្មែរ')).click(); await until(() => document.querySelector('h2').textContent === (other === 'en' ? 'Welcome' : 'សូមស្វាគមន៍'), 'language switch');
  check('public auth language switch updates visible content', window.fixtureLanguage === other);
  [...document.querySelectorAll('button')].find(element => element.textContent === (originalLanguage === 'en' ? 'EN' : 'ខ្មែរ')).click(); await pause(15);
  render('login', { days: 45 }); await until(() => document.getElementById('remember-me'), 'login screenshot'); document.getElementById('remember-me').click(); await until(() => document.body.textContent.includes('45'), 'login duration screenshot'); layout('login');
}
async function forgotChecks() {
  let firstMessage;
  for (const email of ['synthetic-known@example.invalid', 'synthetic-unknown@example.invalid']) {
    render('forgot'); fill('recovery-email', email); await pause(15); const before = requests.length; submitTwice(); await until(() => document.querySelector('[role=status]'), 'generic recovery response');
    const message = document.querySelector('[role=status]').textContent;
    if (!firstMessage) firstMessage = message;
    check('recovery response does not disclose account existence', message === firstMessage && !message.includes(email));
    check('recovery request is sent once with account email only', requests.slice(before).filter(request => request.path === '/api/auth/recover').length === 1 && Object.keys(requests.slice(before).find(request => request.path === '/api/auth/recover').body).join() === 'email');
  }
  render('forgot', { rateLimited: true }); fill('recovery-email', 'synthetic@example.invalid'); await pause(15); submitTwice(); await until(() => document.querySelector('[role=alert]'), 'recovery rate limit');
  check('rate-limited recovery stays editable and gives wait guidance', !document.getElementById('recovery-email').disabled && document.querySelector('[role=alert]').textContent === t('Too many requests. Wait before trying again.', 'បានស្នើច្រើនពេក។ សូមរង់ចាំមុនព្យាយាមម្ដងទៀត។'));
  render('forgot'); layout('forgot password');
}
async function resetChecks() {
  let release; const holdStatus = new Promise(resolve => { release = resolve; }); render('reset', { holdStatus }); await pause(25);
  check('password fields stay hidden until server authorizes recovery', !document.getElementById('reset-password'));
  release(); await until(() => document.getElementById('reset-password'), 'verified recovery fields'); fill('reset-password', 'Synthetic-only-password1!'); fill('reset-confirmation', 'Different-synthetic-password'); await pause(15);
  const before = requests.length; submitTwice(); await until(() => document.querySelector('[role=alert]'), 'password mismatch');
  check('mismatched reset passwords never reach server', !requests.slice(before).some(request => request.path === '/api/auth/reset-password'));
  fill('reset-confirmation', 'Synthetic-only-password1!'); await pause(15); submitTwice(); await until(() => document.querySelector('[role=status]'), 'server reset success');
  check('authorized reset sends confirmation once then removes password fields', requests.slice(before).filter(request => request.path === '/api/auth/reset-password').length === 1 && requests.slice(before).find(request => request.path === '/api/auth/reset-password').body.confirmPassword === 'Synthetic-only-password1!' && !document.getElementById('reset-password'));
  render('reset', { invalid: true }); await until(() => document.querySelector('[role=alert]'), 'expired recovery');
  check('expired or used reset cannot render password form and offers new request', !document.querySelector('input[type=password]') && Boolean(document.querySelector('a[href="/forgot-password"]')));
  render('reset'); await until(() => document.getElementById('reset-password'), 'reset screenshot'); layout('reset password');
}
async function verificationChecks() {
  sessionStorage.setItem('tenh_verification_email', 'synthetic@example.invalid'); sessionStorage.setItem('tenh_pending_invitation_token', 'synthetic-invite');
  render('verify'); await until(() => document.getElementById('verification-email').value === 'synthetic@example.invalid', 'verification storage fallback');
  check('verification code has no fixed length or local expiry promise', document.getElementById('verification-code').maxLength === -1 && !/eight-digit|8-digit|10 minutes|60 seconds/.test(document.body.textContent));
  fill('verification-code', '123456'); await pause(15); const before = requests.length; submitTwice(); await until(() => document.querySelector('[role=alert]'), 'server validates verification code');
  const request = requests.slice(before).find(value => value.path === '/api/auth/confirm');
  check('verification sends full code and invitation return path to server', request.body.token === '123456' && request.body.next === '/invite/accept?token=synthetic-invite' && requests.slice(before).filter(value => value.path === '/api/auth/confirm').length === 1);
  fill('verification-code', '1234567890'); await pause(15); scenario.confirmSuccess = true; submitTwice(); await until(() => location.hash === '#confirmation-complete', 'server-confirmed destination');
  check('longer valid code is not truncated by client', requests.filter(value => value.path === '/api/auth/confirm').at(-1).body.token === '1234567890');
  sessionStorage.setItem('tenh_verification_email', 'synthetic@example.invalid'); render('verify'); await until(() => document.getElementById('verification-email').value, 'resend mount'); button('Resend verification code', 'ផ្ញើលេខកូដផ្ទៀងផ្ទាត់ម្ដងទៀត').click(); await until(() => document.querySelector('[role=status]'), 'generic resend');
  check('resend uses server endpoint and generic confirmation', requests.at(-1).path === '/api/auth/resend' && !document.querySelector('[role=status]').textContent.includes('synthetic@example.invalid'));
  layout('email verification');
}
async function adminChecks() {
  render('admin'); await until(() => document.getElementById('remember-days'), 'global session policy');
  check('global policy loads default30 with unchanged save disabled', document.getElementById('remember-days').value === '30' && button('Save duration', 'រក្សាទុករយៈពេល').disabled);
  check('admin policy copy distinguishes unchecked24hour cookies and browser restoration', /24|២៤/.test(document.body.textContent) && /restoration|ស្ដារ/.test(document.body.textContent));
  for (const value of ['0', '91', '1.5']) { fill('remember-days', value); await pause(10); check(`invalid global duration ${value} cannot save`, button('Save duration', 'រក្សាទុករយៈពេល').disabled); }
  for (const value of ['1', '90']) {
    fill('remember-days', value); await pause(10); const before = requests.length; submitTwice(); await until(() => document.querySelector('[role=status]'), 'saved policy');
    check(`global duration ${value} saves through protected PATCH once`, requests.slice(before).filter(request => request.method === 'PATCH').length === 1 && requests.slice(before).find(request => request.method === 'PATCH').body.rememberDays === Number(value));
  }
  render('admin', { requiresMfa: true }); await until(() => document.getElementById('remember-days'), 'MFA-gated policy');
  check('MFA-gated policy links verification and blocks edit', document.getElementById('remember-days').disabled && Boolean(document.querySelector('a[href="/dashboard/admin/mfa"]')));
  render('admin', { recentAuthRequired: true }); await until(() => document.getElementById('remember-days'), 'recent auth policy'); fill('remember-days', '40'); await pause(15); submitTwice(); await until(() => document.querySelector('[role=alert]'), 'recent verification required');
  check('fresh verification failure never claims policy saved', !document.querySelector('[role=status]') && Boolean(document.querySelector('a[href="/dashboard/admin/mfa"]')) && document.getElementById('remember-days').disabled);
  render('admin', { forbidden: true }); await until(() => document.querySelector('[role=alert]'), 'workspace owner denied');
  check('non-TENH administrator denial has no editable policy', document.getElementById('remember-days').disabled && button('Save duration', 'រក្សាទុករយៈពេល').disabled);
  render('admin', { unavailable: true }); await until(() => document.querySelector('[role=alert]'), 'policy unavailable'); scenario.unavailable = false; button('Reload policy', 'ផ្ទុកគោលការណ៍ឡើងវិញ').click(); await until(() => document.getElementById('remember-days')?.value === '30', 'policy reload recovery');
  check('policy outage can recover without inventing a saved value', !document.querySelector('[role=alert]') && document.getElementById('remember-days').value === '30');
  layout('admin login sessions');
  check('browser performs no direct Supabase auth calls or provider/email actions', window.fixtureBrowserAuthCalls === 0);
}
function sessionCookie(id, hinted = true) {
  const hint = btoa(JSON.stringify({ sessionId: id, remembered: true, expiresAt: '2027-01-01T00:00:00Z' })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '.synthetic-signature';
  document.cookie = hinted ? `tenh_session_hint=${hint}; Path=/` : 'tenh_session_hint=; Path=/; Max-Age=0'; document.cookie = `sb-fixture-auth-token=synthetic-${id}; Path=/`;
}
async function sessionChecks() {
  const clock = Date.now; Date.now = () => 4102444800000;
  try {
    sessionCookie('session-A'); sessionStorage.setItem('tenh_verification_email', 'private-email'); sessionStorage.setItem('unrelated-choice', 'keep'); localStorage.setItem('unrelated-choice', 'keep');
    const key = workspaceStorageCacheKey('fixture-business', 'fixture-member'); await refreshWorkspaceStorageCache(key, async () => ({ files: [], categories: [], canManage: true, organizationAvailable: true }));
    let release; const holdSession = new Promise(resolve => { release = resolve; }); const before = requests.length;
    render('session', { holdSession, expiresAt: '2026-10-15T00:00:01.500Z' }); await pause(20);
    check('private dashboard remains unmounted before initial server validation', !document.querySelector('[data-private-workspace]'));
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); for (const callback of authListeners) callback('TOKEN_REFRESHED');
    check('focus, online and auth events never overlap an in-flight validation', requests.slice(before).filter(request => request.path === '/api/auth/session' && !request.aborted).length === 1);
    release(); await until(() => document.querySelector('[data-private-workspace]'), 'server-authorized private dashboard');
    check('browser clock skew cannot expire a server-valid session', document.querySelector('[data-private-workspace]') && [...sessionTimers.values()].some(timer => timer.delay === 1500));
    const unmountStart = privateUnmounts; scenario.status = 503; fireSessionTimer(1500); await until(() => document.querySelector('[role=alert]'), 'validation unavailable hides workspace');
    check('validation outage unmounts private content, stops channels and preserves credentials', !document.querySelector('[data-private-workspace]') && privateUnmounts > unmountStart && sdk.channels > 0 && sdk.stop > 0 && document.cookie.includes('sb-fixture-auth-token=') && readWorkspaceStorageCache(key) === null);
    const delays = [5000, 10000, 20000, 40000, 60000];
    for (const delay of delays) { check(`validation retry delay is bounded at ${delay}ms`, [...sessionTimers.values()].some(timer => timer.delay === delay)); fireSessionTimer(delay); await pause(20); }
    check('six validation failures stop automatic retries until an explicit action', sessionTimers.size === 0 && !document.querySelector('[data-private-workspace]'));
    scenario.status = 200; button('Try again', 'ព្យាយាមម្ដងទៀត').click(); await until(() => document.querySelector('[data-private-workspace]'), 'manual validation retry recovers');
    check('successful retry resumes current workspace without a refresh loop', sdk.start > 0 && window.fixtureSessionReloads === 0);
    document.querySelector('button[aria-label="' + t('Open profile menu', 'បើកម៉ឺនុយប្រវត្តិរូប') + '"]').click(); await pause(10);
    check('header profile menu keeps current-device sign out', Boolean(button('Sign out this device', "ចាកចេញលើឧបករណ៍នេះ")));
    check('header profile menu hides all-device sign out', ![...document.querySelectorAll('button')].some(element => element.textContent.trim() === t('Sign out all devices', 'ចាកចេញពីគ្រប់ឧបករណ៍')));
    sessionCookie('session-B'); render('session', { sessionId: 'session-B' }); await until(() => document.querySelector('[data-private-workspace]'), 'new B session');
    const channel = new BroadcastChannel('tenh:session-state'); channel.postMessage({ type: 'session-ended', reason: 'logout', sessionId: 'session-A' }); await pause(30);
    check('delayed cross-tab logout for A cannot end fresh B session', document.cookie.includes('synthetic-session-B') && Boolean(document.querySelector('[data-private-workspace]')));
    channel.postMessage({ type: 'session-ended', reason: 'logout', sessionId: 'session-B' }); await until(() => document.querySelector('a[href="/login?expired=1"]'), 'matching cross-tab logout'); channel.close();
    check('matching cross-tab session end clears private UI and own auth cookie without SDK signOut RPC', !document.querySelector('[data-private-workspace]') && !document.cookie.includes('sb-fixture-auth-token=') && window.fixtureBrowserAuthCalls === 0);
    check('cleanup preserves unrelated storage and removes only private TENH session keys', sessionStorage.getItem('unrelated-choice') === 'keep' && localStorage.getItem('unrelated-choice') === 'keep' && sessionStorage.getItem('tenh_verification_email') === null);
    sessionCookie('session-A'); let releaseOld; const old = new Promise(resolve => { releaseOld = resolve; }); render('session', { holdSession: old }); await pause(20);
    sessionCookie('session-B'); scenario.holdSession = null; scenario.sessionId = 'session-B'; for (const callback of authListeners) callback('SIGNED_IN');
    await until(() => window.fixtureSessionReloads === 1, 'changed identity reloads server workspace'); releaseOld(); await pause(30);
    check('late A response cannot mount A server children into B session', !document.querySelector('[data-private-workspace]') && window.fixtureSessionReloads === 1 && document.cookie.includes('synthetic-session-B'));
    sessionCookie('session-A'); render('session', { initialSessionId: null, initialUserId: 'user-A', userId: 'user-B' }); await until(() => window.fixtureSessionReloads === 2, 'legacy unhinted subject mismatch reload');
    check('unhinted legacy session still binds the original server user identity', !document.querySelector('[data-private-workspace]'));
    for (const expiresAt of [null, '2026-10-15T00:00:02Z']) {
      sessionCookie('legacy-session', false); render('session', { initialSessionId: null, sessionId: 'legacy-session', kind: 'legacy', remembered: null, expiresAt });
      await until(() => document.querySelector('[data-private-workspace]'), 'server-attested legacy compatibility');
      check(`server-attested unhinted legacy session accepts ${expiresAt === null ? 'nullable policy with30second poll' : 'provider grace expiry with server TTL'}`, [...sessionTimers.values()].some(timer => timer.delay === (expiresAt === null ? 30000 : 2000)) && window.fixtureSessionReloads === 2);
    }
    sessionCookie('session-A'); render('session', { kind: 'password', expiresAt: null, remembered: null }); await until(() => document.querySelector('[role=alert]'), 'malformed normal policy fails closed');
    check('nullable normal policy cannot masquerade as server-attested legacy', !document.querySelector('[data-private-workspace]') && document.cookie.includes('synthetic-session-A'));
    sessionCookie('session-A'); render('session'); await until(() => document.querySelector('[data-private-workspace]'), 'BFCache restore scenario');
    let releaseRestore; scenario.holdSession = new Promise(resolve => { releaseRestore = resolve; }); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await pause(20);
    check('BFCache pageshow immediately hides stale private content until server revalidation', !document.querySelector('[data-private-workspace]'));
    releaseRestore(); scenario.holdSession = null; await until(() => document.querySelector('[data-private-workspace]'), 'validated BFCache restore');
    check('valid BFCache restore resumes same private workspace without reload', window.fixtureSessionReloads === 2);
    const rotationStart = requests.length;
    let releaseRotation; scenario.holdSession = new Promise(resolve => { releaseRotation = resolve; }); scenario.status = 401; window.dispatchEvent(new Event('focus')); await pause(20);
    document.cookie = 'sb-fixture-auth-token=synthetic-new-rotation; Path=/'; scenario.holdSession = null; scenario.status = 200; releaseRotation();
    await until(() => requests.slice(rotationStart).filter(request => request.path === '/api/auth/session').length >= 2 && document.querySelector('[data-private-workspace]') && document.cookie.includes('synthetic-new-rotation'), 'stale401 validates newer rotation');
    check('stale401 cannot erase a newer credential in the same session', document.cookie.includes('synthetic-new-rotation') && Boolean(document.querySelector('[data-private-workspace]')));
    let releaseVisibility; scenario.holdSession = new Promise(resolve => { releaseVisibility = resolve; }); scenario.status = 401; const visibilityStart = requests.length; document.dispatchEvent(new Event('visibilitychange')); await pause(20);
    check('visibility return rechecks without discarding a valid workspace before the server response', Boolean(document.querySelector('[data-private-workspace]')) && requests.slice(visibilityStart).some(request => request.path === '/api/auth/session'));
    releaseVisibility(); scenario.holdSession = null;
    await until(() => document.querySelector('a[href="/login?expired=1"]'), 'server expiry with empty 401 response');
    check('server401 expiry displays exact localized sign-in guidance with no private UI', document.querySelector('h1').textContent === t('Your session expired. Please sign in again.', 'វគ្គចូលគណនីរបស់អ្នកបានផុតកំណត់។ សូមចូលម្ដងទៀត។') && !document.querySelector('[data-private-workspace]'));
    layout('expired dashboard session');
  } finally { Date.now = clock; }
}
window.authUiFixture = { loginChecks, forgotChecks, resetChecks, verificationChecks, adminChecks, sessionChecks, result: () => ({ checks: [...checks], requests: [...requests], mockedOnly: true, providerActions: 0, emailsSent: 0, browserAuthCalls: window.fixtureBrowserAuthCalls, sessionSdk: sdk, privateMounts, privateUnmounts, identityReloads: window.fixtureSessionReloads }) };
