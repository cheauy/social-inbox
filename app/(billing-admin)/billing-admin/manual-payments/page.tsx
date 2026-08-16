import { redirect } from "next/navigation";

export default function LegacyManualPaymentAdminPage() {
  redirect("/dashboard/admin?tab=manual-payments");
}
