"use client";

import { useMemo, useState } from "react";

type BillingCycle =
  | "monthly"
  | "3-months"
  | "6-months"
  | "12-months";

type Plan = {
  id: "mini" | "standard" | "pro";
  name: string;
  description: string;
  connections: number | "Unlimited";
  users: number | "Unlimited";
  monthlyPrice: number;
  oldMonthlyPrice?: number;
  accent: string;
  buttonClass: string;
  badge?: string;
  badgeClass?: string;
  ribbon?: string;
};

type SubscriptionRecord = {
  id: string;
  planName: string;
  billingCycle: string;
  startDate: string;
  endDate: string;
  amount: number;
  status:
    | "active"
    | "pending"
    | "expired"
    | "cancelled";
};

const plans: Plan[] = [
  {
    id: "mini",
    name: "Mini",
    description:
      "Tailored for solo entrepreneurs",
    connections: 1,
    users: 3,
    monthlyPrice: 9,
    oldMonthlyPrice: 12,
    accent: "border-t-4 border-t-emerald-500",
    buttonClass:
      "bg-slate-100 text-slate-800 hover:bg-slate-200",
  },

  
  {
    id: "standard",
    name: "Standard",
    description:
      "Perfect for small support teams",
    connections: 3,
    users: 5,
    monthlyPrice: 19,
    oldMonthlyPrice: 24,
    accent: "border-t-4 border-t-blue-500",
    buttonClass:
      "bg-blue-600 text-white hover:bg-blue-700",
    badge: "🔥 Best-selling",
    badgeClass:
      "bg-blue-100 text-blue-700",
    ribbon: "MOST POPULAR",
  },
  {
    id: "pro",
    name: "Pro",
    description:
      "Suitable for growing businesses",
    connections: 6,
    users: 10,
    monthlyPrice: 49,
    oldMonthlyPrice: 59,
    accent: "border-t-4 border-t-amber-500",
    buttonClass:
      "bg-slate-100 text-slate-800 hover:bg-slate-200",
    badge: "☀ Best choice",
    badgeClass:
      "bg-amber-100 text-amber-700",
  },
];

const subscriptions: SubscriptionRecord[] = [
  {
    id: "SUB-20260804-0012",
    planName: "Standard",
    billingCycle: "3 months",
    startDate: "Aug 4, 2026",
    endDate: "Nov 4, 2026",
    amount: 54.7,
    status: "active",
  },
  {
    id: "SUB-20260501-0008",
    planName: "Mini",
    billingCycle: "3 months",
    startDate: "May 1, 2026",
    endDate: "Aug 1, 2026",
    amount: 25.9,
    status: "expired",
  },
];

const cycles: Array<{
  id: BillingCycle;
  label: string;
  months: number;
  discount: number;
}> = [
  {
    id: "3-months",
    label: "3 months",
    months: 3,
    discount: 0.1,
  },
  {
    id: "6-months",
    label: "6 months",
    months: 6,
    discount: 0.18,
  },
  {
    id: "12-months",
    label: "12 months",
    months: 12,
    discount: 0.3,
  },
  {
    id: "monthly",
    label: "Monthly",
    months: 1,
    discount: 0,
  },
];

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function FeatureIcon({
  type,
}: {
  type: "connection" | "users" | "duration";
}) {
  if (type === "connection") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M5 5v14M5 7c4-3 8 3 14 0v9c-6 3-10-3-14 0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "users") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="9" cy="8" r="3" />
        <path
          d="M3.5 18a5.5 5.5 0 0 1 11 0"
          strokeLinecap="round"
        />
        <path
          d="M16 6.5a3 3 0 0 1 0 5M18 14.5a5 5 0 0 1 2.5 4.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="13" r="7" />
      <path
        d="M12 9v4l2.5 1.5M9 3h6M12 3v3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getSubscriptionStatusClasses(
  status: SubscriptionRecord["status"],
) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";

    case "pending":
      return "bg-amber-100 text-amber-700";

    case "expired":
      return "bg-slate-100 text-slate-600";

    case "cancelled":
      return "bg-red-100 text-red-700";
  }
}

type DetailItemProps = {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
};

function DetailItem({
  label,
  value,
  mono = false,
  capitalize = false,
}: DetailItemProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p
        className={`mt-2 text-sm font-semibold text-slate-900 ${
          mono ? "font-mono" : ""
        } ${capitalize ? "capitalize" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function PlanLimit({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-600">
        {label}
      </span>

      <span className="text-sm font-semibold text-slate-900">
        {value}
      </span>
    </div>
  );
}

function BillingRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-slate-500">
        {label}
      </span>

      <span className="text-sm font-semibold text-slate-900">
        {value}
      </span>
    </div>
  );
}

export function SubscriptionView() {
  const [modalOpen, setModalOpen] =
    useState(true);

  const [cycle, setCycle] =
    useState<BillingCycle>("3-months");

  const [selectedPlan, setSelectedPlan] =
    useState<Plan["id"] | null>(null);

    const [
  selectedSubscription,
  setSelectedSubscription,
] = useState<SubscriptionRecord | null>(null);


  const selectedCycle = useMemo(
    () =>
      cycles.find(
        (item) => item.id === cycle,
      ) ?? cycles[0],
    [cycle],
  );

  function getPlanPrice(plan: Plan) {
    const subtotal =
      plan.monthlyPrice *
      selectedCycle.months;

    return (
      subtotal *
      (1 - selectedCycle.discount)
    );
  }

  function getOldPlanPrice(plan: Plan) {
    const base =
      plan.oldMonthlyPrice ??
      plan.monthlyPrice;

    return base * selectedCycle.months;
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">
            Subscription
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Manage your Tenh Chat plan,
            billing cycle, and payment details.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setModalOpen(true)
          }
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          + New subscription
        </button>
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Current plan
          </p>

          <p className="mt-3 text-2xl font-bold text-slate-950">
            No active plan
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Choose a subscription to activate
            your workspace.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Next billing date
          </p>

          <p className="mt-3 text-2xl font-bold text-slate-950">
            —
          </p>

          <p className="mt-2 text-sm text-slate-500">
            No upcoming payment.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Payment method
          </p>

          <p className="mt-3 text-2xl font-bold text-slate-950">
            Not added
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Add a payment method after
            choosing a plan.
          </p>
        </div>
      </div>

      <div className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
  <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="text-lg font-bold text-slate-950">
        Current subscriptions
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        View your active and previous subscription records.
      </p>
    </div>

    <div className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
      {subscriptions.length} subscriptions
    </div>
  </div>

  {subscriptions.length === 0 ? (
    <div className="p-10 text-center">
      <p className="font-semibold text-slate-900">
        No subscriptions yet
      </p>

      <p className="mt-1 text-sm text-slate-500">
        Choose a plan to create your first subscription.
      </p>
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Subscription ID
            </th>

            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Plan
            </th>

            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Billing cycle
            </th>

            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Period
            </th>

            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Amount
            </th>

            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              Status
            </th>

            <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
              Action
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {subscriptions.map((subscription) => (
            <tr
              key={subscription.id}
              className="transition hover:bg-slate-50"
            >
              <td className="whitespace-nowrap px-6 py-4">
                <button
                  type="button"
                  className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  {subscription.id}
                </button>
              </td>

              <td className="whitespace-nowrap px-6 py-4">
                <p className="font-semibold text-slate-900">
                  {subscription.planName}
                </p>
              </td>

              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                {subscription.billingCycle}
              </td>

              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                <p>{subscription.startDate}</p>

                <p className="mt-1 text-xs text-slate-400">
                  to {subscription.endDate}
                </p>
              </td>

              <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-900">
                {formatPrice(subscription.amount)}
              </td>

              <td className="whitespace-nowrap px-6 py-4">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getSubscriptionStatusClasses(
                    subscription.status,
                  )}`}
                >
                  {subscription.status}
                </span>
              </td>

              <td className="whitespace-nowrap px-6 py-4 text-right">
               <button
  type="button"
  onClick={() =>
    setSelectedSubscription(subscription)
  }
  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
>
  View details
</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</div>


    {modalOpen ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
    <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            Choose your Tenh Chat plan
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Select the workspace capacity and billing period
            that fit your business.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(false)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
          aria-label="Close subscription dialog"
        >
          ×
        </button>
      </div>

      <div className="grid min-h-[610px] lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left side */}
        <div className="border-b border-slate-200 p-7 lg:border-b-0 lg:border-r">
          {/* Billing cycle */}
          <div>
            <p className="text-sm font-bold text-slate-900">
              Billing period
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {cycles.map((item) => {
                const active = item.id === cycle;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCycle(item.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-slate-300 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                  >
                    {item.label}

                    {item.discount > 0 ? (
                      <span
                        className={`ml-2 text-xs ${
                          active
                            ? "text-blue-100"
                            : "text-emerald-600"
                        }`}
                      >
                        -{Math.round(item.discount * 100)}%
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Plan selector */}
          <div className="mt-8 space-y-4">
            {plans.map((plan) => {
              const selected =
                selectedPlan === plan.id;

              const total = getPlanPrice(plan);
              const oldTotal = getOldPlanPrice(plan);

              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() =>
                    setSelectedPlan(plan.id)
                  }
                  className={`group w-full rounded-2xl border p-5 text-left transition ${
                    selected
                      ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                  }`}
                >
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${
                          plan.id === "mini"
                            ? "bg-emerald-100 text-emerald-700"
                            : plan.id === "standard"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-violet-100 text-violet-700"
                        }`}
                      >
                        {plan.name.charAt(0)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-slate-950">
                            {plan.name}
                          </h3>

                          {plan.id === "standard" ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              Recommended
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-1 text-sm text-slate-500">
                          {plan.description}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                          <span>
                            {plan.connections}{" "}
                            {plan.connections === 1
                              ? "connection"
                              : "connections"}
                          </span>

                          <span>{plan.users} users</span>

                          <span>{selectedCycle.label}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 sm:text-right">
                      <p className="text-2xl font-bold text-slate-950">
                        {formatPrice(total)}
                      </p>

                      {oldTotal > total ? (
                        <p className="mt-1 text-sm text-slate-400 line-through">
                          {formatPrice(oldTotal)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                    <span className="text-sm font-medium text-slate-500">
                      {selected
                        ? "Selected plan"
                        : "Select this plan"}
                    </span>

                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white text-transparent group-hover:border-blue-400"
                      }`}
                    >
                      ✓
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right summary */}
        <div className="bg-slate-50 p-7">
          <div className="sticky top-0">
            <p className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Subscription summary
            </p>

            {selectedPlan ? (
              (() => {
                const plan = plans.find(
                  (item) =>
                    item.id === selectedPlan,
                );

                if (!plan) {
                  return null;
                }

                const total = getPlanPrice(plan);
                const oldTotal =
                  getOldPlanPrice(plan);

                return (
                  <>
                    <div className="mt-5 rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm text-slate-400">
                            Selected plan
                          </p>

                          <h3 className="mt-1 text-3xl font-bold">
                            {plan.name}
                          </h3>
                        </div>

                        <div className="rounded-2xl bg-white/10 px-3 py-2 text-sm font-semibold">
                          {selectedCycle.label}
                        </div>
                      </div>

                      <div className="mt-7">
                        <p className="text-4xl font-bold">
                          {formatPrice(total)}
                        </p>

                        {oldTotal > total ? (
                          <p className="mt-2 text-sm text-slate-400 line-through">
                            {formatPrice(oldTotal)}
                          </p>
                        ) : null}
                      </div>

                      {selectedCycle.discount > 0 ? (
                        <div className="mt-5 inline-flex rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-300">
                          You save{" "}
                          {Math.round(
                            selectedCycle.discount *
                              100,
                          )}
                          %
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                      <h4 className="font-bold text-slate-950">
                        Included with this plan
                      </h4>

                      <div className="mt-4 space-y-3 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span>Social connections</span>
                          <span className="font-semibold text-slate-900">
                            {plan.connections}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Team members</span>
                          <span className="font-semibold text-slate-900">
                            {plan.users}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Billing period</span>
                          <span className="font-semibold text-slate-900">
                            {selectedCycle.label}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Customer conversations</span>
                          <span className="font-semibold text-slate-900">
                            Unlimited
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="mt-6 w-full rounded-2xl bg-blue-600 px-5 py-4 font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                    >
                      Continue with {plan.name}
                    </button>

                    <p className="mt-4 text-center text-xs leading-5 text-slate-500">
                      Payment integration will be added in
                      the next phase. No payment is charged
                      from this UI.
                    </p>
                  </>
                );
              })()
            ) : (
              <div className="mt-5 flex min-h-[420px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl text-blue-700">
                  $
                </div>

                <h3 className="mt-5 text-lg font-bold text-slate-950">
                  Select a plan
                </h3>

                <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                  Choose Mini, Standard, or Pro to see
                  the subscription summary.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
) : null}

      {selectedSubscription ? (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4">
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            Subscription details
          </h2>

          <p className="mt-1 font-mono text-sm text-slate-500">
            {selectedSubscription.id}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setSelectedSubscription(null)
          }
          className="flex h-9 w-9 items-center justify-center rounded-lg text-2xl text-slate-500 transition hover:bg-slate-100"
          aria-label="Close subscription details"
        >
          ×
        </button>
      </div>

      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">
              Current plan
            </p>

            <p className="mt-1 text-2xl font-bold text-slate-950">
              {selectedSubscription.planName}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${getSubscriptionStatusClasses(
              selectedSubscription.status,
            )}`}
          >
            {selectedSubscription.status}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DetailItem
            label="Subscription ID"
            value={selectedSubscription.id}
            mono
          />

          <DetailItem
            label="Billing cycle"
            value={selectedSubscription.billingCycle}
          />

          <DetailItem
            label="Start date"
            value={selectedSubscription.startDate}
          />

          <DetailItem
            label="End date"
            value={selectedSubscription.endDate}
          />

          <DetailItem
            label="Amount paid"
            value={formatPrice(
              selectedSubscription.amount,
            )}
          />

          <DetailItem
            label="Status"
            value={selectedSubscription.status}
            capitalize
          />
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-950">
            Plan limits
          </h3>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <PlanLimit
              label="Connected pages"
              value={
                selectedSubscription.planName === "Mini"
                  ? "1 page"
                  : selectedSubscription.planName ===
                      "Standard"
                    ? "3 pages"
                    : "6 pages"
              }
            />

            <PlanLimit
              label="Team members"
              value={
                selectedSubscription.planName === "Mini"
                  ? "3 users"
                  : selectedSubscription.planName ===
                      "Standard"
                    ? "5 users"
                    : "10 users"
              }
            />

            <PlanLimit
              label="Customer conversations"
              value="Unlimited"
            />

            <PlanLimit
              label="Support level"
              value={
                selectedSubscription.planName === "Pro"
                  ? "Priority support"
                  : "Standard support"
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-950">
            Billing information
          </h3>

          <div className="mt-4 space-y-3">
            <BillingRow
              label="Payment method"
              value="Not connected yet"
            />

            <BillingRow
              label="Auto renewal"
              value={
                selectedSubscription.status === "active"
                  ? "Enabled"
                  : "Disabled"
              }
            />

            <BillingRow
              label="Invoice"
              value={`INV-${selectedSubscription.id.replace(
                "SUB-",
                "",
              )}`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          {selectedSubscription.status ===
          "active" ? (
            <>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Change plan
              </button>

              <button
                type="button"
                className="rounded-xl border border-red-200 px-5 py-3 font-semibold text-red-600 transition hover:bg-red-50"
              >
                Cancel subscription
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() =>
              setSelectedSubscription(null)
            }
            className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
) : null}
    </div>
  );
}