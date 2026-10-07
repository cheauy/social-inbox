const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
for (const [path, href, active] of [
  ['/dashboard/inbox', '/dashboard/inbox', true],
  ['/dashboard/analytics', '/dashboard/inbox', false],
  ['/dashboard/settings/display', '/dashboard/settings', true],
  ['/dashboard/inbox', '/dashboard/admin', false],
  ['/dashboard/settings-other', '/dashboard/settings', false],
]) test(`navigation ${path} selects ${href}: ${active}`, () => {
  const jsx = (type, props) => ({ type, props });
  const load = loader({ './inbox-return-context': { useInboxReturnHref: () => '/dashboard/inbox' }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { __esModule: true, default: 'Link' }, 'next/navigation': { usePathname: () => path } });
  const node = load('components/dashboard/dashboard-nav-link.tsx').DashboardNavLink({ href, children: 'label' });
  assert.equal(node.props['aria-current'], active ? 'page' : undefined);
  assert.equal(node.type, 'Link');
  if (href === '/dashboard/inbox' && active) {
    let prevented = false;
    node.props.onNavigate({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'active Inbox does not reload or reset the URL');
  } else assert.equal(node.props.onNavigate, undefined);
  if(href==='/dashboard/inbox'&&!active)assert.equal(node.props.prefetch,false,'return to Inbox adds no speculative data fetch');
});
