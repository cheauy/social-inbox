/* eslint-disable @typescript-eslint/no-require-imports -- Offline auth and React fixtures. */
const React = require('react'), fs = require('node:fs'), path = require('node:path');
const { loader } = require('../tenh-seven/harness.cjs');
const root = path.resolve(__dirname, '../..');
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test', email_confirmed_at: '2026-10-17T00:00:00Z' };
const env = { TENH_ADMIN_USER_ID: user.id, TENH_ADMIN_EMAIL: user.email };
const pause = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
const flush = () => new Promise(setImmediate);

function dashboardFixture(options = {}) {
  const calls = { member: 0, extraUser: 0, subscription: 0 };
  const overrides = {};
  const source = fs.readFileSync(path.join(root, 'app/dashboard/layout.tsx'), 'utf8');
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+"(@\/components\/[^\"]+)"/g)) {
    overrides[match[2]] = Object.fromEntries(match[1].split(',').map(name => [name.trim(), function FixtureComponent() { return null; }]));
  }
  overrides['next/navigation'] = { redirect(url) { const error = new Error('Synthetic redirect'); error.redirect = url; throw error; } };
  overrides['next/headers'] = { cookies: async () => ({ get: () => undefined }) };
  overrides['@/lib/auth/auth-ticket'] = { verifyAuthTicket: () => null };
  overrides['@/lib/auth/get-current-member'] = { getCurrentMember: async () => {
    calls.member++; await pause(options.delay ?? 0);
    return options.auth ?? { success: true, user: options.user ?? user, member: { id: 'member-A', business_id: 'business-A' } };
  } };
  overrides['@/lib/supabase/server'] = { createClient: async () => ({ auth: { getUser: async () => {
    calls.extraUser++; await pause(options.delay ?? 0); return { data: { user: options.user ?? user }, error: null };
  } } }) };
  overrides['@/lib/subscription/get-business-subscription-access'] = { getBusinessSubscriptionAccess: async () => {
    calls.subscription++; await pause(options.delay ?? 0); return { canAccess: true };
  } };
  const load = loader(overrides, { process: { env: { ...env, ...options.env } } });
  const Layout = load('app/dashboard/layout.tsx').default;
  return { calls, render: () => Layout({ children: 'SYNTHETIC_PRIVATE_CHILD' }) };
}

function loginFixture(options = {}) {
  const slots = [], effects = new Map(), requests = [], navigations = [];
  const window = Object.assign(new EventTarget(), { location: { assign: url => navigations.push(url) } });
  let cursor = 0, tree, pending = [];
  const hooks = { ...React, useSyncExternalStore: () => true,
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
    useEffect(callback, deps) { const slot = cursor++, prior = effects.get(slot); if (!prior || deps.some((value, index) => value !== prior.deps[index])) pending.push({ slot, callback, deps }); },
  };
  const load = loader({ react: hooks, 'next/navigation': { useSearchParams: () => new URLSearchParams(options.params ?? '') },
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
  }, { AbortController, window,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url === '/api/auth/policy') return Response.json({ success: true, rememberDays: 14 });
      if (options.response instanceof Error) throw options.response;
      return typeof options.response === 'function' ? await options.response() : Response.json({ success: true, redirect: '/dashboard/inbox', url: 'https://provider.test/authorize' });
    },
  });
  const Component = load('components/auth/login-form.tsx').LoginForm;
  const nodes = item => !item || typeof item !== 'object' ? [] : [item, ...[item.props?.children].flat(Infinity).flatMap(nodes)];
  function render() {
    cursor = 0; tree = Component(); const run = pending; pending = [];
    for (const effect of run) { effects.get(effect.slot)?.cleanup?.(); effects.set(effect.slot, { deps: effect.deps, cleanup: effect.callback() }); }
  }
  function input(id, value) { nodes(tree).find(node => node.props.id === id).props.onChange({ target: { value, checked: value } }); render(); }
  render(); input('login-email', 'synthetic@example.test'); input('login-password', 'Synthetic123');
  return { requests, navigations, input, render, hasError: () => nodes(tree).some(node => node.props.role === 'alert'), restore: () => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })),
    submit: () => nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    oauth: provider => nodes(tree).filter(node => node.type === 'button')[provider === 'google' ? 0 : 1].props.onClick(),
    async settle() { await flush(); render(); },
    dispose() { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}
module.exports = { dashboardFixture, loginFixture, user };
