import Image from "next/image";
import Link from "next/link";

import { CurrentUserProfileMenu } from "@/components/dashboard/current-user-profile-menu";
import { TeamNotificationCenter } from "@/components/dashboard/team-notification-center";
import { DashboardNavigationLabel } from "@/components/dashboard/dashboard-navigation-label";
import { GroupChatNavBadge } from "@/components/dashboard/group-chat-nav-badge";
import { NavPermissionGate } from "@/components/dashboard/nav-permission-gate";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { isCurrentUserTenhAdminIdentity } from "@/lib/admin/tenh-admin-auth";

const normalNavigation = [
  { label: "Inbox", href: "/dashboard/inbox" },
  { label: "Group Chat", href: "/dashboard/group-chat" },
  { label: "Analytics", href: "/dashboard/analytics" },
  { label: "Subscription", href: "/dashboard/subscription" },
  { label: "Integrations", href: "/dashboard/integrations" },
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
    <header className="flex h-[72px] shrink-0 items-center border-b border-slate-200 bg-white px-5">
      <div className="flex w-full min-w-0 items-center">
        <Link
          href="/dashboard/inbox"
          className="flex shrink-0 items-center gap-3"
          aria-label="Go to inbox"
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
        </Link>

        <nav className="ml-8 hidden items-center gap-1 md:flex">
          {navigation.map((item) => {
            const adminItem = item.href === "/dashboard/admin";

            // Integrations disappears entirely when the member has no
            // channel access. Everything else is always shown.
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={
                  adminItem
                    ? "relative rounded-lg border border-slate-900 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                    : "relative rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                }
              >
                <DashboardNavigationLabel label={item.label} />

                {item.href === "/dashboard/group-chat" ? (
                  <GroupChatNavBadge />
                ) : null}
              </Link>
            );

            if (item.href === "/dashboard/integrations") {
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
