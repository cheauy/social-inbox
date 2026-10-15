import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return <AuthPageShell title={{ en: "Forgot password?", km: "ភ្លេចពាក្យសម្ងាត់?" }} description={{ en: "Enter your account email to request a password reset link.", km: "បញ្ចូលអ៊ីមែលគណនីដើម្បីស្នើតំណកំណត់ពាក្យសម្ងាត់ឡើងវិញ។" }}><ForgotPasswordForm /></AuthPageShell>;
}
