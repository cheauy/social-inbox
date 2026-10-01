import test from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './tenh-seven/harness.cjs';

test('dashboard header renders with the shared Tenh Bot availability gate', async () => {
  const links = [];
  const jsx = (type, props) => {
    if (type === 'DashboardNavLink') links.push(props.href);
    return { type, props };
  };
  const load = loader({
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/image': { __esModule: true, default: 'Image' },
    './dashboard-nav-link': { DashboardNavLink: 'DashboardNavLink' },
    './dashboard-loading-progress': { DashboardLoadingProgress: 'DashboardLoadingProgress' },
    '@/components/dashboard/current-user-profile-menu': { CurrentUserProfileMenu: 'CurrentUserProfileMenu' },
    '@/components/dashboard/team-notification-center': { TeamNotificationCenter: 'TeamNotificationCenter' },
    '@/components/dashboard/dashboard-navigation-label': { DashboardNavigationLabel: 'DashboardNavigationLabel' },
    '@/components/dashboard/nav-permission-gate': { NavPermissionGate: 'NavPermissionGate' },
    '@/components/dashboard/workspace-switcher': { WorkspaceSwitcher: 'WorkspaceSwitcher' },
  });

  const header = await load('components/dashboard/dashboard-header.tsx').DashboardHeader();
  const { TENH_BOT_AVAILABLE } = load('lib/bot/availability.ts');
  assert.equal(header.type, 'header');
  assert.equal(links.includes('/dashboard/tenh-bot'), TENH_BOT_AVAILABLE);
  for (const route of ['inbox', 'analytics', 'subscription', 'integrations']) {
    assert.ok(links.includes(`/dashboard/${route}`));
  }
});
