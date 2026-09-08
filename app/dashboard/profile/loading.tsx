import { DashboardLoadingSkeleton } from "@/components/dashboard/dashboard-loading-skeleton";

export default function ProfileLoading() {
  return (
    <DashboardLoadingSkeleton
      label="your profile"
      panel="tall"
    />
  );
}
