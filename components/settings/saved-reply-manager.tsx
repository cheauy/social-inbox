"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  CheckCircle2,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Folder,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import {
  WorkspaceLanguageText,
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";
import { useWorkspacePermissions } from "@/lib/auth/use-workspace-permissions";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

import { useRouter } from "next/navigation";

import { AttachmentThumbnails } from "@/components/settings/saved-reply-attachment-thumbnails";
import { SavedReplyCategoryManager } from "@/components/settings/saved-reply-category-manager";
import {
  SavedReplyFormModal,
  type SavedReplyFormValue,
} from "@/components/settings/saved-reply-form-modal";

import type {
  SavedReplyCategory,
  SavedReplyAttachment, SavedReply } from "@/types/inbox";

type SavedReplyManagerProps = {
  businessId: string;
  initialSavedReplies: SavedReply[];
  initialCategories: SavedReplyCategory[];
};

type SavedReplyResponse = {
  success?: boolean;
  error?: string;
  savedReply?: SavedReply;
};

/*
 * Which category a new quick reply starts in.
 *
 * General, when the workspace has it -- it is the default every workspace is
 * seeded with, and the one most replies belong in. A workspace that renamed or
 * removed it falls back to whichever category it put first, since that is the
 * one it chose to lead with. Only a workspace with no categories at all starts
 * uncategorised.
 */
function defaultCategoryName(
  categories: SavedReplyCategory[],
) {
  const general = categories.find(
    (category) =>
      category.name.trim().toLowerCase() ===
      "general",
  );

  return (
    general?.name ??
    categories[0]?.name ??
    ""
  );
}

function emptyForm(
  nextIndex: number,
  categories: SavedReplyCategory[] = [],
): SavedReplyFormValue {
  return {
    title: "",
    shortcut: "",
    category:
      defaultCategoryName(categories),
    messageText: "",
    sortIndex: nextIndex,
    isActive: true,

    existingAttachments: [],
    newAttachments: [],
    removedAttachmentPaths: [],
  };
}

function formFromReply(
  reply: SavedReply,
): SavedReplyFormValue {
  return {
    title: reply.title,
    shortcut: reply.shortcut ?? "",
    category: reply.category ?? "",
    messageText: reply.message_text,
    sortIndex: reply.sort_index,
    isActive: reply.is_active,

    existingAttachments:
      reply.attachments ?? [],

    newAttachments: [],

    removedAttachmentPaths: [],
  };
}

export function SavedReplyManager({
  businessId,
  initialSavedReplies,
  initialCategories,
}: SavedReplyManagerProps) {
  const router = useRouter();

  // Usage is always allowed; this only gates create / edit / delete.
  const { can } = useWorkspacePermissions();
  const canManageContent = can("tags_quick_replies");
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";

  const [
    managedCategories,
    setManagedCategories,
  ] = useState<SavedReplyCategory[]>(
    initialCategories,
  );

  const [savedReplies, setSavedReplies] =
    useState<SavedReply[]>(
      initialSavedReplies,
    );

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState<"all" | "active" | "inactive">("all");

  const [categoryFilter, setCategoryFilter] =
    useState<string>("all");

  const [sortMode, setSortMode] =
    useState<"order" | "name" | "status">("order");

  const [modalMode, setModalMode] =
    useState<"create" | "edit" | null>(
      null,
    );

  const [selectedReply, setSelectedReply] =
    useState<SavedReply | null>(null);

  const [form, setForm] =
    useState<SavedReplyFormValue>(
      emptyForm(
        initialSavedReplies.length + 1,
        initialCategories,
      ),
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<SavedReply | null>(null);

  const [deletingReplyId, setDeletingReplyId] =
    useState<string | null>(null);

  /* Quick replies with a pause/resume request still in flight. */
  const [togglingReplyIds, setTogglingReplyIds] =
    useState<Set<string>>(new Set());

  /*
   * The filter follows the order the Owner dragged, not the alphabet: the point
   * of arranging categories is that the arrangement is the one people see.
   * Categories with nothing filed under them are still offered, so a new one is
   * visible before its first reply exists.
   */
  const categories = useMemo(() => {
    const inUse = new Set(
      savedReplies
        .map((reply) =>
          reply.category?.trim().toLowerCase(),
        )
        .filter(
          (category): category is string =>
            Boolean(category),
        ),
    );

    const ordered = managedCategories.map(
      (category) => category.name,
    );
    const known = new Set(
      ordered.map((name) =>
        name.toLowerCase(),
      ),
    );

    const orphans = Array.from(inUse)
      .filter((name) => !known.has(name))
      .map((lower) => {
        const match = savedReplies.find(
          (reply) =>
            reply.category?.trim().toLowerCase() ===
            lower,
        );

        return (
          match?.category?.trim() ?? lower
        );
      })
      .sort((first, second) =>
        first.localeCompare(second),
      );

    return [...ordered, ...orphans];
  }, [managedCategories, savedReplies]);

  /*
   * The managed categories, in the order they were dragged into, plus any name
   * still carried by a reply but no longer a category of its own. Those come
   * from before categories were managed, or from a rename that half-finished;
   * offering them keeps the filter honest about what is actually filed.
   */
  const existingCategories = useMemo(() => {
    const ordered = managedCategories.map(
      (category) => category.name,
    );
    const known = new Set(
      ordered.map((name) =>
        name.toLowerCase(),
      ),
    );
    const orphans: string[] = [];

    for (const reply of savedReplies) {
      const name = reply.category?.trim();

      if (!name) {
        continue;
      }

      const key = name.toLowerCase();

      if (!known.has(key)) {
        known.add(key);
        orphans.push(name);
      }
    }

    return [
      ...ordered,
      ...orphans.sort((first, second) =>
        first.localeCompare(second),
      ),
    ];
  }, [managedCategories, savedReplies]);

  /*
   * How many rows are drawn at once.
   *
   * Each row with media asks for a signed URL per thumbnail, so a workspace
   * with hundreds of replies would open this page and fire hundreds of
   * requests before showing anything. Drawing a page at a time keeps that
   * bounded, and the search and filters above still work across every reply --
   * they narrow the list before this does.
   */
  const REPLY_PAGE_SIZE = 25;

  const [visibleCount, setVisibleCount] =
    useState(REPLY_PAGE_SIZE);

  const totalCount = savedReplies.length;

  const activeCount = savedReplies.filter(
    (reply) => reply.is_active,
  ).length;

  const inactiveCount =
    totalCount - activeCount;

  const filteredReplies = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    return savedReplies.filter((reply) => {
      const matchesSearch =
        !query ||
        [
          reply.title,
          reply.shortcut ?? "",
          reply.category ?? "",
          reply.message_text,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" &&
          reply.is_active) ||
        (statusFilter === "inactive" &&
          !reply.is_active);

      const matchesCategory =
        categoryFilter === "all" ||
        (reply.category ?? "Uncategorized") ===
          categoryFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesCategory
      );
    });
  }, [
    savedReplies,
    search,
    statusFilter,
    categoryFilter,
  ]);

  const sortedReplies = useMemo(() => {
    const replies = [...filteredReplies];

    replies.sort((first, second) => {
      if (sortMode === "name") {
        return first.title.localeCompare(
          second.title,
        );
      }

      if (sortMode === "status") {
        if (
          first.is_active !==
          second.is_active
        ) {
          return first.is_active ? -1 : 1;
        }

        return (
          first.sort_index -
          second.sort_index
        );
      }

      if (
        first.is_active !==
        second.is_active
      ) {
        return first.is_active ? -1 : 1;
      }

      return (
        first.sort_index -
          second.sort_index ||
        first.title.localeCompare(
          second.title,
        )
      );
    });

    return replies;
  }, [filteredReplies, sortMode]);

  /*
   * Reset to the first page whenever the list underneath changes. Searching
   * and landing on page three of the old results would look like the search
   * had failed.
   */
  const visibleReplies = sortedReplies.slice(
    0,
    visibleCount,
  );

  const hiddenReplyCount =
    sortedReplies.length -
    visibleReplies.length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(REPLY_PAGE_SIZE);
  }, [search, categoryFilter, statusFilter]);


  function openCreate() {
    const nextIndex =
      savedReplies.reduce(
        (largest, reply) =>
          Math.max(
            largest,
            reply.sort_index,
          ),
        0,
      ) + 1;

    setSelectedReply(null);
    setForm(
      emptyForm(
        nextIndex,
        managedCategories,
      ),
    );
    setError(null);
    setModalMode("create");
  }

  function openEdit(
    reply: SavedReply,
  ) {
    setSelectedReply(reply);
    setForm(formFromReply(reply));
    setError(null);
    setModalMode("edit");
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalMode(null);
    setSelectedReply(null);
    setError(null);
  }

  /*
   * Upload the newly picked files, then save the reply with the full list.
   *
   * Uploads come first because the reply stores paths: saving a reply that
   * pointed at a file the upload had not produced would leave a quick reply
   * that sends nothing. If an upload fails, nothing is saved and the files
   * already uploaded are simply orphaned in the bucket -- a stray object costs
   * nothing, a broken quick reply costs a customer reply.
   */
  async function uploadNewAttachments() {
    const uploaded: SavedReplyAttachment[] =
      [];

    for (const pending of form.newAttachments) {
      const body = new FormData();
      body.set("file", pending.file);

      const response = await fetch(
        "/api/saved-replies/media",
        { method: "POST", body },
      );

      const result = (await response
        .json()
        .catch(() => null)) as {
        success?: boolean;
        error?: string;
        attachment?: SavedReplyAttachment;
      } | null;

      if (
        !response.ok ||
        !result?.success ||
        !result.attachment
      ) {
        throw new Error(
          result?.error ??
            `Unable to upload ${pending.file.name}.`,
        );
      }

      uploaded.push(result.attachment);
    }

    return uploaded;
  }

  /*
   * Best effort, and deliberately after the save. A file removed from a reply
   * that then failed to save should still be there.
   */
  async function deleteRemovedAttachments() {
    for (const path of form.removedAttachmentPaths) {
      await fetch(
        `/api/saved-replies/media?path=${encodeURIComponent(
          path,
        )}`,
        { method: "DELETE" },
      ).catch(() => null);
    }
  }

  async function submitForm() {
    setSaving(true);
    setError(null);

    try {
      const isEditing =
        modalMode === "edit" &&
        selectedReply !== null;

      const uploaded =
        await uploadNewAttachments();

      const attachments = [
        ...form.existingAttachments,
        ...uploaded,
      ];

      const response = await fetch(
        isEditing
          ? `/api/saved-replies/${selectedReply.id}`
          : "/api/saved-replies",
        {
          method: isEditing
            ? "PATCH"
            : "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            ...(isEditing
              ? {}
              : {
                  businessId,
                }),

            title: form.title,

            shortcut:
              form.shortcut,

            category:
              form.category,

            messageText:
              form.messageText,

            sortIndex:
              form.sortIndex,

            isActive:
              form.isActive,

            attachments,
          }),
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.savedReply
      ) {
        throw new Error(
          result.error ??
            "Unable to save quick reply.",
        );
      }

      if (isEditing) {
        setSavedReplies((current) =>
          current.map((reply) =>
            reply.id ===
            result.savedReply?.id
              ? (result.savedReply as SavedReply)
              : reply,
          ),
        );
      } else {
        setSavedReplies((current) => [
          ...current,
          result.savedReply as SavedReply,
        ]);
      }

      await deleteRemovedAttachments();

      setModalMode(null);
      setSelectedReply(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save quick reply.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(
    reply: SavedReply,
  ) {
    if (togglingReplyIds.has(reply.id)) {
      return;
    }

    const nextIsActive = !reply.is_active;

    /*
     * Flip the row immediately instead of waiting for the network round trip,
     * then reconcile with the server response. Reverts on failure.
     */
    setSavedReplies((current) =>
      current.map((item) =>
        item.id === reply.id
          ? { ...item, is_active: nextIsActive }
          : item,
      ),
    );

    setTogglingReplyIds((current) => {
      const next = new Set(current);
      next.add(reply.id);
      return next;
    });

    try {
      const response = await fetch(
        `/api/saved-replies/${reply.id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            isActive: nextIsActive,
          }),
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.savedReply
      ) {
        throw new Error(
          result.error ??
            "Unable to update quick reply.",
        );
      }

      setSavedReplies((current) =>
        current.map((item) =>
          item.id === reply.id
            ? (result.savedReply as SavedReply)
            : item,
        ),
      );
    } catch (toggleError) {
      // Roll the optimistic change back.
      setSavedReplies((current) =>
        current.map((item) =>
          item.id === reply.id
            ? { ...item, is_active: reply.is_active }
            : item,
        ),
      );

      window.alert(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update quick reply.",
      );
    } finally {
      setTogglingReplyIds((current) => {
        const next = new Set(current);
        next.delete(reply.id);
        return next;
      });
    }
  }

  async function deleteReply(
    reply: SavedReply,
  ) {
    setDeletingReplyId(reply.id);

    try {
      const response = await fetch(
        `/api/saved-replies/${reply.id}`,
        {
          method: "DELETE",
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to delete quick reply.",
        );
      }

      setSavedReplies((current) =>
        current.filter(
          (item) =>
            item.id !== reply.id,
        ),
      );
      setDeleteTarget(null);
    } catch (deleteError) {
      window.alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete quick reply.",
      );
    } finally {
      setDeletingReplyId(null);
    }
  }

  return (
    <>
      <div className="space-y-5">
        {/* Summary */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <MessageSquareText
                className="h-7 w-7"
                strokeWidth={1.9}
              />
            </div>

            <div>
              <p className="text-sm text-slate-500">
                <WorkspaceLanguageText en="Total replies" km="ការឆ្លើយតបសរុប" />
              </p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {totalCount}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                <WorkspaceLanguageText en="All quick replies in your workspace" km="ការឆ្លើយតបរហ័សទាំងអស់ក្នុងកន្លែងធ្វើការរបស់អ្នក" />
              </p>
            </div>
          </div>

          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2
                className="h-7 w-7"
                strokeWidth={1.9}
              />
            </div>

            <div>
              <p className="text-sm text-slate-500">
                <WorkspaceLanguageText en="Active" km="កំពុងប្រើ" />
              </p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {activeCount}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                <WorkspaceLanguageText en="Active quick replies" km="ការឆ្លើយតបរហ័សដែលកំពុងប្រើ" />
              </p>
            </div>
          </div>

          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
              <Folder
                className="h-7 w-7"
                strokeWidth={1.9}
              />
            </div>

            <div>
              <p className="text-sm text-slate-500">
                <WorkspaceLanguageText en="Categories" km="ប្រភេទ" />
              </p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {categories.length}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                <WorkspaceLanguageText en="Organized reply categories" km="ប្រភេទការឆ្លើយតបដែលបានរៀបចំ" />
              </p>
            </div>
          </div>
        </div>

        {!canManageContent ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            {isKhmer
              ? "មានតែម្ចាស់ ឬសមាជិកដែលបានផ្តល់សិទ្ធិប៉ុណ្ណោះ ដែលអាចផ្លាស់ប្តូរស្លាក និងការឆ្លើយតបរហ័សបាន។ អ្នកនៅតែអាចមើល និងប្រើវាក្នុងប្រអប់សារបាន។"
              : "Only an Owner, or a member given permission, can change tags and quick replies. You can still view them and use them in the inbox."}
          </div>
        ) : null}

        {/*
          Categories sit above the list they organise, and above the filter that
          uses their order -- rearranging them and then seeing the filter change
          reads as cause and effect.
        */}
        <SavedReplyCategoryManager
          categories={managedCategories}
          canManage={canManageContent}
          onChange={setManagedCategories}
          onRepliesChanged={() =>
            router.refresh()
          }
        />

        {/* Main manager */}
        <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-[460px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder={isKhmer ? "ស្វែងរកការឆ្លើយតបរហ័ស..." : "Search quick replies..."}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-14 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">
                  ⌘ K
                </span>
              </div>

              <button
                type="button"
                onClick={openCreate}
                disabled={!canManageContent}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                <Plus
                  className="h-4 w-4"
                  strokeWidth={2.2}
                />
                <WorkspaceLanguageText en="New quick reply" km="ការឆ្លើយតបរហ័សថ្មី" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", isKhmer ? "ទាំងអស់" : "All", totalCount],
                    ["active", isKhmer ? "កំពុងប្រើ" : "Active", activeCount],
                    ["inactive", isKhmer ? "បានបិទ" : "Inactive", inactiveCount],
                  ] as const
                ).map(([value, label, count]) => {
                  const selected =
                    statusFilter === value;

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setStatusFilter(value)
                      }
                      className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition ${
                        selected
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                      <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {count}
                      </span>
                    </button>
                  );
                })}

                {categories
                  .slice(0, 3)
                  .map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() =>
                        setCategoryFilter(
                          categoryFilter === category
                            ? "all"
                            : category,
                        )
                      }
                      className={`h-9 rounded-xl border px-3.5 text-sm font-medium transition ${
                        categoryFilter === category
                          ? "border-violet-300 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {category}
                    </button>
                  ))}

                {categories.length > 3 ? (
                  <div className="relative">
                    <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      value={categoryFilter}
                      onChange={(event) =>
                        setCategoryFilter(
                          event.target.value,
                        )
                      }
                      className="h-9 appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm font-medium text-slate-600 outline-none hover:bg-slate-50"
                      aria-label={isKhmer ? "តម្រងតាមប្រភេទ" : "Filter by category"}
                    >
                      <option value="all">
                        {isKhmer ? "តម្រងបន្ថែម" : "More filters"}
                      </option>
                      {categories.map(
                        (category) => (
                          <option
                            key={category}
                            value={category}
                          >
                            {category}
                          </option>
                        ),
                      )}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                ) : null}
              </div>

              <div className="relative w-fit">
                <select
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(
                      event.target.value as
                        | "order"
                        | "name"
                        | "status",
                    )
                  }
                  className="h-9 appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-sm font-medium text-slate-600 outline-none hover:bg-slate-50"
                  aria-label={isKhmer ? "តម្រៀបការឆ្លើយតបរហ័ស" : "Sort quick replies"}
                >
                  <option value="order">
                    {isKhmer ? "តម្រៀបតាម៖ លំដាប់" : "Sort by: Order"}
                  </option>
                  <option value="name">
                    {isKhmer ? "តម្រៀបតាម៖ ឈ្មោះ" : "Sort by: Name"}
                  </option>
                  <option value="status">
                    {isKhmer ? "តម្រៀបតាម៖ ស្ថានភាព" : "Sort by: Status"}
                  </option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block">
            <div className="sticky top-0 z-10 grid grid-cols-[70px_minmax(280px,2fr)_130px_130px_110px_150px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
              <div>{isKhmer ? "លំដាប់" : "Order"}</div>
              <div>{isKhmer ? "ការឆ្លើយតបរហ័ស" : "Quick reply"}</div>
              <div>{isKhmer ? "ផ្លូវកាត់" : "Shortcut"}</div>
              <div>{isKhmer ? "ប្រភេទ" : "Category"}</div>
              <div>{isKhmer ? "ស្ថានភាព" : "Status"}</div>
              <div className="text-right">
                {isKhmer ? "សកម្មភាព" : "Actions"}
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto overscroll-contain">
              <div className="divide-y divide-slate-100">
              {sortedReplies.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-slate-500">
                  <WorkspaceLanguageText en="No quick replies found." km="រកមិនឃើញការឆ្លើយតបរហ័ស។" />
                </div>
              ) : (
                visibleReplies.map((reply) => (
                  <div
                    key={reply.id}
                    className={`grid grid-cols-[70px_minmax(280px,2fr)_130px_130px_110px_150px] items-center px-4 py-4 transition ${
                      reply.is_active
                        ? "bg-white hover:bg-slate-50/60"
                        : "bg-slate-50/70 text-slate-500"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-600">
                      {reply.sort_index}
                    </div>

                    {/*
                      Title above the message it sends, because that is the
                      order they matter in: the title is how the agent finds
                      the reply, the message is what the customer receives.
                      They were two columns far apart, so a long message pushed
                      the title into a sliver and neither could be read.

                      Both are clamped rather than wrapped -- one line for the
                      title, two for the message -- so a reply holding an essay
                      takes the same row height as one holding a sentence, and
                      the list stays scannable however customers write.
                    */}
                    <div className="min-w-0 pr-4">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {reply.title}
                      </p>

                      <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-slate-500">
                        {reply.message_text}
                      </p>

                      <AttachmentThumbnails
                        attachments={
                          reply.attachments ?? []
                        }
                      />
                    </div>

                    <div>
                      {reply.shortcut ? (
                        <span className="inline-flex max-w-[110px] truncate rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-xs text-slate-600">
                          {reply.shortcut}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">
                          —
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="inline-flex max-w-[110px] truncate rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700">
                        {reply.category ??
                          (isKhmer ? "គ្មានប្រភេទ" : "Uncategorized")}
                      </span>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          void toggleActive(reply)
                        }
                        disabled={!canManageContent}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          reply.is_active
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            reply.is_active
                              ? "bg-emerald-500"
                              : "bg-slate-400"
                          }`}
                        />
                        {reply.is_active
                          ? (isKhmer ? "កំពុងប្រើ" : "Active")
                          : (isKhmer ? "បានបិទ" : "Inactive")}
                      </button>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          openEdit(reply)
                        }
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        aria-label={`${isKhmer ? "កែសម្រួល" : "Edit"} ${reply.title}`}
                        title={isKhmer ? "កែសម្រួល" : "Edit"}
                      >
                        <Pencil
                          className="h-4 w-4"
                          strokeWidth={2}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void toggleActive(reply)
                        }
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                        aria-label={
                          reply.is_active
                            ? `${isKhmer ? "បិទ" : "Disable"} ${reply.title}`
                            : `${isKhmer ? "បើក" : "Enable"} ${reply.title}`
                        }
                        title={
                          reply.is_active
                            ? (isKhmer ? "ផ្អាក" : "Pause")
                            : (isKhmer ? "បន្ត" : "Resume")
                        }
                      >
                        {reply.is_active ? (
                          <CirclePause
                            className="h-4 w-4"
                            strokeWidth={2}
                          />
                        ) : (
                          <CirclePlay
                            className="h-4 w-4"
                            strokeWidth={2}
                          />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget(reply)
                        }
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50"
                        aria-label={`${isKhmer ? "លុប" : "Delete"} ${reply.title}`}
                        title={isKhmer ? "លុប" : "Delete"}
                      >
                        <Trash2
                          className="h-4 w-4"
                          strokeWidth={2}
                        />
                      </button>
                    </div>
                  </div>
                ))
              )}

                {hiddenReplyCount > 0 ? (
                  <div className="px-4 py-4 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleCount(
                          (current) =>
                            current +
                            REPLY_PAGE_SIZE,
                        )
                      }
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {isKhmer
                        ? `បង្ហាញបន្ថែម (${hiddenReplyCount})`
                        : `Show ${Math.min(
                            hiddenReplyCount,
                            REPLY_PAGE_SIZE,
                          )} more of ${hiddenReplyCount}`}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Responsive cards */}
          <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto overscroll-contain lg:hidden">
            {sortedReplies.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                <WorkspaceLanguageText en="No quick replies found." km="រកមិនឃើញការឆ្លើយតបរហ័ស។" />
              </div>
            ) : (
              visibleReplies.map((reply) => (
                <div
                  key={reply.id}
                  className={`p-4 ${
                    reply.is_active
                      ? "bg-white"
                      : "bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {reply.title}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {reply.shortcut ? (
                          <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">
                            {reply.shortcut}
                          </span>
                        ) : null}

                        <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">
                          {reply.category ??
                            (isKhmer ? "គ្មានប្រភេទ" : "Uncategorized")}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void toggleActive(reply)
                      }
                      disabled={!canManageContent}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        reply.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {reply.is_active
                        ? (isKhmer ? "កំពុងប្រើ" : "Active")
                        : (isKhmer ? "បានបិទ" : "Inactive")}
                    </button>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">
                    {reply.message_text}
                  </p>

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openEdit(reply)
                      }
                      disabled={!canManageContent}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600"
                      aria-label={`${isKhmer ? "កែសម្រួល" : "Edit"} ${reply.title}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget(reply)
                      }
                      disabled={!canManageContent}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 text-rose-500"
                      aria-label={`${isKhmer ? "លុប" : "Delete"} ${reply.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
            {hiddenReplyCount > 0 ? (
              <div className="px-4 py-4 text-center">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount(
                      (current) =>
                        current + REPLY_PAGE_SIZE,
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                >
                  {isKhmer
                    ? `បង្ហាញបន្ថែម (${hiddenReplyCount})`
                    : `Show ${Math.min(
                        hiddenReplyCount,
                        REPLY_PAGE_SIZE,
                      )} more of ${hiddenReplyCount}`}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {isKhmer ? (
                <>
                  កំពុងបង្ហាញ {sortedReplies.length} ក្នុងចំណោម{" "}
                  {savedReplies.length} លទ្ធផល
                  {savedReplies.length > 8 ? " · រមូរបញ្ជីដើម្បីមើលបន្ថែម" : ""}
                </>
              ) : (
                <>
                  Showing {sortedReplies.length} of{" "}
                  {savedReplies.length} result
                  {savedReplies.length === 1 ? "" : "s"}
                  {savedReplies.length > 8 ? " · scroll the list to see more" : ""}
                </>
              )}
            </p>

            <div className="flex items-center gap-2">
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                {Math.max(
                  10,
                  sortedReplies.length,
                )}{" "}
                {isKhmer ? "ក្នុងមួយទំព័រ" : "per page"}
              </span>

              <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-blue-50 px-2 font-semibold text-blue-700">
                1
              </span>
            </div>
          </div>
        </section>
      </div>

      {modalMode ? (
        <SavedReplyFormModal
          mode={modalMode}
          value={form}
          saving={saving}
          error={error}
          categories={existingCategories}
          onChange={setForm}
          onClose={closeModal}
          onSubmit={() =>
            void submitForm()
          }
        />
      ) : null}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title={isKhmer ? "លុប Quick Reply?" : "Delete quick reply?"}
        description={
          deleteTarget
            ? isKhmer
              ? `Quick Reply "${deleteTarget.title}" នឹងត្រូវបានលុបជាអចិន្ត្រៃយ៍។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។`
              : `The quick reply "${deleteTarget.title}" will be permanently deleted. This action cannot be undone.`
            : ""
        }
        confirmLabel={isKhmer ? "លុប" : "Delete"}
        cancelLabel={isKhmer ? "បោះបង់" : "Cancel"}
        loadingLabel={isKhmer ? "កំពុងលុប..." : "Deleting..."}
        loading={
          Boolean(
            deleteTarget &&
              deletingReplyId === deleteTarget.id,
          )
        }
        onCancel={() => {
          if (!deletingReplyId) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget && !deletingReplyId) {
            void deleteReply(deleteTarget);
          }
        }}
      />
    </>
  );
}
