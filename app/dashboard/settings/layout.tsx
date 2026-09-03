import type { ReactNode } from "react";

import { SettingsSidebar } from "@/components/settings/settings-sidebar";

type SettingsLayoutProps = {
  children: ReactNode;
};

export default function SettingsLayout({
  children,
}: SettingsLayoutProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[205px_minmax(0,1fr)] overflow-hidden">
      <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-white">
        <SettingsSidebar />
      </aside>

      <main className="min-h-0 overflow-y-auto bg-slate-100">
        {children}
      </main>
    </div>
  );
}
