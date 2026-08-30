import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { TagManager } from "@/components/settings/tag-manager";
import { getTagSettingsPageData } from "@/lib/settings/get-tag-settings-page-data";

export const dynamic = "force-dynamic";

export default async function CustomerTagsSettingsPage() {
  const data =
    await getTagSettingsPageData();

return (
  <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)]">
    <div>
      <h2 className="text-3xl font-bold tracking-tight text-slate-900">
        <WorkspaceLanguageText
          en="Conversation Tags"
          km="ស្លាកការសន្ទនា"
        />
      </h2>

      <p className="mt-2 text-slate-500">
        <WorkspaceLanguageText
          en="Create, edit, order, disable, and delete customer conversation tags."
          km="បង្កើត កែសម្រួល រៀបលំដាប់ បិទដំណើរការ និងលុបស្លាកសម្រាប់ការសន្ទនារបស់អតិថិជន។"
        />
      </p>
    </div>

    <TagManager
      businessId={data.businessId}
      businessName={data.businessName}
      initialTags={data.tags}
    />
  </main>
);
}
