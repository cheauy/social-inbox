import Image from "next/image";
import { Suspense } from "react";

import { RegisterForm } from "@/components/auth/register-form";

type RegisterPageProps = {
  searchParams: Promise<{
    invite?: string | string[];
  }>;
};

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams;
  const inviteValue = Array.isArray(params.invite)
    ? params.invite[0]
    : params.invite;
  const joiningExistingWorkspace = Boolean(inviteValue?.trim());

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
      <div className="absolute inset-0 bg-slate-950/15" />

      <div className="relative z-10 grid w-full max-w-[1080px] overflow-hidden rounded-[30px] border border-white/20 bg-white shadow-[0_30px_100px_rgba(0,0,0,0.45)] lg:grid-cols-[1fr_1fr]">
        <section className="relative hidden min-h-[680px] overflow-hidden bg-[#07143A] p-10 text-white lg:flex lg:flex-col">
          <div className="relative">
            <Image
              src="/images/tenh_logo.png"
              alt="Tenh Chat"
              width={130}
              height={130}
              priority
              className="h-28 w-28 object-contain"
            />

            <h1 className="mt-7 text-5xl font-bold tracking-tight">
              {joiningExistingWorkspace
                ? "Join your TENH team"
                : "Create your workspace"}
            </h1>

            <p className="mt-5 max-w-lg text-base leading-8 text-slate-300">
              {joiningExistingWorkspace
                ? "Create your TENH login, verify the invited email, and join the existing subscription without creating another trial."
                : "Set up your team workspace to manage customer conversations, organize customer information, assign teammates, and deliver faster support."}
            </p>
          </div>
        </section>

        <section className="flex min-h-[680px] items-center bg-white px-7 py-9 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-[420px]">
            <h2 className="text-4xl font-bold tracking-tight text-slate-950">
              Create account
            </h2>

            <p className="mt-2 text-base text-slate-500">
              Register your Tenh Chat account.
            </p>

            <Suspense
              fallback={
                <div className="mt-8 h-96 animate-pulse rounded-2xl bg-slate-100" />
              }
            >
              <RegisterForm />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}