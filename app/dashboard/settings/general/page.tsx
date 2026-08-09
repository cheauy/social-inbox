import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";

export default function GeneralSettingsPage() {
  return (
    <main className="mx-auto max-w-5xl">
      <div>
        <h2 className="text-3xl font-bold text-slate-900">
          General
        </h2>

        <p className="mt-2 text-slate-500">
          Manage the general configuration for Tenh Chat.
        </p>
      </div>

      <NotificationSettingsCard />

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">
          Business settings
        </h3>

        <p className="mt-1 text-sm text-slate-500">
          More general business settings can be added here later.
        </p>
      </div>
    </main>
  );
}
