"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SettingsItem = {
  label: string;
  href: string;
  icon: string;
  badge?: string;
};

const settingsItems: SettingsItem[] = [
  {
    label: "General",
    href: "/dashboard/settings/general",
    icon: "⚙",
  },
  {
    label: "Conversation Tags",
    href: "/dashboard/settings/tags",
    icon: "◇",
  },

  {
  label: "Quick Replies",
  href: "/dashboard/settings/saved-replies",
  icon: "💬",
},
  {
    label: "Display",
    href: "/dashboard/settings/display",
    icon: "▣",
  },
  {
    label: "Call",
    href: "/dashboard/settings/calls",
    icon: "☎",
  },


  {
    label: "User permissions",
    href: "/dashboard/settings/users",
    icon: "♙",
  },
  {
    label: "Settings history",
    href: "/dashboard/settings/history",
    icon: "◴",
  },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-r border-slate-200 bg-white px-5 py-7">
    
      <nav className="mt-6 space-y-2">
        {settingsItems.map((item) => {
          const isActive =
            pathname === item.href ||
            pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 rounded-xl px-4 py-3 text-base transition ${
                isActive
                  ? "bg-slate-100 font-semibold text-blue-700"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
            >
              <span className="flex w-6 justify-center text-xl">
                {item.icon}
              </span>

              <span className="min-w-0 flex-1">
                {item.label}
              </span>

              {item.badge ? (
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}