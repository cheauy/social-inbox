import { TagManager } from "@/components/settings/tag-manager";
import { getTagSettingsPageData } from "@/lib/settings/get-tag-settings-page-data";

export const dynamic = "force-dynamic";

export default async function CustomerTagsSettingsPage() {
  const data =
    await getTagSettingsPageData();

return (
  <main className="mx-auto max-w-6xl space-y-6">
    <div>
      <h2 className="text-3xl font-bold tracking-tight text-slate-900">
        Conversation Tags
      </h2>

      <p className="mt-2 text-slate-500">
        Create, edit, order, disable, and delete
        customer conversation tags.
      </p>
    </div>

    <TagManager
      businessId={data.businessId}
      initialTags={data.tags}
    />
  </main>
);
}
