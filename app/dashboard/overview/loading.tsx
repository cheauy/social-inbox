import { DashboardLoadingSkeleton } from "@/components/dashboard/dashboard-loading-skeleton";

export default function OverviewLoading() {
  return (
    <DashboardLoadingSkeleton
      label="the overview"
      panel="short"
    />
  );
}
