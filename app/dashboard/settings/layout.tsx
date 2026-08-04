import type { ReactNode } from "react";

import { SettingsSidebar } from "@/components/settings/settings-sidebar";

type SettingsLayoutProps = {
  children: ReactNode;
};

export default function SettingsLayout({
  children,
}: SettingsLayoutProps) {
  return (
    <div className="grid min-h-[calc(100vh-64px)] bg-slate-50 lg:grid-cols-[320px_minmax(0,1fr)]">
      <SettingsSidebar />

      <section className="min-w-0 p-6 lg:p-8">
        {children}
      </section>
    </div>
  );
}