import { AutoReplySettings } from "@/components/settings/auto-reply-settings";
import { requirePermission } from "@/lib/auth/require-permission";
export default async function TenhBotPage() {
  const guard = await requirePermission("channels", "view");
  if (!guard.success) return <p role="alert" className="p-6">You do not have access to Tenh Bot in this workspace.</p>;
  return <div className="h-full min-h-0 overflow-y-auto bg-slate-100">
    <AutoReplySettings key={guard.context.member.business_id} />
  </div>;
}
