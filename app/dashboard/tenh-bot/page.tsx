import { TENH_BOT_AVAILABLE } from "@/lib/bot/availability";
import { TenhBotComingSoon } from "@/components/bot/tenh-bot-coming-soon";
import { TenhBotWorkspace } from "@/components/bot/tenh-bot-workspace";
import { requirePermission } from "@/lib/auth/require-permission";
export default async function TenhBotPage() {
  if(!TENH_BOT_AVAILABLE)return <TenhBotComingSoon/>;
  const guard = await requirePermission("channels", "view");
  if (!guard.success) return <p role="alert" className="p-6">You do not have access to Tenh Bot in this workspace.</p>;
  return <TenhBotWorkspace key={guard.context.member.business_id} />;
}
