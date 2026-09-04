"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type MentionMember = {
  id: string;
  full_name: string;
  role?: string | null;
  profile_picture_url?: string | null;
};

type MentionComposerProps = {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  mentionedMemberIds: string[];
  onMentionedMemberIdsChange: (
    memberIds: string[],
  ) => void;
  mentionEveryone: boolean;
  onMentionEveryoneChange: (
    value: boolean,
  ) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  tone?: "default" | "note";
  compact?: boolean;
};

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "T";
}

export function MentionComposer({
  value,
  onChange,
  members,
  mentionedMemberIds,
  onMentionedMemberIdsChange,
  mentionEveryone,
  onMentionEveryoneChange,
  placeholder = "Write a message...",
  rows = 4,
  maxLength = 10000,
  disabled = false,
  tone = "default",
  compact = false,
}: MentionComposerProps) {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const selectedSet = useMemo(
    () => new Set(mentionedMemberIds),
    [mentionedMemberIds],
  );

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return members;
    }

    return members.filter((member) =>
      `${member.full_name} ${member.role ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [members, search]);

  function cleanMentionState(nextText: string) {
    const nextIds = mentionedMemberIds.filter(
      (memberId) => {
        const member = members.find(
          (item) => item.id === memberId,
        );

        if (!member) {
          return false;
        }

        return nextText.includes(`@${member.full_name}`);
      },
    );

    if (
      nextIds.length !== mentionedMemberIds.length
    ) {
      onMentionedMemberIdsChange(nextIds);
    }

    if (
      mentionEveryone &&
      !nextText.toLowerCase().includes("@everyone")
    ) {
      onMentionEveryoneChange(false);
    }
  }

  function handleTextChange(nextText: string) {
    onChange(nextText);
    cleanMentionState(nextText);
  }

  function appendToken(token: string) {
    const trimmed = value.trimEnd();
    const spacer = trimmed ? " " : "";
    const next = `${trimmed}${spacer}${token} `;
    onChange(next);
  }

  function toggleMember(member: MentionMember) {
    if (selectedSet.has(member.id)) {
      onMentionedMemberIdsChange(
        mentionedMemberIds.filter(
          (id) => id !== member.id,
        ),
      );
      onChange(
        value.replaceAll(`@${member.full_name}`, "").replace(/ {2,}/g, " "),
      );
      return;
    }

    onMentionedMemberIdsChange([
      ...mentionedMemberIds,
      member.id,
    ]);
    appendToken(`@${member.full_name}`);
  }

  function toggleEveryone() {
    const next = !mentionEveryone;
    onMentionEveryoneChange(next);

    if (next) {
      if (!value.toLowerCase().includes("@everyone")) {
        appendToken("@everyone");
      }
    } else {
      onChange(
        value
          .replace(/@everyone/gi, "")
          .replace(/ {2,}/g, " "),
      );
    }
  }

  return (
    <div
      className={
        compact
          ? "relative flex min-w-0 flex-1 items-center gap-1.5"
          : "relative"
      }
    >
      {compact ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          className={`flex min-w-[56px] shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-medium transition ${
            open
              ? "bg-blue-50 text-blue-600"
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          } disabled:opacity-40`}
          aria-label={t("Mention", "លើកឡើង")}
          aria-expanded={open}
        >
          <span className="flex h-5 w-5 items-center justify-center text-[16px] font-semibold leading-none">
            @
          </span>
          <span>{t("Mention", "លើកឡើង")}</span>
        </button>
      ) : null}

      <textarea
        value={value}
        onChange={(event) =>
          handleTextChange(event.target.value)
        }
        rows={compact ? 1 : rows}
        maxLength={maxLength}
        placeholder={
          isKhmer && placeholder === "Write a message..."
            ? "សរសេរសារ..."
            : placeholder
        }
        disabled={disabled}
        className={
          compact
            ? "block h-12 max-h-32 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50"
            : `w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 disabled:bg-slate-100 ${
                tone === "note"
                  ? "border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white focus:ring-blue-100"
                  : "border-slate-300 bg-white focus:border-blue-500 focus:ring-blue-100"
              }`
        }
      />

      {!compact ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((current) => !current)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <span className="text-blue-600">@</span>
            {t("Mention", "លើកឡើង")}
          </button>

          {mentionEveryone ? (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
              @everyone
            </span>
          ) : null}

          {mentionedMemberIds.map((memberId) => {
            const member = members.find(
              (item) => item.id === memberId,
            );

            if (!member) {
              return null;
            }

            return (
              <span
                key={member.id}
                className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700"
              >
                @{member.full_name}
              </span>
            );
          })}
        </div>
      ) : null}

      {open ? (
        <div
          ref={popoverRef}
          className={`absolute z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${
            compact
              ? "bottom-[calc(100%+10px)] left-0"
              : "bottom-full left-0 mb-2"
          }`}
        >
          <div className="border-b border-slate-100 p-2">
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={t("Search team member...", "ស្វែងរកសមាជិកក្រុម...")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={toggleEveryone}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-slate-50 ${
                mentionEveryone
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-700"
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 font-bold text-violet-700">
                @
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {t("everyone", "គ្រប់គ្នា")}
                </span>
                <span className="block text-xs text-slate-400">
                  {t("Notify all active team members", "ជូនដំណឹងដល់សមាជិកក្រុមដែលកំពុងប្រើទាំងអស់")}
                </span>
              </span>
              {mentionEveryone ? (
                <span className="text-violet-600">✓</span>
              ) : null}
            </button>

            {filteredMembers.map((member) => {
              const selected = selectedSet.has(member.id);

              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member)}
                  className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-slate-50 ${
                    selected
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-700"
                  }`}
                >
                  {member.profile_picture_url ? (
                    <img
                      src={member.profile_picture_url}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {getInitial(member.full_name)}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {member.full_name}
                    </span>
                    <span className="block truncate text-xs capitalize text-slate-400">
                      {isKhmer
                        ? (member.role?.toLowerCase() === "owner"
                            ? "ម្ចាស់"
                            : member.role?.toLowerCase() === "agent"
                              ? "ភ្នាក់ងារ"
                              : "សមាជិកក្រុម")
                        : (member.role ?? "team member")}
                    </span>
                  </span>

                  {selected ? (
                    <span className="text-blue-600">✓</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-100 p-2 text-right">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {t("Done", "រួចរាល់")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
