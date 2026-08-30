import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { CustomerReportForm } from "@/components/support/customer-report-form";

export const dynamic = "force-dynamic";

export default function ReportProblemSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">
          <WorkspaceLanguageText
            en="Report a problem"
            km="រាយការណ៍បញ្ហា"
          />
        </h2>

        <p className="mt-2 text-slate-500">
          <WorkspaceLanguageText
            en="Report a TENH system issue to the admin team and review their replies."
            km="រាយការណ៍បញ្ហាប្រព័ន្ធ TENH ទៅក្រុមអ្នកគ្រប់គ្រង និងពិនិត្យការឆ្លើយតបរបស់ពួកគេ។"
          />
        </p>
      </div>

      <CustomerReportForm />
    </main>
  );
}
