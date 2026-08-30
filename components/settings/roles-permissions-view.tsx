"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type PermissionLevel = "none" | "view" | "manage";
type PermissionValue = PermissionLevel | boolean;

type PermissionDefinition = {
  key: string;
  kind: "level" | "toggle";
  label: string;
  description: string;
  locked?: boolean;
  levels?: PermissionLevel[];
  viewNotice?: string;
  ownerDefault: PermissionValue;
  teamDefault: PermissionValue;
};

type PermissionGroup = {
  key: string;
  title: string;
  description: string;
  icon:
    | "chat"
    | "users"
    | "tag"
    | "member"
    | "integration"
    | "billing"
    | "settings";
  permissions: PermissionDefinition[];
};

type MemberPermissions = Record<string, PermissionValue>;

type PermissionMember = {
  id: string;
  role: string;
  isActive: boolean;
  isOwner: boolean;
  fullName: string | null;
  email: string | null;
  profilePictureUrl: string | null;
  hasOverrides: boolean;
  permissions: MemberPermissions;
};

type PermissionsResponse = {
  success?: boolean;
  canManage?: boolean;
  isOwner?: boolean;
  currentMemberId?: string;
  groups?: PermissionGroup[];
  members?: PermissionMember[];
  error?: string;
};

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name:
    | "crown"
    | "person"
    | "chat"
    | "users"
    | "tag"
    | "member"
    | "integration"
    | "billing"
    | "settings"
    | "lock"
    | "reset";
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (name === "crown") {
    return (
      <svg {...common}>
        <path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z" />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 8.5a3 3 0 0 1 0 5.5" />
        <path d="M17.5 19a5 5 0 0 0-2-4" />
      </svg>
    );
  }

  if (name === "tag") {
    return (
      <svg {...common}>
        <path d="M4 4h7l9 9-7 7-9-9V4Z" />
        <circle cx="8" cy="8" r="1.4" />
      </svg>
    );
  }

  if (name === "integration") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
        <path d="M7.5 11v3a2 2 0 0 0 2 2H13" />
      </svg>
    );
  }

  if (name === "billing") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z" />
      </svg>
    );
  }

  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }

  if (name === "reset") {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 1 0-.7 4" />
        <path d="M20 4v7h-7" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

const LEVEL_ORDER: PermissionLevel[] = ["none", "view", "manage"];

function levelChipClass(value: PermissionValue) {
  if (value === true || value === "manage") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (value === "view") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-red-200 bg-red-50 text-red-600";
}

export function RolesPermissionsView() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = useCallback(
    (en: string, km: string) => (isKhmer ? km : en),
    [isKhmer],
  );

  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<PermissionMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [draft, setDraft] = useState<MemberPermissions>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/team/permissions", {
        cache: "no-store",
      });

      const result = (await response.json()) as PermissionsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load roles and permissions.",
        );
      }

      setGroups(result.groups ?? []);
      setMembers(result.members ?? []);
      setCanManage(result.canManage === true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load roles and permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const definitions = useMemo(
    () => groups.flatMap((group) => group.permissions),
    [groups],
  );

  const owners = useMemo(
    () => members.filter((member) => member.isOwner && member.isActive),
    [members],
  );

  const teamMembers = useMemo(
    () => members.filter((member) => !member.isOwner && member.isActive),
    [members],
  );

  const selectedMember = useMemo(
    () => teamMembers.find((member) => member.id === selectedMemberId) ?? null,
    [selectedMemberId, teamMembers],
  );

  const dirty = useMemo(() => {
    if (!selectedMember) {
      return false;
    }

    return definitions.some(
      (definition) =>
        !definition.locked &&
        draft[definition.key] !== selectedMember.permissions[definition.key],
    );
  }, [definitions, draft, selectedMember]);

  function selectMember(member: PermissionMember) {
    setSelectedMemberId(member.id);
    setDraft({ ...member.permissions });
    setMessage(null);
    setError(null);
  }

  async function save(reset = false) {
    if (!selectedMember) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/team/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: selectedMember.id,
          permissions: draft,
          reset,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        permissions?: MemberPermissions;
        hasOverrides?: boolean;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to save those permissions.",
        );
      }

      const nextPermissions = result.permissions ?? draft;

      setMembers((current) =>
        current.map((member) =>
          member.id === selectedMember.id
            ? {
                ...member,
                permissions: nextPermissions,
                hasOverrides: result.hasOverrides === true,
              }
            : member,
        ),
      );

      setDraft({ ...nextPermissions });

      setMessage(
        reset
          ? t(
              "Permissions reset to the Team member defaults.",
              "បានកំណត់សិទ្ធិឡើងវិញទៅតម្លៃលំនាំដើមរបស់សមាជិកក្រុម។",
            )
          : t(
              "Permissions saved. They apply the next time this member loads a page.",
              "បានរក្សាទុកសិទ្ធិ។ វានឹងមានប្រសិទ្ធភាពនៅពេលសមាជិកនេះបើកទំព័របន្ទាប់។",
            ),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save those permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  const memberLabel = (member: PermissionMember) =>
    member.fullName ?? member.email ?? t("Team member", "សមាជិកក្រុម");

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <header>
        <h1 className="text-[30px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[34px]">
          {t("Roles & permissions", "តួនាទី និងសិទ្ធិ")}
        </h1>
        <p className="mt-1.5 text-base leading-6 text-slate-500">
          {t(
            "Select a Team member to set what they can do in this workspace.",
            "ជ្រើសរើសសមាជិកក្រុមម្នាក់ ដើម្បីកំណត់នូវអ្វីដែលពួកគេអាចធ្វើបាននៅក្នុងកន្លែងធ្វើការនេះ។",
          )}
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
          {message}
        </div>
      ) : null}

      {!loading && !canManage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {t(
            "View only. Only an Owner or a member with Manage permission can change roles and permissions.",
            "មើលបានតែប៉ុណ្ណោះ។ មានតែម្ចាស់ ឬសមាជិកដែលមានសិទ្ធិគ្រប់គ្រងប៉ុណ្ណោះដែលអាចផ្លាស់ប្តូរតួនាទី និងសិទ្ធិបាន។",
          )}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-[20px] border border-violet-400 bg-white p-5 shadow-[0_7px_24px_rgba(15,23,42,0.045)] ring-1 ring-violet-100">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-600 text-white">
              <Icon name="crown" />
            </div>
            <h2 className="flex-1 text-lg font-bold text-slate-950">
              {t("Owner", "ម្ចាស់")}
            </h2>
            <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
              {owners.length} {t("users", "អ្នកប្រើ")}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {t(
              "Full access to everything, always. An Owner cannot be restricted — including by another Owner.",
              "មានសិទ្ធិពេញលេញលើគ្រប់យ៉ាងជានិច្ច។ ម្ចាស់មិនអាចត្រូវបានកំណត់ព្រំដែនទេ រួមទាំងដោយម្ចាស់ផ្សេងទៀតផង។",
            )}
          </p>
        </article>

        <article className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_7px_24px_rgba(15,23,42,0.045)]">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <Icon name="person" />
            </div>
            <h2 className="flex-1 text-lg font-bold text-slate-950">
              {t("Team member", "សមាជិកក្រុម")}
            </h2>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {teamMembers.length} {t("users", "អ្នកប្រើ")}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {t(
              "Starts from the Team member defaults. Set per-person limits below. If they later buy their own subscription, they become Owner of their own workspace with full access there.",
              "ចាប់ផ្តើមពីតម្លៃលំនាំដើមរបស់សមាជិកក្រុម។ កំណត់ព្រំដែនតាមបុគ្គលនៅខាងក្រោម។ ប្រសិនបើពួកគេទិញការជាវផ្ទាល់ខ្លួននៅពេលក្រោយ ពួកគេនឹងក្លាយជាម្ចាស់នៃកន្លែងធ្វើការរបស់ខ្លួន ដោយមានសិទ្ធិពេញលេញនៅទីនោះ។",
            )}
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
          <h2 className="px-1 text-sm font-bold uppercase tracking-[0.14em] text-slate-500">
            {t("Team members", "សមាជិកក្រុម")}
          </h2>

          {loading ? (
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-[62px] animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
          ) : teamMembers.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              {t(
                "No Team members yet. Invite someone first.",
                "មិនទាន់មានសមាជិកក្រុមទេ។ សូមអញ្ជើញនរណាម្នាក់ជាមុនសិន។",
              )}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {teamMembers.map((member) => {
                const active = member.id === selectedMemberId;

                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => selectMember(member)}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-violet-400 bg-violet-50/60 ring-1 ring-violet-100"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                        {member.profilePictureUrl ? (
                          <img
                            src={member.profilePictureUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          memberLabel(member).charAt(0).toUpperCase()
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-950">
                          {memberLabel(member)}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {member.hasOverrides
                            ? t("Custom permissions", "សិទ្ធិកំណត់ដោយខ្លួនឯង")
                            : t("Default permissions", "សិទ្ធិលំនាំដើម")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="rounded-[20px] border border-slate-200 bg-white shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
          {!selectedMember ? (
            <div className="px-6 py-16 text-center">
              <p className="text-base font-semibold text-slate-700">
                {t("Select a Team member", "ជ្រើសរើសសមាជិកក្រុមម្នាក់")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t(
                  "Their permissions will appear here.",
                  "សិទ្ធិរបស់ពួកគេនឹងបង្ហាញនៅទីនេះ។",
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">
                    {memberLabel(selectedMember)}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {selectedMember.email}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canManage || saving}
                    onClick={() => void save(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon name="reset" className="h-4 w-4" />
                    {t("Reset to default", "កំណត់ឡើងវិញ")}
                  </button>

                  <button
                    type="button"
                    disabled={!canManage || saving || !dirty}
                    onClick={() => void save(false)}
                    className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving
                      ? t("Saving...", "កំពុងរក្សាទុក...")
                      : t("Save permissions", "រក្សាទុកសិទ្ធិ")}
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {groups.map((group) => (
                  <section key={group.key} className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
                        <Icon name={group.icon} className="h-4.5 w-4.5" />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-slate-950">
                          {group.title}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {group.description}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {group.permissions.map((definition) => {
                        const value = draft[definition.key];

                        return (
                          <div
                            key={definition.key}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                {definition.label}
                                {definition.locked ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                    <Icon name="lock" className="h-3 w-3" />
                                    {t("Always on", "បើកជានិច្ច")}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                                {definition.description}
                              </p>

                            </div>

                            {definition.locked ? (
                              <span
                                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${levelChipClass(
                                  true,
                                )}`}
                              >
                                {t("Full access", "សិទ្ធិពេញលេញ")}
                              </span>
                            ) : definition.kind === "level" ? (
                              <div className="flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                {(definition.levels ?? LEVEL_ORDER).map((level) => (
                                  <button
                                    key={level}
                                    type="button"
                                    disabled={!canManage}
                                    onClick={() =>
                                      setDraft((current) => ({
                                        ...current,
                                        [definition.key]: level,
                                      }))
                                    }
                                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${
                                      value === level
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-500 hover:text-slate-700"
                                    }`}
                                  >
                                    {level === "none"
                                      ? t("No access", "គ្មានសិទ្ធិ")
                                      : level === "view"
                                        ? t("View", "មើល")
                                        : t("Manage", "គ្រប់គ្រង")}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    [definition.key]: value !== true,
                                  }))
                                }
                                className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  value === true
                                    ? "bg-emerald-500"
                                    : "bg-slate-300"
                                }`}
                                aria-pressed={value === true}
                                aria-label={definition.label}
                              >
                                <span
                                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                                    value === true ? "left-6" : "left-1"
                                  }`}
                                />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
