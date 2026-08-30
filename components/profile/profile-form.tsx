"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Building2,
  Camera,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ProfileFormProps = {
  initialFullName: string;
  initialPhone: string;
  email: string;
  initialAvatarUrl: string | null;
};

type WorkspaceItem = {
  businessId: string;
  businessName: string;
  role?: string | null;
};

type WorkspacesResponse = {
  success?: boolean;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

function getInitial(name: string, email: string) {
  return (
    name.trim().charAt(0).toUpperCase() ||
    email.trim().charAt(0).toUpperCase() ||
    "U"
  );
}

function formatRole(role?: string | null) {
  if (!role) {
    return "Member";
  }

  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

export function ProfileForm({
  initialFullName,
  initialPhone,
  email,
  initialAvatarUrl,
}: ProfileFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loadedWorkspaceNameRef = useRef("TENH Workspace");

  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [workspaceName, setWorkspaceName] = useState("TENH Workspace");
  const [workspaceRole, setWorkspaceRole] = useState("Member");
  const [canEditWorkspace, setCanEditWorkspace] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceName() {
      try {
        const response = await fetch("/api/workspaces", {
          cache: "no-store",
        });

        const result = (await response.json()) as WorkspacesResponse;

        if (!response.ok || !result.success || cancelled) {
          return;
        }

        const currentWorkspace =
          result.workspaces?.find(
            (workspace) => workspace.businessId === result.currentBusinessId,
          ) ?? result.workspaces?.[0];

        const nextWorkspaceName = currentWorkspace?.businessName?.trim();

        if (nextWorkspaceName) {
          setWorkspaceName(nextWorkspaceName);
          loadedWorkspaceNameRef.current = nextWorkspaceName;
        }

        setWorkspaceRole(formatRole(currentWorkspace?.role));
        setCanEditWorkspace(
          currentWorkspace?.role === "owner" || currentWorkspace?.role === "admin",
        );
      } catch {
        // Keep the safe fallback values when workspace details cannot be loaded.
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
        }
      }
    }

    void loadWorkspaceName();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Profile image must be smaller than 5 MB.");
      event.target.value = "";
      return;
    }

    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }

    setError(null);
    setSuccess(null);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    router.refresh();
  }

  function handleRemovePhoto() {
    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }

    if (inputRef.current) {
      inputRef.current.value = "";
    }

    setAvatarFile(null);
    setAvatarPreview(null);
    setError(null);
    setSuccess(null);
  }

  function handleCancel() {
    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }

    if (inputRef.current) {
      inputRef.current.value = "";
    }

    setFullName(initialFullName);
    setPhone(initialPhone);
    setWorkspaceName(loadedWorkspaceNameRef.current);
    setAvatarFile(null);
    setAvatarPreview(initialAvatarUrl);
    setError(null);
    setSuccess(null);
  }

  async function uploadAvatar(userId: string): Promise<string | null> {
    if (!avatarFile) {
      return avatarPreview;
    }

    const supabase = createClient();
    const extension = avatarFile.name.split(".").pop()?.toLowerCase() ?? "png";
    const filePath = `${userId}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, avatarFile, {
        upsert: true,
        contentType: avatarFile.type,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);

    return data.publicUrl;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const uploadedAvatarUrl = await uploadAvatar(user.id);
      const { error: updateError } = await supabase.auth.updateUser({
        phone: phone.trim() || undefined,
        data: {
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          avatar_url: uploadedAvatarUrl,
        },
      });

      if (updateError) {
        throw updateError;
      }

      if (canEditWorkspace) {
        const nextWorkspaceName = workspaceName.trim();

        if (!nextWorkspaceName) {
          throw new Error("Workspace name is required.");
        }

        if (nextWorkspaceName !== loadedWorkspaceNameRef.current) {
          const workspaceResponse = await fetch("/api/workspaces", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ businessName: nextWorkspaceName }),
          });
          const workspaceResult = (await workspaceResponse.json()) as {
            success?: boolean;
            error?: string;
            businessName?: string;
          };

          if (!workspaceResponse.ok || !workspaceResult.success) {
            throw new Error(
              workspaceResult.error ?? "Unable to save workspace name.",
            );
          }

          const savedWorkspaceName =
            workspaceResult.businessName?.trim() || nextWorkspaceName;
          setWorkspaceName(savedWorkspaceName);
          loadedWorkspaceNameRef.current = savedWorkspaceName;
          window.dispatchEvent(new Event("tenh:workspace-data-changed"));
        }
      }

      setAvatarPreview(uploadedAvatarUrl);
      setAvatarFile(null);
      setSuccess("Profile saved successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7 lg:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-center">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative shrink-0 self-start sm:self-auto">
              <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-4xl font-bold text-blue-700 ring-1 ring-slate-200 sm:h-40 sm:w-40">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  getInitial(fullName, email)
                )}
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={saving}
                aria-label="Change profile photo"
                className="absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Camera className="h-5 w-5" />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-950">Profile photo</h2>
              <p className="mt-2 text-sm text-slate-500">
                JPG, PNG or WEBP. Max size 5MB.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <Upload className="h-5 w-5" />
                  Change photo
                </button>

                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={saving || !avatarPreview}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageChange}
                className="hidden"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-slate-50 p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <UserRound className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500">Account</p>
                  <p className="mt-0.5 font-semibold text-slate-800">
                    {workspaceLoading ? "Loading..." : workspaceRole}
                  </p>
                </div>
              </div>

              <div className="my-4 border-t border-slate-200" />

              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500">Workspace</p>
                  <p className="mt-0.5 truncate font-semibold text-slate-800">
                    {workspaceLoading ? "Loading workspace..." : workspaceName}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7 lg:p-8">
        <h2 className="text-xl font-bold text-slate-950">Personal details</h2>

        <div className="mt-7 space-y-5">
          <div className="grid gap-3 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-end">
            <div className="hidden h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-blue-700 sm:flex">
              <UserRound className="h-6 w-6" />
            </div>

            <div>
              <label
                htmlFor="profile-name"
                className="text-sm font-bold text-slate-700"
              >
                Full name
              </label>
              <input
                id="profile-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={saving}
                placeholder="Your full name"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-end">
            <div className="hidden h-14 w-14 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 sm:flex">
              <Building2 className="h-6 w-6" />
            </div>

            <div>
              <label
                htmlFor="profile-workspace"
                className="text-sm font-bold text-slate-700"
              >
                Workspace name
              </label>
              <input
                id="profile-workspace"
                value={workspaceLoading ? "Loading workspace..." : workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                disabled={saving || workspaceLoading || !canEditWorkspace}
                readOnly={!canEditWorkspace}
                aria-readonly={!canEditWorkspace}
                maxLength={120}
                className={`mt-2 w-full rounded-xl border px-4 py-3.5 outline-none transition ${
                  canEditWorkspace
                    ? "border-slate-300 bg-white text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-70`}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                {canEditWorkspace
                  ? "Changing this name updates the selected workspace across TENH."
                  : "Only an Owner can rename this workspace."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-end">
            <div className="hidden h-14 w-14 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex">
              <Phone className="h-6 w-6" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="profile-phone"
                  className="text-sm font-bold text-slate-700"
                >
                  Phone number
                </label>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                  Optional
                </span>
              </div>
              <input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={saving}
                placeholder="+855..."
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-end">
            <div className="hidden h-14 w-14 items-center justify-center rounded-xl bg-violet-50 text-violet-700 sm:flex">
              <Mail className="h-6 w-6" />
            </div>

            <div>
              <label className="text-sm font-bold text-slate-700">
                Email address
              </label>
              <input
                value={email}
                disabled
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3.5 text-slate-500"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Email comes from your login account.
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col gap-4 border-t border-slate-200 pt-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={
                saving ||
                !fullName.trim() ||
                (canEditWorkspace && !workspaceName.trim())
              }
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
            >
              <Save className="h-5 w-5" />
              {saving ? "Saving..." : "Save changes"}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          <div className="flex max-w-sm items-start gap-3 text-sm text-slate-500">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
            <div>
              <p className="font-semibold text-slate-700">Your information is secure</p>
              <p className="mt-0.5 text-xs">
                Your profile details stay inside your TENH account.
              </p>
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}
