import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { SavedReplyManager } from "@/components/settings/saved-reply-manager";
import { getSavedRepliesPageData } from "@/lib/settings/get-saved-replies-page-data";

export const dynamic = "force-dynamic";

export default async function SavedRepliesSettingsPage() {
  const data = await getSavedRepliesPageData();

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)]">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          <WorkspaceLanguageText
            en="Quick Replies"
            km="ការឆ្លើយតបរហ័ស"
          />
        </h1>

        <p className="mt-2 text-slate-500">
          <WorkspaceLanguageText
            en={`Create prepared responses for ${data.businessName}.`}
            km={`បង្កើតការឆ្លើយតបដែលបានរៀបចំរួចសម្រាប់ ${data.businessName}។`}
          />
        </p>
      </div>

      <SavedReplyManager
        businessId={data.businessId}
        initialSavedReplies={data.savedReplies}
      />
    </main>
  );
}
