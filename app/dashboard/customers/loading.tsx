import { DashboardLoadingSkeleton } from "@/components/dashboard/dashboard-loading-skeleton";

export default function CustomersLoading() {
  return (
    <DashboardLoadingSkeleton
      label="customers"
      panel="split"
    />
  );
}
