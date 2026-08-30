"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useWorkspacePermissions } from "@/lib/auth/use-workspace-permissions";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_WORKSPACE_LANGUAGE_ID,
  WORKSPACE_LANGUAGE_CHANGE_EVENT,
  WORKSPACE_LANGUAGE_STORAGE_KEY,
  getStoredWorkspaceLanguageId,
  isWorkspaceLanguageId,
  type WorkspaceLanguageId,
} from "@/lib/display/workspace-language";

type SettingsLabelKey =
  | "workspace"
  | "general"
  | "display"
  | "inbox"
  | "tags"
  | "quickReplies"
  | "access"
  | "people"
  | "rolesPermissions"
  | "changeHistory"
  | "security"
  | "loginSecurity"
  | "activeSessions"
  | "helpSupport"
  | "reportProblem";

type SettingsItem = {
  labelKey: SettingsLabelKey;
  href: string;
  icon:
    | "general"
    | "display"
    | "tags"
    | "quick"
    | "people"
    | "roles"
    | "history"
    | "security"
    | "sessions"
    | "report";
};

type SettingsSection = {
  labelKey: SettingsLabelKey;
  items: SettingsItem[];
};

type WorkspaceItem = {
  memberId: string;
  businessId: string;
  businessName: string;
  role: string;
};

type WorkspacesResponse = {
  success?: boolean;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

type SidebarUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
};

const settingsTranslations: Record<
  WorkspaceLanguageId,
  Record<SettingsLabelKey, string>
> = {
  en: {
    workspace: "Workspace",
    general: "General",
    display: "Display",
    inbox: "Inbox",
    tags: "Tags",
    quickReplies: "Quick replies",
    access: "Access",
    people: "People & Channel",
    rolesPermissions: "Roles & permissions",
    changeHistory: "Change history",
    security: "Security",
    loginSecurity: "Login & security",
    activeSessions: "Active sessions",
    helpSupport: "Help & support",
    reportProblem: "Report a problem",
  },
  km: {
    workspace: "កន្លែងធ្វើការ",
    general: "ទូទៅ",
    display: "ការបង្ហាញ",
    inbox: "ប្រអប់សារ",
    tags: "ស្លាក",
    quickReplies: "ការឆ្លើយតបរហ័ស",
    access: "ការចូលប្រើ",
    people: "អ្នកប្រើប្រាស់ និងឆានែល",
    rolesPermissions: "តួនាទី និងសិទ្ធិ",
    changeHistory: "ប្រវត្តិការផ្លាស់ប្តូរ",
    security: "សុវត្ថិភាព",
    loginSecurity: "ការចូលគណនី និងសុវត្ថិភាព",
    activeSessions: "សម័យដែលកំពុងប្រើប្រាស់",
    helpSupport: "ជំនួយ និងការគាំទ្រ",
    reportProblem: "រាយការណ៍បញ្ហា",
  },
};

/**
 * Which permission each settings page needs. Pages with no entry are
 * personal settings — General, Display, Login & security, Active
 * sessions — which every member can always open because they only ever
 * affect that member's own interface or account.
 *
 * Hiding a link is a convenience, not a security boundary: the routes
 * behind these pages enforce the same permissions server-side.
 */
const ITEM_PERMISSIONS: Record<
  string,
  { key: string; level: "view" | "manage" }
> = {
  // Tags and Quick replies stay VISIBLE for everyone — a member without
  // the permission can still use them, they just cannot create, edit or
  // delete. The pages themselves show the disabled state.
  "/dashboard/settings/users": {
    key: "team_members",
    level: "view",
  },
  "/dashboard/settings/roles-permissions": {
    key: "roles_permissions",
    level: "view",
  },
};

const settingsSections: SettingsSection[] = [
  {
    labelKey: "workspace",
    items: [
      {
        labelKey: "general",
        href: "/dashboard/settings/general",
        icon: "general",
      },
      {
        labelKey: "display",
        href: "/dashboard/settings/display",
        icon: "display",
      },
    ],
  },
  {
    labelKey: "inbox",
    items: [
      {
        labelKey: "tags",
        href: "/dashboard/settings/tags",
        icon: "tags",
      },
      {
        labelKey: "quickReplies",
        href: "/dashboard/settings/saved-replies",
        icon: "quick",
      },
    ],
  },
  {
    labelKey: "access",
    items: [
      {
        labelKey: "people",
        href: "/dashboard/settings/users",
        icon: "people",
      },
      {
        labelKey: "rolesPermissions",
        href: "/dashboard/settings/roles-permissions",
        icon: "roles",
      },
      {
        labelKey: "changeHistory",
        href: "/dashboard/settings/history",
        icon: "history",
      },
    ],
  },
  {
    labelKey: "security",
    items: [
      {
        labelKey: "loginSecurity",
        href: "/dashboard/settings/security",
        icon: "security",
      },
      {
        labelKey: "activeSessions",
        href: "/dashboard/settings/sessions",
        icon: "sessions",
      },
    ],
  },
  {
    labelKey: "helpSupport",
    items: [
      {
        labelKey: "reportProblem",
        href: "/dashboard/settings/report",
        icon: "report",
      },
    ],
  },
];

function Icon({ name }: { name: SettingsItem["icon"] }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "general") {
    return (
      <svg {...common}>
        <path d="M4 7h10" />
        <path d="M18 7h2" />
        <path d="M10 17h10" />
        <path d="M4 17h2" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </svg>
    );
  }

  if (name === "display") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </svg>
    );
  }

  if (name === "tags") {
    return (
      <svg {...common}>
        <path d="M20 13 13 20l-9-9V4h7l9 9Z" />
        <circle cx="8.5" cy="8.5" r="1.2" />
      </svg>
    );
  }

  if (name === "quick") {
    return (
      <svg {...common}>
        <path d="M5 5h14v10H9l-4 4V5Z" />
        <path d="M9 9h6" />
        <path d="M9 12h4" />
      </svg>
    );
  }

  if (name === "people") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 7.5a2.5 2.5 0 0 1 0 5" />
        <path d="M17.5 15a4.5 4.5 0 0 1 3 4" />
      </svg>
    );
  }

  if (name === "roles") {
    return (
      <svg {...common}>
        <path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z" />
        <path d="m9.5 12 1.7 1.7 3.6-4" />
      </svg>
    );
  }

  if (name === "security") {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v2" />
      </svg>
    );
  }

  if (name === "sessions") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    );
  }

  if (name === "report") {
    return (
      <svg {...common}>
        <path d="M5 5h14v11H9l-4 4V5Z" />
        <path d="M12 8v4" />
        <path d="M12 14h.01" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
      <path d="M4 4v4.6h4.6" />
      <path d="M12 8v4l2.7 1.7" />
    </svg>
  );
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "T";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function SettingsSidebar() {
  const { can } = useWorkspacePermissions();
  const pathname = usePathname();
  const [languageId, setLanguageId] = useState<WorkspaceLanguageId>(
    DEFAULT_WORKSPACE_LANGUAGE_ID,
  );
  const [workspaces, setWorkspaces] = useState<WorkspacesResponse | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState<SidebarUser | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLanguageId(getStoredWorkspaceLanguageId());

    function handleLanguageChange(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const nextLanguage = customEvent.detail?.id ?? null;

      if (isWorkspaceLanguageId(nextLanguage)) {
        setLanguageId(nextLanguage);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (
        event.key === WORKSPACE_LANGUAGE_STORAGE_KEY &&
        isWorkspaceLanguageId(event.newValue)
      ) {
        setLanguageId(event.newValue);
      }
    }

    window.addEventListener(
      WORKSPACE_LANGUAGE_CHANGE_EVENT,
      handleLanguageChange,
    );
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        WORKSPACE_LANGUAGE_CHANGE_EVENT,
        handleLanguageChange,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const labels = settingsTranslations[languageId];

  const loadWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);

    try {
      const response = await fetch("/api/workspaces", {
        cache: "no-store",
      });
      const result = (await response.json()) as WorkspacesResponse;

      if (response.ok && result.success) {
        setWorkspaces(result);
      }
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();

    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      const currentUser = data.user;
      if (!currentUser) return;

      const metadata = currentUser.user_metadata ?? {};
      const fullName =
        typeof metadata.full_name === "string" && metadata.full_name.trim()
          ? metadata.full_name.trim()
          : "Tenh Chat User";
      const avatarUrl =
        typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()
          ? metadata.avatar_url
          : null;

      setUser({
        name: fullName,
        email: currentUser.email ?? "No email",
        avatarUrl,
      });
    });
  }, [loadWorkspaces]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (workspaceRef.current && !workspaceRef.current.contains(target)) {
        setWorkspaceOpen(false);
      }

      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const currentWorkspace = useMemo(
    () =>
      workspaces?.workspaces?.find(
        (item) => item.businessId === workspaces.currentBusinessId,
      ) ?? workspaces?.workspaces?.[0] ?? null,
    [workspaces],
  );

  async function switchWorkspace(businessId: string) {
    if (!businessId || switchingId || businessId === currentWorkspace?.businessId) {
      setWorkspaceOpen(false);
      return;
    }

    setSwitchingId(businessId);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ businessId }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to switch workspace.");
      }

      window.location.assign(pathname || "/dashboard/settings/general");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to switch workspace.",
      );
      setSwitchingId(null);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.replace("/login");
  }

  return (
    <aside className="flex h-full min-h-full flex-col bg-white p-2.5">
      <div ref={workspaceRef} className="relative hidden">
        <button
          type="button"
          onClick={() => setWorkspaceOpen((current) => !current)}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:bg-slate-50"
          aria-expanded={workspaceOpen}
          aria-label="Switch workspace"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-[10px] font-bold text-blue-700">
            {getInitials(currentWorkspace?.businessName ?? "TENH")}
          </span>

          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {workspaceLoading
              ? "Loading workspace..."
              : currentWorkspace?.businessName ?? "TENH Workspace"}
          </span>

          <span className="shrink-0 text-xs text-slate-400" aria-hidden="true">
            ↕
          </span>
        </button>

        {workspaceOpen ? (
          <div className="absolute left-0 right-0 top-[46px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="max-h-64 overflow-y-auto p-1.5">
              {(workspaces?.workspaces ?? []).map((workspace) => {
                const selected = workspace.businessId === currentWorkspace?.businessId;

                return (
                  <button
                    key={workspace.memberId}
                    type="button"
                    disabled={Boolean(switchingId)}
                    onClick={() => void switchWorkspace(workspace.businessId)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                      selected ? "bg-blue-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-600">
                      {getInitials(workspace.businessName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-900">
                        {workspace.businessName}
                      </span>
                      <span className="block text-[10px] capitalize text-slate-400">
                        {workspace.role}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <nav className="mt-4 space-y-4">
        {settingsSections.map((section) => {
          const visibleItems = section.items.filter((item) => {
            const requirement = ITEM_PERMISSIONS[item.href];

            return requirement
              ? can(requirement.key, requirement.level)
              : true;
          });

          // A section whose every item is hidden should not leave a
          // stray heading behind.
          if (visibleItems.length === 0) {
            return null;
          }

          return (
          <div key={section.labelKey}>
            <p className="mb-1.5 px-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {labels[section.labelKey]}
            </p>

            <div className="space-y-1">
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition ${
                      isActive
                        ? "bg-slate-100 font-semibold text-slate-950"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-500">
                      <Icon name={item.icon} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{labels[item.labelKey]}</span>
                  </Link>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>

      <div ref={profileRef} className="relative mt-auto pt-4">
        <button
          type="button"
          onClick={() => setProfileOpen((current) => !current)}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:bg-slate-50"
          aria-expanded={profileOpen}
          aria-label="Open user menu"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-[9px] font-bold text-slate-700">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              getInitials(user?.name ?? "User")
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900">
              {user?.name ?? "TENH user"}
            </span>
            <span className="block truncate text-[10px] text-slate-400">
              {user?.email ?? ""}
            </span>
          </span>

          <span className="shrink-0 text-base leading-none text-slate-400" aria-hidden="true">
            ···
          </span>
        </button>

        {profileOpen ? (
          <div className="absolute bottom-[48px] left-0 right-0 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            <Link
              href="/dashboard/profile"
              onClick={() => setProfileOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Profile information
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
