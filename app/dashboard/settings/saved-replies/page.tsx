import { SavedReplyManager } from "@/components/settings/saved-reply-manager";
import { getSavedRepliesPageData } from "@/lib/settings/get-saved-replies-page-data";

export const dynamic = "force-dynamic";

export default async function SavedRepliesSettingsPage() {
  const data = await getSavedRepliesPageData();

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Quick Replies
        </h1>

        <p className="mt-2 text-slate-500">
          Create prepared responses for {data.businessName}.
        </p>
      </div>

      <SavedReplyManager
        businessId={data.businessId}
        initialSavedReplies={data.savedReplies}
      />
    </main>
  );
}
