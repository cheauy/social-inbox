import { SubscriptionView } from "@/components/subscription/subscription-view";
import { BakongPaymentView } from "@/components/subscription/bakong-payment-view";

export default async function SubscriptionPage({ searchParams }: {
  searchParams: Promise<{ bakong_closed?: string | string[]; purchase_business?: string | string[] }>;
}) {
  const params = await searchParams;
  const attemptId = typeof params.bakong_closed === "string" ? params.bakong_closed.trim() : "";
  const businessId = typeof params.purchase_business === "string" ? params.purchase_business.trim() : "";
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      {uuid.test(attemptId) && uuid.test(businessId) ? <BakongPaymentView key={`${attemptId}:${businessId}`} attemptId={attemptId} businessId={businessId} qrClosed /> : null}
      <SubscriptionView />
    </div>
  );
}
