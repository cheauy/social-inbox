import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return <AuthPageShell title={{ en: "Reset password", km: "កំណត់ពាក្យសម្ងាត់ឡើងវិញ" }} description={{ en: "Choose a new password for your TENH account.", km: "ជ្រើសរើសពាក្យសម្ងាត់ថ្មីសម្រាប់គណនី TENH របស់អ្នក។" }}><ResetPasswordForm /></AuthPageShell>;
}
