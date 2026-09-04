import { MarketingPage } from "@/components/marketing/marketing-page";

/*
 * In-app review copy of the public marketing page, so the team can look at
 * it while signed in. The dashboard shell owns the height, so the scroll
 * container lives here rather than inside the shared component.
 */
export default function DashboardMarketPage() {
  return (
    <div className="h-full overflow-y-auto">
      <MarketingPage />
    </div>
  );
}
