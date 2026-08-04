"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";


import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ProfileFormProps = {
  initialFullName: string;
  initialPhone: string;
  email: string;
  initialAvatarUrl: string | null;
};

function getInitial(name: string, email: string) {
  return (
    name.trim().charAt(0).toUpperCase() ||
    email.trim().charAt(0).toUpperCase() ||
    "U"
  );
}

export function ProfileForm({
  initialFullName,
  initialPhone,
  email,
  initialAvatarUrl,
}: ProfileFormProps) {

  const router = useRouter();
  const inputRef =
    useRef<HTMLInputElement | null>(null);

  const [fullName, setFullName] =
    useState(initialFullName);

  const [phone, setPhone] =
    useState(initialPhone);

  const [avatarFile, setAvatarFile] =
    useState<File | null>(null);

  const [avatarPreview, setAvatarPreview] =
    useState<string | null>(initialAvatarUrl);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  function handleImageChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0] ?? null;

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

    if (
      avatarPreview &&
      avatarPreview.startsWith("blob:")
    ) {
      URL.revokeObjectURL(avatarPreview);
    }

    setError(null);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    router.refresh();
  }

  async function uploadAvatar(
    userId: string,
  ): Promise<string | null> {
    if (!avatarFile) {
      return avatarPreview;
    }

    const supabase = createClient();

    const extension =
      avatarFile.name.split(".").pop()?.toLowerCase() ??
      "png";

    const filePath =
      `${userId}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } =
      await supabase.storage
        .from("avatars")
        .upload(filePath, avatarFile, {
          upsert: true,
          contentType: avatarFile.type,
        });
  
    if (uploadError) {
      throw uploadError;
    }

    const { data } =
      supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

    return data.publicUrl;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase =
        createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(
          "Your session has expired. Please sign in again.",
        );
      }

      const uploadedAvatarUrl =
        await uploadAvatar(user.id);

      const {
        error: updateError,
      } = await supabase.auth.updateUser({
        phone:
          phone.trim() || undefined,

        data: {
          full_name:
            fullName.trim(),

          phone:
            phone.trim() || null,

          avatar_url:
            uploadedAvatarUrl,
        },
      });

      if (updateError) {
        throw updateError;
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
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      <div>
        <p className="text-sm font-bold text-slate-900">
          Profile photo
        </p>

        <div className="mt-3 flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-2xl font-semibold text-blue-700">
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
            onClick={() =>
              inputRef.current?.click()
            }
            disabled={saving}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Change photo
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleImageChange}
            className="hidden"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="profile-name"
          className="text-sm font-bold text-slate-900"
        >
          Full name
        </label>

        <input
          id="profile-name"
          value={fullName}
          onChange={(event) =>
            setFullName(event.target.value)
          }
          disabled={saving}
          placeholder="Your full name"
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
        />
      </div>

      <div>
        <label
          htmlFor="profile-phone"
          className="text-sm font-bold text-slate-900"
        >
          Phone number
        </label>

        <input
          id="profile-phone"
          type="tel"
          value={phone}
          onChange={(event) =>
            setPhone(event.target.value)
          }
          disabled={saving}
          placeholder="+855..."
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
        />
      </div>

      <div>
        <label className="text-sm font-bold text-slate-900">
          Email address
        </label>

        <input
          value={email}
          disabled
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-500"
        />

        <p className="mt-1 text-xs text-slate-500">
          Email comes from your login account.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={
          saving || !fullName.trim()
        }
        className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
      >
        {saving
          ? "Saving..."
          : "Save profile"}
      </button>
    </form>
  );
}