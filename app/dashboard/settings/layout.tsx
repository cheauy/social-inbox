import type { ReactNode } from "react";

import { SettingsSidebar } from "@/components/settings/settings-sidebar";

type SettingsLayoutProps = {
  children: ReactNode;
};

export default function SettingsLayout({
  children,
}: SettingsLayoutProps) {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-50 p-1.5 sm:p-2.5">
      <div data-settings-surface className="grid h-full min-h-0 grid-cols-[205px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.06)]">
        <aside className="min-h-0 overflow-hidden border-r border-slate-200/70 bg-white">
          <SettingsSidebar />
        </aside>

        <main className="min-h-0 overflow-y-auto bg-slate-100">
          {children}
        </main>
      </div>
    </div>
  );
}
