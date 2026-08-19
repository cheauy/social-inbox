"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import {
  TENH_BILLING_CYCLES,
  calculateCustomMonthlyCents,
  calculateCustomTotalCents,
  formatUsdFromCents,
  type BillingCycle,
} from "@/lib/subscription/plan-catalog";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function ConnectionIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M9 12a3 3 0 0 0 3 3h3a3 3 0 1 0 0-6h-1" />
      <path d="M15 12a3 3 0 0 0-3-3H9a3 3 0 1 0 0 6h1" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function CustomSubscriptionBuilder({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [connections, setConnections] = useState(3);
  const [users, setUsers] = useState(1);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthlyCents = useMemo(
    () => calculateCustomMonthlyCents(connections, users) ?? 0,
    [connections, users],
  );

  const totalCents = useMemo(
    () => calculateCustomTotalCents(connections, users, cycle) ?? 0,
    [connections, users, cycle],
  );

  const selectedCycle =
    TENH_BILLING_CYCLES.find((item) => item.id === cycle) ??
    TENH_BILLING_CYCLES[0];

  const grossTotalCents = monthlyCents * selectedCycle.months;

  async function createSubscription() {
    setError(null);
    setWorking(true);

    try {
      const response = await fetch(
        "/api/workspaces/create-subscription",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode: "custom",
            connections,
            users,
            billingCycle: cycle,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        details?: string;
        paymentUrl?: string;
      };

      if (!response.ok || !result.success || !result.paymentUrl) {
        throw new Error(
          result.error ??
            result.details ??
            "Unable to create subscription.",
        );
      }

      window.location.assign(result.paymentUrl);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create subscription.",
      );
      setWorking(false);
    }
  }

  return (
    <section
      id={embedded ? undefined : "custom-subscription"}
      className={`${
        embedded ? "" : "mt-6 "
      }overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm`}
    >
      <div className="border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white px-6 py-5 sm:px-7">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
          Build your plan
        </p>
        <h2 className="mt-1 text-2xl font-bold text-slate-950">
          Create Custom Subscription
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Build your custom subscription the way your business needs it. Choose
          the connection capacity, team size, and billing duration that fit your
          customer support workflow.
        </p>
      </div>

      <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <ConnectionIcon />
                </span>
                <p className="text-sm font-semibold text-slate-800">
                  Connections
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setConnections((value) =>
                      clamp(value - 1, 3, 30),
                    )
                  }
                  className="h-10 w-10 rounded-xl border border-slate-300 font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={connections}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setConnections(
                      clamp(Number(event.target.value) || 3, 3, 30),
                    )
                  }
                  className="h-10 w-20 rounded-xl border border-slate-300 text-center font-bold"
                />
                <button
                  type="button"
                  onClick={() =>
                    setConnections((value) =>
                      clamp(value + 1, 3, 30),
                    )
                  }
                  className="h-10 w-10 rounded-xl border border-slate-300 font-bold"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <TeamIcon />
                </span>
                <p className="text-sm font-semibold text-slate-800">
                  Team users
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setUsers((value) =>
                      clamp(value - 1, 1, 100),
                    )
                  }
                  className="h-10 w-10 rounded-xl border border-slate-300 font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={users}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setUsers(
                      clamp(Number(event.target.value) || 1, 1, 100),
                    )
                  }
                  className="h-10 w-20 rounded-xl border border-slate-300 text-center font-bold"
                />
                <button
                  type="button"
                  onClick={() =>
                    setUsers((value) =>
                      clamp(value + 1, 1, 100),
                    )
                  }
                  className="h-10 w-10 rounded-xl border border-slate-300 font-bold"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-800">
              Duration
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TENH_BILLING_CYCLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCycle(item.id)}
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    cycle === item.id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"
                  }`}
                >
                  {item.label}
                  {item.discount > 0 ? (
                    <span className="mt-1 block text-[10px] opacity-80">
                      Save {Math.round(item.discount * 100)}%
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] bg-slate-950 p-6 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
            Custom plan
          </p>

          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Connections</span>
              <strong className="text-white">{connections}</strong>
            </div>
            <div className="flex justify-between">
              <span>Users</span>
              <strong className="text-white">{users}</strong>
            </div>
            <div className="flex justify-between">
              <span>Duration</span>
              <strong className="text-white">
                {selectedCycle.label}
              </strong>
            </div>

            <div className="border-t border-slate-700 pt-3">
              <div className="flex justify-between">
                <span>Total</span>
                <strong className="text-white">
                  {formatUsdFromCents(grossTotalCents)}
                </strong>
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-slate-400">Duration discount</span>
                <strong className={selectedCycle.discount > 0 ? "text-emerald-300" : "text-slate-300"}>
                  {selectedCycle.discount > 0
                    ? `-${Math.round(selectedCycle.discount * 100)}%`
                    : "0%"}
                </strong>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-700 pt-5">
            <p className="text-xs text-slate-400">
              Pay for {selectedCycle.label}
            </p>
            <p className="mt-1 text-3xl font-bold">
              {formatUsdFromCents(totalCents)}
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-300">
              After discount
            </p>
          </div>

          <button
            type="button"
            disabled={working}
            onClick={() => void createSubscription()}
            className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {working ? "Creating..." : "Continue to payment"}
          </button>


        </div>
      </div>
    </section>
  );
}
