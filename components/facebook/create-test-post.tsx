"use client";

import {
  useState,
  type FormEvent,
} from "react";

export function CreateTestPost() {
  const [photo, setPhoto] =
    useState<File | null>(null);

  const [caption, setCaption] =
    useState(
      `🔥 NEW ARRIVAL

Premium Oversized Shirt

Available sizes:
• M
• L
• XL

Price: $25

💬 Comment your size below or ask us any questions.

Example:
"Do you have size M?"

📩 You can also message us for more details.`,
    );

  const [posting, setPosting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const [success, setSuccess] =
    useState<string | null>(
      null,
    );

  async function handleSubmit(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!photo) {
      setError(
        "Please select a photo.",
      );

      return;
    }

    setPosting(true);
    setError(null);
    setSuccess(null);

    try {
      const formData =
        new FormData();

      formData.append(
        "photo",
        photo,
      );

      formData.append(
        "caption",
        caption,
      );

      const response =
        await fetch(
          "/api/facebook/posts/create",
          {
            method: "POST",
            body: formData,
          },
        );

      const text =
        await response.text();

      let result: {
        success?: boolean;
        error?: string;
        postId?: string;
      } = {};

      if (text.trim()) {
        result =
          JSON.parse(text);
      }

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to create post.",
        );
      }

      setSuccess(
        `Facebook post created successfully${
          result.postId
            ? ` (${result.postId})`
            : ""
        }.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to create post.",
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Create Facebook Test Post
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          Create a Page post for testing Facebook comments.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Product photo
        </label>

        <input
          type="file"
          accept="image/*"
          onChange={(event) =>
            setPhoto(
              event.target.files?.[0] ??
                null,
            )
          }
          className="block w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Caption
        </label>

        <textarea
          value={caption}
          onChange={(event) =>
            setCaption(
              event.target.value,
            )
          }
          rows={12}
          className="w-full resize-y rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="text-sm text-emerald-600">
          {success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={posting}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:bg-slate-300"
      >
        {posting
          ? "Publishing..."
          : "Publish Test Post"}
      </button>
    </form>
  );
}