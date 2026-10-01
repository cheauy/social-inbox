import Image from "next/image";
import { DashboardNavLink } from "./dashboard-nav-link";

import { CurrentUserProfileMenu } from "@/components/dashboard/current-user-profile-menu";
import { TeamNotificationCenter } from "@/components/dashboard/team-notification-center";
import { DashboardNavigationLabel } from "@/components/dashboard/dashboard-navigation-label";
import { NavPermissionGate } from "@/components/dashboard/nav-permission-gate";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { isCurrentUserTenhAdminIdentity } from "@/lib/admin/tenh-admin-auth";

type NavItem = {
  label: string;
  href: string;
};

const normalNavigation: NavItem[] = [
  { label: "Inbox", href: "/dashboard/inbox" },
  { label: "Tenh Bot", href: "/dashboard/tenh-bot" },
  { label: "Analytics", href: "/dashboard/analytics" },
  { label: "Subscription", href: "/dashboard/subscription" },
  { label: "Integrations", href: "/dashboard/integrations" },
  /*
   * No marketing link. It pointed at market.tenhchat.com, which is retired in
   * favour of tenhchat.com, and it sat between Integrations and Settings in
   * the working nav -- an outward link where every other item is somewhere the
   * agent does their job. The page itself is still reviewable at
   * /dashboard/market.
   */
  { label: "Settings", href: "/dashboard/settings" },
];

export async function DashboardHeader() {
  const isAdmin = await isCurrentUserTenhAdminIdentity();
  const navigation = isAdmin
    ? [
        ...normalNavigation,
        { label: "Admin", href: "/dashboard/admin" },
      ]
    : normalNavigation;

  return (
    <header data-dashboard-header className="flex h-[72px] shrink-0 items-center border-b border-slate-200 bg-white px-5">
      <div className="flex w-full min-w-0 items-center">
        <a
          href="/dashboard/inbox"
          className="flex shrink-0 items-center gap-3"
          aria-label="Refresh inbox"
        >
          <Image
            src="/images/tenh_logo.png"
            alt="Tenh Chat"
            width={46}
            height={46}
            priority
            className="h-11 w-11 object-contain"
          />

          <div className="hidden sm:block">
            <p className="text-lg font-bold leading-tight text-slate-950">
              Tenh Chat
            </p>
            <p className="text-xs text-slate-500">
              Customer messaging
            </p>
          </div>
        </a>

        <nav className="ml-8 hidden items-center gap-1 md:flex">
          {navigation.map((item) => {
            const linkContent = (
              <>
                <DashboardNavigationLabel label={item.label} />

              </>
            );

            const link = <DashboardNavLink key={item.href} href={item.href}>{linkContent}</DashboardNavLink>;

            if (item.href === "/dashboard/integrations" || item.href === "/dashboard/tenh-bot") {
              return (
                <NavPermissionGate
                  key={item.href}
                  permission="channels"
                  level="view"
                >
                  {link}
                </NavPermissionGate>
              );
            }

            return link;
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <WorkspaceSwitcher />
          <TeamNotificationCenter />
          <CurrentUserProfileMenu />
        </div>
      </div>
    </header>
  );
}
