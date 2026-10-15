import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export default function VerifyEmailPage() {
  return <AuthPageShell title={{ en: "Verify your email", km: "ផ្ទៀងផ្ទាត់អ៊ីមែលរបស់អ្នក" }} description={{ en: "Enter the verification code sent to your email.", km: "បញ្ចូលលេខកូដផ្ទៀងផ្ទាត់ដែលបានផ្ញើទៅអ៊ីមែលរបស់អ្នក។" }}><Suspense fallback={<div role="status" className="mt-7 h-36 animate-pulse rounded-xl bg-slate-50" />}><VerifyEmailForm /></Suspense></AuthPageShell>;
}
