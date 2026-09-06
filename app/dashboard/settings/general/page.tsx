import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";

export default function GeneralSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)]">
      <div>
        <h2 className="text-3xl font-bold text-slate-900">
          <WorkspaceLanguageText en="General" km="ទូទៅ" />
        </h2>

        <p className="mt-2 text-slate-500">
          <WorkspaceLanguageText
            en="Manage the general configuration for Tenh Chat."
            km="គ្រប់គ្រងការកំណត់ទូទៅសម្រាប់ Tenh Chat។"
          />
        </p>
      </div>

      <NotificationSettingsCard />
    </main>
  );
}
