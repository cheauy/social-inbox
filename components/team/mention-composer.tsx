"use client";

import {
  useMemo,
  useState,
} from "react";

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
}: MentionComposerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

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
    <div className="relative">
      <textarea
        value={value}
        onChange={(event) =>
          handleTextChange(event.target.value)
        }
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 disabled:bg-slate-100 ${
          tone === "note"
            ? "border-amber-200 bg-amber-50/40 focus:border-amber-500 focus:ring-amber-100"
            : "border-slate-300 bg-white focus:border-blue-500 focus:ring-blue-100"
        }`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span className="text-blue-600">@</span>
          Mention
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

      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search team member..."
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
                  everyone
                </span>
                <span className="block text-xs text-slate-400">
                  Notify all active team members
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
                      {member.role ?? "team member"}
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
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
