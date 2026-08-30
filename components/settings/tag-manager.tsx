"use client";

import { useMemo, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { useWorkspacePermissions } from "@/lib/auth/use-workspace-permissions";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Copy,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Loader2,
  Search,
  Tag,
  Trash2,
} from "lucide-react";

import {
  TagFormModal,
  type TagFormValue,
} from "@/components/settings/tag-form-modal";
import type {
  CustomerTag,
  TagColor,
} from "@/types/inbox";

type TagManagerProps = {
  businessId: string;
  businessName: string;
  initialTags: CustomerTag[];
};

type WorkspaceOption = {
  businessId: string;
  businessName: string;
  subscriptionOperational?: boolean;
};

type WorkspacesResponse = {
  success?: boolean;
  error?: string;
  workspaces?: WorkspaceOption[];
};

type CopySourceResponse = {
  success?: boolean;
  error?: string;
  workspace?: {
    businessId: string;
    businessName: string;
  };
  tags?: CustomerTag[];
};

type CopyTagsResponse = {
  success?: boolean;
  error?: string;
  copied?: CustomerTag[];
  copiedCount?: number;
  skippedCount?: number;
};

type TagResponse = {
  success?: boolean;
  error?: string;
  tag?: CustomerTag;
};

const badgeClasses: Record<
  TagColor,
  string
> = {
  slate: "bg-slate-500 text-white",
  red: "bg-red-500 text-white",
  orange: "bg-orange-500 text-white",
  amber: "bg-amber-500 text-white",
  teal: "bg-teal-500 text-white",
  blue: "bg-blue-500 text-white",
  indigo: "bg-indigo-500 text-white",
  violet: "bg-violet-500 text-white",
  yellow: "bg-amber-400 text-slate-900",
  emerald: "bg-emerald-600 text-white",
  pink: "bg-pink-500 text-white",
};

function emptyForm(nextIndex: number): TagFormValue {
  return {
    name: "",
    color: "emerald",
    sortIndex: nextIndex,
    description: "",
    isActive: true,
  };
}

function formFromTag(
  tag: CustomerTag,
): TagFormValue {
  return {
    name: tag.name,
    color: tag.color,
    sortIndex: tag.sort_index,
    description: tag.description ?? "",
    isActive: tag.is_active,
  };
}

export function TagManager({
  businessId,
  businessName,
  initialTags,
}: TagManagerProps) {
  // Usage is always allowed; this only gates create / edit / delete.
  const { can } = useWorkspacePermissions();
  const canManageContent = can("tags_quick_replies");
  const [tags, setTags] =
    useState<CustomerTag[]>(initialTags);
  const [search, setSearch] =
    useState("");
  const [statusFilter, setStatusFilter] =
    useState<"all" | "active" | "disabled">("all");
  const [modalMode, setModalMode] =
    useState<"create" | "edit" | null>(
      null,
    );
  const [selectedTag, setSelectedTag] =
    useState<CustomerTag | null>(null);
  const [form, setForm] =
    useState<TagFormValue>(
      emptyForm(initialTags.length + 1),
    );
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<CustomerTag | null>(null);
  const [deletingTagId, setDeletingTagId] =
    useState<string | null>(null);
  const [copyOpen, setCopyOpen] =
    useState(false);
  const [copySources, setCopySources] =
    useState<WorkspaceOption[]>([]);
  const [copySourcesLoading, setCopySourcesLoading] =
    useState(false);
  const [copySourceBusinessId, setCopySourceBusinessId] =
    useState("");
  const [copySourceTags, setCopySourceTags] =
    useState<CustomerTag[]>([]);
  const [copySourceLoading, setCopySourceLoading] =
    useState(false);
  const [copySelectedTagIds, setCopySelectedTagIds] =
    useState<string[]>([]);
  const [copySaving, setCopySaving] =
    useState(false);
  const [copyError, setCopyError] =
    useState<string | null>(null);
  const [copyNotice, setCopyNotice] =
    useState<string | null>(null);

  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";

  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tags.filter((tag) => {
      const matchesSearch =
        !query ||
        `${tag.name} ${tag.description ?? ""}`
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && tag.is_active) ||
        (statusFilter === "disabled" && !tag.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, tags]);

  const existingTagNames = useMemo(
    () =>
      new Set(
        tags.map((tag) => tag.name.trim().toLocaleLowerCase()),
      ),
    [tags],
  );

  const eligibleCopyTags = useMemo(
    () =>
      copySourceTags.filter(
        (tag) =>
          !existingTagNames.has(
            tag.name.trim().toLocaleLowerCase(),
          ),
      ),
    [copySourceTags, existingTagNames],
  );

  async function loadCopySourceTags(sourceBusinessId: string) {
    setCopySourceBusinessId(sourceBusinessId);
    setCopySelectedTagIds([]);
    setCopySourceTags([]);
    setCopyError(null);

    if (!sourceBusinessId) {
      return;
    }

    setCopySourceLoading(true);

    try {
      const response = await fetch(
        `/api/tags/copy?sourceBusinessId=${encodeURIComponent(sourceBusinessId)}`,
        { cache: "no-store" },
      );
      const result =
        (await response.json()) as CopySourceResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to load tags from that workspace.",
        );
      }

      setCopySourceTags(result.tags ?? []);
    } catch (loadError) {
      setCopyError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load tags from that workspace.",
      );
    } finally {
      setCopySourceLoading(false);
    }
  }

  async function openCopy() {
    if (!canManageContent) {
      return;
    }

    setCopyOpen(true);
    setCopyError(null);
    setCopyNotice(null);
    setCopySourceBusinessId("");
    setCopySourceTags([]);
    setCopySelectedTagIds([]);
    setCopySourcesLoading(true);

    try {
      const response = await fetch("/api/workspaces", {
        cache: "no-store",
      });
      const result =
        (await response.json()) as WorkspacesResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load your workspaces.",
        );
      }

      const sources = (result.workspaces ?? []).filter(
        (workspace) =>
          workspace.businessId !== businessId &&
          workspace.subscriptionOperational !== false,
      );

      setCopySources(sources);

      if (sources.length === 1) {
        void loadCopySourceTags(sources[0].businessId);
      }
    } catch (loadError) {
      setCopyError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your workspaces.",
      );
    } finally {
      setCopySourcesLoading(false);
    }
  }

  function closeCopy() {
    if (copySaving) {
      return;
    }

    setCopyOpen(false);
    setCopyError(null);
    setCopySelectedTagIds([]);
  }

  function toggleCopyTag(tagId: string) {
    setCopySelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    );
  }

  function toggleAllCopyTags() {
    const eligibleIds = eligibleCopyTags.map((tag) => tag.id);
    const allSelected =
      eligibleIds.length > 0 &&
      eligibleIds.every((id) => copySelectedTagIds.includes(id));

    setCopySelectedTagIds(allSelected ? [] : eligibleIds);
  }

  async function copySelectedTags() {
    if (!copySourceBusinessId || copySelectedTagIds.length === 0) {
      return;
    }

    setCopySaving(true);
    setCopyError(null);

    try {
      const response = await fetch("/api/tags/copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceBusinessId: copySourceBusinessId,
          tagIds: copySelectedTagIds,
        }),
      });
      const result =
        (await response.json()) as CopyTagsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to copy the selected tags.",
        );
      }

      const copied = result.copied ?? [];
      if (copied.length > 0) {
        setTags((current) => [...current, ...copied]);
      }

      const copiedCount = result.copiedCount ?? copied.length;
      const skippedCount = result.skippedCount ?? 0;
      setCopyNotice(
        skippedCount > 0
          ? `${copiedCount} tag${copiedCount === 1 ? "" : "s"} copied to ${businessName}. ${skippedCount} already existed or could not be copied.`
          : `${copiedCount} tag${copiedCount === 1 ? "" : "s"} copied to ${businessName}.`,
      );
      setCopyOpen(false);
      setCopySelectedTagIds([]);
    } catch (copySubmitError) {
      setCopyError(
        copySubmitError instanceof Error
          ? copySubmitError.message
          : "Unable to copy the selected tags.",
      );
    } finally {
      setCopySaving(false);
    }
  }

  function openCreate() {
    const nextIndex =
      tags.reduce(
        (largest, tag) =>
          Math.max(
            largest,
            tag.sort_index,
          ),
        0,
      ) + 1;

    setSelectedTag(null);
    setForm(emptyForm(nextIndex));
    setError(null);
    setModalMode("create");
  }

  function openEdit(tag: CustomerTag) {
    setSelectedTag(tag);
    setForm(formFromTag(tag));
    setError(null);
    setModalMode("edit");
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalMode(null);
    setSelectedTag(null);
    setError(null);
  }

  async function submitForm() {
    setSaving(true);
    setError(null);

    try {
      const isEditing =
        modalMode === "edit" &&
        selectedTag;

      const response = await fetch(
        isEditing
          ? `/api/tags/${selectedTag.id}`
          : "/api/tags",
        {
          method: isEditing
            ? "PATCH"
            : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(isEditing
              ? {}
              : { businessId }),
            name: form.name,
            color: form.color,
            sortIndex: form.sortIndex,
            description: form.description,
            isActive: form.isActive,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.tag
      ) {
        throw new Error(
          result.error ??
            "Unable to save tag.",
        );
      }

      if (isEditing) {
        setTags((current) =>
          current.map((tag) =>
            tag.id === result.tag?.id
              ? (result.tag as CustomerTag)
              : tag,
          ),
        );
      } else {
        setTags((current) => [
          ...current,
          result.tag as CustomerTag,
        ]);
      }

      closeModal();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save tag.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(
    tag: CustomerTag,
  ) {
    try {
      const response = await fetch(
        `/api/tags/${tag.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isActive: !tag.is_active,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.tag
      ) {
        throw new Error(
          result.error ??
            "Unable to update tag.",
        );
      }

      setTags((current) =>
        current.map((item) =>
          item.id === tag.id
            ? (result.tag as CustomerTag)
            : item,
        ),
      );
    } catch (toggleError) {
      window.alert(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update tag.",
      );
    }
  }

  async function deleteTag(
    tag: CustomerTag,
  ) {
    setDeletingTagId(tag.id);

    try {
      const response = await fetch(
        `/api/tags/${tag.id}`,
        {
          method: "DELETE",
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to delete tag.",
        );
      }

      setTags((current) =>
        current.filter(
          (item) => item.id !== tag.id,
        ),
      );
      setDeleteTarget(null);
    } catch (deleteError) {
      window.alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete tag.",
      );
    } finally {
      setDeletingTagId(null);
    }
  }

  const sortedTags = [...filteredTags].sort(
    (a, b) => {
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }

      return (
        a.sort_index - b.sort_index ||
        a.name.localeCompare(b.name)
      );
    },
  );

  const totalCount = tags.length;
  const activeCount = tags.filter((tag) => tag.is_active).length;
  const disabledCount = totalCount - activeCount;

  return (
    <>
      <div className="space-y-5">
        {/* Summary cards */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Tag className="h-7 w-7" strokeWidth={1.9} />
            </div>
            <div>
              <p className="text-sm text-slate-500">{isKhmer ? "ស្លាកសរុប" : "Total tags"}</p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {totalCount}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {isKhmer ? "គ្រប់ស្ថានភាពទាំងអស់" : "Across all statuses"}
              </p>
            </div>
          </div>

          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" strokeWidth={1.9} />
            </div>
            <div>
              <p className="text-sm text-slate-500">{isKhmer ? "កំពុងប្រើ" : "Active"}</p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {activeCount}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {isKhmer ? "កំពុងបើកដំណើរការ" : "Currently enabled"}
              </p>
            </div>
          </div>

          <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <CirclePause className="h-7 w-7" strokeWidth={1.9} />
            </div>
            <div>
              <p className="text-sm text-slate-500">{isKhmer ? "បានបិទ" : "Disabled"}</p>
              <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
                {disabledCount}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {isKhmer ? "កំពុងបិទដំណើរការ" : "Currently disabled"}
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

        {copyNotice ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{copyNotice}</span>
            <button
              type="button"
              onClick={() => setCopyNotice(null)}
              className="shrink-0 font-semibold text-emerald-700 hover:text-emerald-900"
            >
              {isKhmer ? "បិទ" : "Dismiss"}
            </button>
          </div>
        ) : null}

        {/* Main tag manager */}
        <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-[360px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder={isKhmer ? "ស្វែងរកស្លាក..." : "Search tags..."}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openCopy()}
                  disabled={!canManageContent}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" strokeWidth={2.1} />
                  {isKhmer ? "ចម្លងពី Workspace" : "Copy from workspace"}
                </button>

                <button
                  type="button"
                  onClick={openCreate}
                  disabled={!canManageContent}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.2} />
                  {isKhmer ? "ស្លាកថ្មី" : "New tag"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(
                [
                  ["all", isKhmer ? "ទាំងអស់" : "All", totalCount],
                  ["active", isKhmer ? "កំពុងប្រើ" : "Active", activeCount],
                  ["disabled", isKhmer ? "បានបិទ" : "Disabled", disabledCount],
                ] as const
              ).map(([value, label, count]) => {
                const selected = statusFilter === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition ${
                      selected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                    <span
                      className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] ${
                        selected
                          ? "bg-white text-slate-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block">
            <div className="grid grid-cols-[88px_180px_minmax(220px,1.4fr)_130px_150px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
              <div>{isKhmer ? "លំដាប់" : "Order"}</div>
              <div>{isKhmer ? "ស្លាក" : "Tag"}</div>
              <div>{isKhmer ? "ការពិពណ៌នា" : "Description"}</div>
              <div>{isKhmer ? "ស្ថានភាព" : "Status"}</div>
              <div className="text-right">{isKhmer ? "សកម្មភាព" : "Actions"}</div>
            </div>

            <div className="divide-y divide-slate-100">
              {sortedTags.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-slate-500">
                  {isKhmer ? "រកមិនឃើញស្លាក។" : "No tags found."}
                </div>
              ) : (
                sortedTags.map((tag) => (
                  <div
                    key={tag.id}
                    className={`grid grid-cols-[88px_180px_minmax(220px,1.4fr)_130px_150px] items-center px-4 py-4 transition ${
                      tag.is_active
                        ? "bg-white hover:bg-slate-50/60"
                        : "bg-slate-50/70 text-slate-500"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                      <GripVertical className="h-4 w-4 text-slate-400" />
                      {tag.sort_index}
                    </div>

                    <div>
                      <span
                        className="inline-flex max-w-[150px] items-center truncate rounded-lg border px-3 py-1.5 text-sm font-bold"
                        style={{
                          color: tag.color,
                          borderColor: `${tag.color}33`,
                          backgroundColor: `${tag.color}14`,
                        }}
                        title={tag.name}
                      >
                        {tag.name}
                      </span>
                    </div>

                    <div className="pr-5 text-sm leading-5 text-slate-500">
                      {tag.description ?? (isKhmer ? "គ្មានការពិពណ៌នា" : "No description")}
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => void toggleActive(tag)}
                        disabled={!canManageContent}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          tag.is_active
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            tag.is_active
                              ? "bg-emerald-500"
                              : "bg-slate-400"
                          }`}
                        />
                        {tag.is_active ? (isKhmer ? "កំពុងប្រើ" : "Active") : (isKhmer ? "បានបិទ" : "Disabled")}
                      </button>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(tag)}
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        aria-label={`Edit ${tag.name}`}
                        title={isKhmer ? "កែសម្រួល" : "Edit"}
                      >
                        <Pencil className="h-4 w-4" strokeWidth={2} />
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleActive(tag)}
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                        aria-label={
                          tag.is_active
                            ? `Disable ${tag.name}`
                            : `Enable ${tag.name}`
                        }
                        title={tag.is_active ? (isKhmer ? "បិទ" : "Disable") : (isKhmer ? "បើក" : "Enable")}
                      >
                        <CirclePause className="h-4 w-4" strokeWidth={2} />
                      </button>

                      <button
                        type="button"
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
                        aria-label={isKhmer ? "សកម្មភាពបន្ថែម" : "More actions"}
                        title={isKhmer ? "សកម្មភាពបន្ថែម" : "More actions"}
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteTarget(tag)}
                        disabled={!canManageContent}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition hover:bg-rose-50"
                        aria-label={`Delete ${tag.name}`}
                        title={isKhmer ? "លុប" : "Delete"}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Compact/mobile cards so the page stays fitted */}
          <div className="divide-y divide-slate-100 lg:hidden">
            {sortedTags.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                {isKhmer ? "រកមិនឃើញស្លាក។" : "No tags found."}
              </div>
            ) : (
              sortedTags.map((tag) => (
                <div
                  key={tag.id}
                  className={`p-4 ${
                    tag.is_active ? "bg-white" : "bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-400">
                          {tag.sort_index}
                        </span>
                        <span
                          className="inline-flex max-w-[180px] items-center truncate rounded-lg border px-2.5 py-1 text-sm font-bold"
                          style={{
                            color: tag.color,
                            borderColor: `${tag.color}33`,
                            backgroundColor: `${tag.color}14`,
                          }}
                        >
                          {tag.name}
                        </span>
                      </div>

                      <p className="mt-2 text-sm leading-5 text-slate-500">
                        {tag.description ?? (isKhmer ? "គ្មានការពិពណ៌នា" : "No description")}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void toggleActive(tag)}
                      disabled={!canManageContent}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        tag.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {tag.is_active ? (isKhmer ? "កំពុងប្រើ" : "Active") : (isKhmer ? "បានបិទ" : "Disabled")}
                    </button>
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(tag)}
                      disabled={!canManageContent}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600"
                      aria-label={`Edit ${tag.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(tag)}
                      disabled={!canManageContent}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 text-rose-500"
                      aria-label={`Delete ${tag.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {isKhmer ? (
                <>កំពុងបង្ហាញ {sortedTags.length} ក្នុងចំណោម {tags.length} ស្លាក</>
              ) : (
                <>Showing {sortedTags.length} of {tags.length} tag{tags.length === 1 ? "" : "s"}</>
              )}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-300"
                aria-label={isKhmer ? "ទំព័រមុន" : "Previous page"}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-blue-500 bg-blue-50 px-2 font-semibold text-blue-700">
                1
              </span>
              <button
                type="button"
                disabled
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-300"
                aria-label={isKhmer ? "ទំព័របន្ទាប់" : "Next page"}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </div>

      {modalMode ? (
        <TagFormModal
          mode={modalMode}
          value={form}
          saving={saving}
          error={error}
          onChange={setForm}
          onClose={closeModal}
          onSubmit={() => void submitForm()}
        />
      ) : null}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title={isKhmer ? "លុបស្លាក?" : "Delete tag?"}
        description={
          deleteTarget
            ? isKhmer
              ? `ស្លាក "${deleteTarget.name}" នឹងត្រូវបានលុបជាអចិន្ត្រៃយ៍ និងដកចេញពីអតិថិជនទាំងអស់។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។`
              : `The tag "${deleteTarget.name}" will be permanently deleted and removed from every customer. This action cannot be undone.`
            : ""
        }
        confirmLabel={isKhmer ? "លុប" : "Delete"}
        cancelLabel={isKhmer ? "បោះបង់" : "Cancel"}
        loadingLabel={isKhmer ? "កំពុងលុប..." : "Deleting..."}
        loading={
          Boolean(
            deleteTarget &&
              deletingTagId === deleteTarget.id,
          )
        }
        onCancel={() => {
          if (!deletingTagId) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget && !deletingTagId) {
            void deleteTag(deleteTarget);
          }
        }}
      />

      {copyOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCopy();
            }
          }}
        >
          <section className="flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-[640px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-extrabold tracking-tight text-slate-950">
                    {isKhmer ? "ចម្លងស្លាកពី Workspace ផ្សេង" : "Copy tags from another workspace"}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {isKhmer
                      ? `ចម្លងស្លាកទៅ ${businessName}។ ការភ្ជាប់ស្លាកជាមួយអតិថិជនមិនត្រូវបានចម្លងទេ។`
                      : `Copy tag definitions into ${businessName}. Customer tag assignments are not copied.`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeCopy}
                  disabled={copySaving}
                  className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  {isKhmer ? "បោះបង់" : "Cancel"}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <label className="block text-sm font-bold text-slate-700">
                {isKhmer ? "Workspace ប្រភព" : "Source workspace"}
              </label>

              <div className="mt-2">
                {copySourcesLoading ? (
                  <div className="flex h-12 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isKhmer ? "កំពុងផ្ទុក Workspace..." : "Loading workspaces..."}
                  </div>
                ) : copySources.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    {isKhmer
                      ? "មិនមាន Workspace ផ្សេងដែលអ្នកអាចចម្លងស្លាកពីបានទេ។"
                      : "There is no other workspace available to copy tags from."}
                  </div>
                ) : (
                  <select
                    value={copySourceBusinessId}
                    onChange={(event) =>
                      void loadCopySourceTags(event.target.value)
                    }
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">
                      {isKhmer ? "ជ្រើស Workspace" : "Choose a workspace"}
                    </option>
                    {copySources.map((workspace) => (
                      <option
                        key={workspace.businessId}
                        value={workspace.businessId}
                      >
                        {workspace.businessName}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {copyError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {copyError}
                </div>
              ) : null}

              {copySourceBusinessId ? (
                <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        {isKhmer ? "ជ្រើសស្លាក" : "Select tags"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {copySelectedTagIds.length} {isKhmer ? "បានជ្រើស" : "selected"}
                      </p>
                    </div>

                    {eligibleCopyTags.length > 0 ? (
                      <button
                        type="button"
                        onClick={toggleAllCopyTags}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800"
                      >
                        {eligibleCopyTags.every((tag) =>
                          copySelectedTagIds.includes(tag.id),
                        )
                          ? isKhmer
                            ? "ដោះជ្រើសទាំងអស់"
                            : "Clear all"
                          : isKhmer
                            ? "ជ្រើសទាំងអស់"
                            : "Select all"}
                      </button>
                    ) : null}
                  </div>

                  {copySourceLoading ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isKhmer ? "កំពុងផ្ទុកស្លាក..." : "Loading tags..."}
                    </div>
                  ) : copySourceTags.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-slate-500">
                      {isKhmer ? "Workspace នេះមិនមានស្លាកទេ។" : "This workspace has no tags."}
                    </div>
                  ) : (
                    <div className="max-h-[330px] divide-y divide-slate-100 overflow-y-auto">
                      {copySourceTags.map((tag) => {
                        const alreadyExists = existingTagNames.has(
                          tag.name.trim().toLocaleLowerCase(),
                        );
                        const selected = copySelectedTagIds.includes(tag.id);

                        return (
                          <label
                            key={tag.id}
                            className={`flex items-center gap-3 px-4 py-3 transition ${
                              alreadyExists
                                ? "cursor-not-allowed bg-slate-50/80"
                                : "cursor-pointer hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={alreadyExists}
                              onChange={() => toggleCopyTag(tag.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-800">
                                {tag.name}
                              </span>
                              {tag.description ? (
                                <span className="mt-0.5 block truncate text-xs text-slate-500">
                                  {tag.description}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                                alreadyExists
                                  ? "bg-slate-200 text-slate-500"
                                  : tag.is_active
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {alreadyExists
                                ? isKhmer
                                  ? "មានរួចហើយ"
                                  : "Already exists"
                                : tag.is_active
                                  ? isKhmer
                                    ? "កំពុងប្រើ"
                                    : "Active"
                                  : isKhmer
                                    ? "បានបិទ"
                                    : "Disabled"}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs leading-5 text-slate-500">
                {isKhmer
                  ? "ស្លាកដែលមានឈ្មោះដូចគ្នានឹងត្រូវរំលង។"
                  : "Tags with the same name are skipped safely."}
              </p>

              <button
                type="button"
                onClick={() => void copySelectedTags()}
                disabled={
                  copySaving ||
                  copySelectedTagIds.length === 0 ||
                  !copySourceBusinessId
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {copySaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copySaving
                  ? isKhmer
                    ? "កំពុងចម្លង..."
                    : "Copying..."
                  : isKhmer
                    ? `ចម្លង ${copySelectedTagIds.length} ស្លាក`
                    : `Copy ${copySelectedTagIds.length} tag${copySelectedTagIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
