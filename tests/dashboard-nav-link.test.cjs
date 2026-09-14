const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
for (const [path, href, active] of [
  ['/dashboard/inbox', '/dashboard/inbox', true],
  ['/dashboard/settings/display', '/dashboard/settings', true],
  ['/dashboard/inbox', '/dashboard/admin', false],
  ['/dashboard/settings-other', '/dashboard/settings', false],
]) test(`navigation ${path} selects ${href}: ${active}`, () => {
  const jsx = (type, props) => ({ type, props });
  const load = loader({ 'react/jsx-runtime': { jsx }, 'next/link': { __esModule: true, default: 'Link' }, 'next/navigation': { usePathname: () => path } });
  const node = load('components/dashboard/dashboard-nav-link.tsx').DashboardNavLink({ href, children: 'label' });
  assert.equal(node.props['aria-current'], active ? 'page' : undefined);
  assert.equal(node.type, href === '/dashboard/inbox' ? 'a' : 'Link');
});
