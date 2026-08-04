import Image from "next/image";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";

function LoginFormLoading() {
  return (
    <div className="mt-8 flex min-h-[420px] items-center justify-center">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

        Loading sign-in form...
      </div>
    </div>
  );
}

export default function LoginPage() {
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
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-slate-950/30" />

      <div className="relative z-10 grid w-full max-w-[1080px] overflow-hidden rounded-[30px] border border-white/20 bg-white shadow-[0_30px_100px_rgba(0,0,0,0.45)] lg:grid-cols-[1fr_1fr]">
        {/* Left branding */}
        <section className="relative hidden min-h-[680px] overflow-hidden bg-[#08132F]/95 p-12 text-white backdrop-blur-sm lg:flex lg:flex-col">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -bottom-28 -left-36 h-[420px] w-[560px] rounded-full border border-blue-400/40 bg-blue-500/10 blur-xl" />

            <div className="absolute -right-40 top-32 h-[520px] w-[520px] rounded-full border border-blue-500/30" />

            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_45%)]" />
          </div>

          <div className="relative">
            <Image
              src="/images/tenh_logo.png"
              alt="Tenh Chat"
              width={150}
              height={150}
              priority
              className="h-28 w-28 object-contain"
            />

            <h1 className="mt-8 text-5xl font-bold tracking-tight">
              Tenh Chat
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
              Bring your Facebook Messenger conversations,
              customer profiles, notes, tags, and team
              collaboration together in one powerful platform.
            </p>
          </div>

          <div className="relative mt-auto rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-start gap-4">
              <Image
                src="/images/tenh_logo.png"
                alt="Tenh Chat"
                width={50}
                height={50}
                className="h-12 w-12 shrink-0 object-contain"
              />

              <div>
                <p className="text-lg font-semibold">
                  Communication Platform
                </p>

                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Handle customer messages, assign teammates,
                  and grow your business from a single platform.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Right login form */}
        <section className="flex min-h-[680px] items-center bg-white px-7 py-9 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-[420px]">
            <div className="lg:hidden">
              <Image
                src="/images/tenh_logo.png"
                alt="Tenh Chat"
                width={78}
                height={78}
                priority
                className="h-16 w-16 object-contain"
              />
            </div>

            <h2 className="mt-6 text-4xl font-bold tracking-tight text-slate-950 lg:mt-0">
              Welcome
            </h2>

            <p className="mt-2 text-base text-slate-500">
              Sign in to manage your customer conversations.
            </p>

            <Suspense fallback={<LoginFormLoading />}>
              <LoginForm />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}