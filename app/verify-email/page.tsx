import Image from "next/image";
import { Suspense } from "react";

import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export default function VerifyEmailPage() {
  return (
    <main
      className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4 sm:p-6"
      style={{
        backgroundImage:
          "url('/images/background-login.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-slate-950/20" />

      <div className="relative z-10 w-full max-w-md rounded-[28px] border border-white/20 bg-white p-8 shadow-[0_30px_100px_rgba(0,0,0,0.45)] sm:p-10">
        <Image
          src="/images/tenh_logo.png"
          alt="Tenh Chat"
          width={80}
          height={80}
          priority
          className="mx-auto h-20 w-20 object-contain"
        />

        <div className="mt-6 text-center">
          <h1 className="text-3xl font-bold text-slate-950">
            Verify your email
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Enter the eight-digit code we sent to your email.
          </p>
        </div>

        <Suspense
          fallback={
            <p className="mt-8 text-center text-sm text-slate-500">
              Loading verification form...
            </p>
          }
        >
          <VerifyEmailForm />
        </Suspense>
      </div>
    </main>
  );
}