import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <AuthPageShell wide title={{ en: "Welcome", km: "សូមស្វាគមន៍" }} description={{ en: "Sign in to manage your customer conversations.", km: "ចូលគណនីដើម្បីគ្រប់គ្រងការសន្ទនាជាមួយអតិថិជនរបស់អ្នក។" }}>
    <Suspense fallback={<div role="status" className="mt-8 h-40 animate-pulse rounded-xl bg-slate-50" />}><LoginForm /></Suspense>
  </AuthPageShell>;
}
