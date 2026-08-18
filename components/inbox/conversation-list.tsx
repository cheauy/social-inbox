"use client";

import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  InboxConversation,
} from "@/types/inbox";
import type {
  StatusCounts,
  StatusFilter,
} from "@/components/inbox/inbox-view-types";
import {
  formatMessageTime,
  getInitial,
  getStatusClasses,
  getStatusLabel,
  statusOptions,
} from "@/components/inbox/inbox-utils";
import {
  InboxChannelSelector,
} from "@/components/inbox/inbox-channel-selector";
import { ReminderListPanel } from "@/components/inbox/reminder-list-panel";

type SearchAwareContact =
  NonNullable<InboxConversation["contact"]> & {
    username?: string | null;
    telegram_username?: string | null;
    platform_username?: string | null;
  };

function getTelegramSearchIdentity(
  conversation: InboxConversation,
  platform: "messenger" | "telegram" | null,
): string {
  if (platform !== "telegram") {
    return "";
  }

  const contact =
    conversation.contact as SearchAwareContact | null;

  return (
    contact?.telegram_username ??
    contact?.platform_username ??
    contact?.username ??
    contact?.platform_user_id ??
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

type ConversationListProps = {
  conversations:
    InboxConversation[];
  activeConversationId:
    | string
    | null;
  activeStatus:
    StatusFilter;
  statusCounts:
    StatusCounts;
  onSelectConversation: (
    conversationId: string,
  ) => void;
  onPrefetchConversation?: (
    conversationId: string,
  ) => void;
  onClearConversationSelection?: () => void;
};

type BuiltInViewKey =
  | "all"
  | "unread"
  | "my"
  | "unassigned"
  | "comment"
  | "pinned";

type SavedViewFilters = {
  status:
    | "any"
    | "open"
    | "pending"
    | "resolved"
    | "closed"
    | "spam";
  assignment:
    | "any"
    | "me"
    | "assigned"
    | "unassigned";
  channel:
    | "any"
    | "messenger"
    | "comment";
  unreadOnly: boolean;
  pinnedOnly: boolean;
  tagIds: string[];
};

type SavedView = {
  id: string;
  name: string;
  filters:
    SavedViewFilters;
  sort_index: number;
  created_at: string;
  updated_at: string;
};

type ViewsResponse = {
  success?: boolean;
  error?: string;
  memberId?: string;
  views?: SavedView[];
};

type ViewEditorState = {
  id:
    | string
    | null;
  name: string;
  filters:
    SavedViewFilters;
};

const EMPTY_FILTERS:
  SavedViewFilters = {
    status: "any",
    assignment: "any",
    channel: "any",
    unreadOnly: false,
    pinnedOnly: false,
    tagIds: [],
  };

const filterOptions: Array<{
  value: StatusFilter;
  label: string;
}> = [
  {
    value: "all",
    label: "All",
  },
  ...statusOptions,
];

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M4 6h16M7 12h10M10 18h4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AllConversationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="4"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
      />
      <path
        d="m4 7 8 6 8-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="18"
        cy="6"
        r="3"
        fill="currentColor"
        stroke="white"
      />
    </svg>
  );
}

function CommentIcon() {
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
        d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 9h8M8 13h5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AssignedToMeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="8"
        r="4"
      />
      <path
        d="M3 21v-2a6 6 0 0 1 12 0v2"
        strokeLinecap="round"
      />
      <path
        d="m16 12 2 2 4-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UnassignedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="8"
        r="4"
      />
      <path
        d="M3 21v-2a6 6 0 0 1 10-4.4"
        strokeLinecap="round"
      />
      <path
        d="m16 16 5 5M21 16l-5 5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReminderIcon() {
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
        d="M12 3a7 7 0 0 0-7 7v4l-2 3h18l-2-3v-4a7 7 0 0 0-7-7Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 20h5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinIcon() {
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
        d="m14 4 6 6-3 1-4 4-1 5-3-3-5 3 3-5 4-4 1-3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ViewsIcon() {
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
        d="M4 6h16M4 12h10M4 18h7"
        strokeLinecap="round"
      />
      <circle
        cx="18"
        cy="12"
        r="2"
      />
      <circle
        cx="15"
        cy="18"
        r="2"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle
        cx="5"
        cy="12"
        r="1.6"
      />
      <circle
        cx="12"
        cy="12"
        r="1.6"
      />
      <circle
        cx="19"
        cy="12"
        r="1.6"
      />
    </svg>
  );
}

type ConversationPlatform =
  | "messenger"
  | "telegram";

type ChannelDirectoryEntry = {
  platform:
    | "facebook"
    | "telegram";
  name: string;
};

type ChannelDirectory =
  Record<string, ChannelDirectoryEntry>;

/*
 * Keep resolved channel identities in module memory across client-side
 * conversation route swaps. Next navigation can remount ConversationList,
 * but the module stays alive, so Telegram/Messenger badges no longer vanish
 * while /api/inbox/channels is being fetched again.
 */
let cachedChannelDirectory: ChannelDirectory = {};
let cachedChannelDirectoryLoaded = false;

type ChannelsApiResponse = {
  success?: boolean;
  channels?: Array<{
    id: string;
    platform:
      | "facebook"
      | "telegram";
    name: string;
  }>;
};

function MessengerSourceIcon({
  className = "h-3.5 w-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="currentColor"
      />
      <path
        d="m6.7 15.3 3.7-4 2.9 2.2 4-4.4-3.7 4-2.9-2.2-4 4.4Z"
        fill="white"
      />
    </svg>
  );
}

function TelegramSourceIcon({
  className = "h-3.5 w-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="currentColor"
      />
      <path
        d="M6.1 11.5 17.2 7c.5-.2.9.1.7.8l-1.9 9c-.1.6-.5.7-.9.4l-2.9-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2-.1-.3-.4-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.3-.9Z"
        fill="white"
      />
    </svg>
  );
}

function ChannelAvatarBadge({
  platform,
}: {
  platform: ConversationPlatform;
}) {
  const [pngFailed, setPngFailed] =
    useState(false);

  const pngSrc =
    platform === "telegram"
      ? "/images/channels/telegram.png"
      : "/images/channels/messenger.png";

  return (
    <span
      className={`absolute -bottom-1 -right-1 flex h-5.5 w-5.5 items-center justify-center overflow-hidden rounded-full border-[3px] border-white shadow-[0_1px_4px_rgba(15,23,42,0.20)] ${
        platform === "telegram"
          ? "bg-sky-500 text-sky-500"
          : "bg-blue-600 text-blue-600"
      }`}
      title={
        platform === "telegram"
          ? "Telegram"
          : "Messenger"
      }
      aria-label={
        platform === "telegram"
          ? "Telegram conversation"
          : "Messenger conversation"
      }
    >
      {!pngFailed ? (
        <img
          src={pngSrc}
          alt=""
          className="h-full w-full scale-[1.24] rounded-full object-cover"
          onError={() =>
            setPngFailed(true)
          }
        />
      ) : platform === "telegram" ? (
        <TelegramSourceIcon className="h-full w-full" />
      ) : (
        <MessengerSourceIcon className="h-full w-full" />
      )}
    </span>
  );
}

function getConversationPlatform(
  conversation: InboxConversation,
  channelDirectory: ChannelDirectory,
  channelDirectoryLoaded: boolean,
): ConversationPlatform | null {
  const socialAccountId =
    conversation.social_account
      ?.id;

  const registeredChannel =
    socialAccountId
      ? channelDirectory[
          socialAccountId
        ]
      : null;

  if (
    registeredChannel?.platform ===
    "telegram"
  ) {
    return "telegram";
  }

  if (
    registeredChannel?.platform ===
    "facebook"
  ) {
    return "messenger";
  }

  const extended =
    conversation as InboxConversation & {
      platform?: string | null;
      source_type?: string | null;
      social_account?:
        | (InboxConversation["social_account"] & {
            platform?: string | null;
          })
        | null;
    };

  const explicitPlatform =
    extended.platform
      ?.trim()
      .toLowerCase() ||
    extended.social_account
      ?.platform
      ?.trim()
      .toLowerCase() ||
    "";

  if (
    explicitPlatform ===
    "telegram"
  ) {
    return "telegram";
  }

  if (
    explicitPlatform ===
      "facebook" ||
    explicitPlatform ===
      "messenger"
  ) {
    return "messenger";
  }

  /*
   * Do not guess Messenger while /api/inbox/channels is still loading.
   * Telegram rows whose server payload does not include platform metadata
   * used to flash a Messenger badge during navigation/loading.
   */
  if (!channelDirectoryLoaded) {
    return null;
  }

  /*
   * Legacy TENH rows without platform metadata are historical Messenger
   * conversations. Use that fallback only after channel lookup finishes.
   */
  return "messenger";
}

function getConversationChannel(
  conversation:
    InboxConversation,
) {
  const sourceType =
    (
      conversation as
        InboxConversation & {
          source_type?:
            | string
            | null;
        }
    ).source_type;

  return sourceType ===
    "comment"
    ? "comment"
    : "messenger";
}

function isConversationPinned(
  conversation:
    InboxConversation,
) {
  return Boolean(
    (
      conversation as
        InboxConversation & {
          is_pinned?:
            boolean;
        }
    ).is_pinned,
  );
}

function getSavedViewFromKey(
  key: string,
  savedViews:
    SavedView[],
) {
  if (
    !key.startsWith(
      "saved:",
    )
  ) {
    return null;
  }

  const id =
    key.slice(
      "saved:".length,
    );

  return (
    savedViews.find(
      (view) =>
        view.id === id,
    ) ?? null
  );
}

function matchesSavedView({
  conversation,
  view,
  memberId,
}: {
  conversation:
    InboxConversation;
  view:
    SavedView;
  memberId:
    | string
    | null;
}) {
  const filters =
    view.filters;

  if (
    filters.status !==
      "any" &&
    conversation.status !==
      filters.status
  ) {
    return false;
  }

  if (
    filters.unreadOnly &&
    conversation.unread_count <=
      0
  ) {
    return false;
  }

  if (
    filters.pinnedOnly &&
    !isConversationPinned(
      conversation,
    )
  ) {
    return false;
  }

  if (
    filters.channel !==
      "any" &&
    getConversationChannel(
      conversation,
    ) !== filters.channel
  ) {
    return false;
  }

  if (
    filters.assignment ===
    "me"
  ) {
    if (
      !memberId ||
      conversation.assigned_to !==
        memberId
    ) {
      return false;
    }
  } else if (
    filters.assignment ===
    "assigned"
  ) {
    if (
      !conversation.assigned_to
    ) {
      return false;
    }
  } else if (
    filters.assignment ===
    "unassigned"
  ) {
    if (
      conversation.assigned_to
    ) {
      return false;
    }
  }

  if (
    filters.tagIds.length >
    0
  ) {
    const conversationTagIds =
      new Set(
        (
          conversation.contact
            ?.tags ?? []
        ).map(
          (tag) =>
            tag.id,
        ),
      );

    /*
     * Tag behavior = ANY selected tag.
     * Example: VIP + High Value means customer may have either tag.
     */
    const hasSelectedTag =
      filters.tagIds.some(
        (tagId) =>
          conversationTagIds.has(
            tagId,
          ),
      );

    if (!hasSelectedTag) {
      return false;
    }
  }

  return true;
}

function matchesView({
  conversation,
  key,
  savedViews,
  memberId,
}: {
  conversation:
    InboxConversation;
  key: string;
  savedViews:
    SavedView[];
  memberId:
    | string
    | null;
}) {
  if (
    key === "all"
  ) {
    return true;
  }

  if (
    key === "unread"
  ) {
    return (
      conversation.unread_count >
      0
    );
  }

  if (
    key === "my"
  ) {
    return Boolean(
      memberId &&
        conversation.assigned_to ===
          memberId,
    );
  }

  if (
    key ===
    "unassigned"
  ) {
    return !conversation.assigned_to;
  }

  if (
    key === "comment"
  ) {
    return (
      getConversationChannel(
        conversation,
      ) === "comment"
    );
  }

  if (
    key === "pinned"
  ) {
    return isConversationPinned(
      conversation,
    );
  }

  const savedView =
    getSavedViewFromKey(
      key,
      savedViews,
    );

  if (!savedView) {
    return true;
  }

  return matchesSavedView({
    conversation,
    view:
      savedView,
    memberId,
  });
}

function viewKeyFromUrl(
  value:
    | string
    | null,
) {
  if (
    value === "unread" ||
    value === "my" ||
    value ===
      "unassigned" ||
    value === "comment" ||
    value === "pinned"
  ) {
    return value;
  }

  if (
    value?.startsWith(
      "saved:",
    )
  ) {
    return value;
  }

  return "all";
}

export function ConversationList({
  conversations,
  activeConversationId,
  activeStatus,
  statusCounts,
  onSelectConversation,
  onPrefetchConversation,
  onClearConversationSelection,
}: ConversationListProps) {
  const router =
    useRouter();

  const searchParams =
    useSearchParams();

  /*
   * Generic V3.11.4 channel key.
   * `page` remains a read-only compatibility alias
   * for older Facebook Page Inbox links.
   */
  const selectedChannelId =
    searchParams.get("channel") ??
    searchParams.get("page");

  const [search, setSearch] =
    useState("");

  /*
   * V3.11.24.4 — restore the existing left-rail Follow-up / Reminder
   * workspace without touching the newer Smart Views/search implementation.
   */
  const [remindersOpen, setRemindersOpen] =
    useState(false);
  const [reminderCount, setReminderCount] =
    useState(0);
  const [reminderRefreshKey, setReminderRefreshKey] =
    useState(0);


  /*
   * V3.11.19 — fast Inbox search.
   * Keep typing responsive while filtering large conversation lists.
   * Search intentionally includes ONLY customer name, phone, and
   * Telegram username/identity. Email, message preview, and Messenger
   * platform identity are excluded by product decision.
   */
  const deferredSearch =
    useDeferredValue(search);

  // Hydration-safe localized timestamps.
  // The server and browser can resolve locale/timezone differently,
  // so render timestamps only after the client has mounted.
  const [hydrated, setHydrated] =
    useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReminderSummary() {
      try {
        const response = await fetch(
          "/api/reminders?summary=1",
          { cache: "no-store" },
        );
        const text = await response.text();
        const result = text.trim()
          ? (JSON.parse(text) as {
              success?: boolean;
              count?: number;
            })
          : null;

        if (
          !cancelled &&
          response.ok &&
          result?.success
        ) {
          setReminderCount(
            Math.max(0, result.count ?? 0),
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.warn(
            "Unable to load reminder summary:",
            error,
          );
        }
      }
    }

    function refreshReminders() {
      setReminderRefreshKey((current) =>
        current + 1,
      );
      void loadReminderSummary();
    }

    void loadReminderSummary();
    window.addEventListener(
      "tenh-reminder-changed",
      refreshReminders,
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        "tenh-reminder-changed",
        refreshReminders,
      );
    };
  }, []);

  const [
    channelDirectory,
    setChannelDirectory,
  ] = useState<ChannelDirectory>(
    () => cachedChannelDirectory,
  );
  const [
    channelDirectoryLoaded,
    setChannelDirectoryLoaded,
  ] = useState(
    () => cachedChannelDirectoryLoaded,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadChannelDirectory() {
      try {
        const response =
          await fetch(
            "/api/inbox/channels",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          (await response.json()) as
            ChannelsApiResponse;

        if (
          !response.ok ||
          !result.success ||
          cancelled
        ) {
          return;
        }

        const next:
          ChannelDirectory = {};

        for (
          const channel of
          result.channels ?? []
        ) {
          next[channel.id] = {
            platform:
              channel.platform,
            name:
              channel.name,
          };
        }

        cachedChannelDirectory = next;
        cachedChannelDirectoryLoaded = true;

        setChannelDirectory(
          next,
        );
      } catch {
        /*
         * Channel identity is visual only. Existing Inbox behavior should
         * continue even if this small lookup temporarily fails.
         */
      } finally {
        if (!cancelled) {
          setChannelDirectoryLoaded(
            true,
          );
        }
      }
    }

    void loadChannelDirectory();

    return () => {
      cancelled = true;
    };
  }, []);

  const [
    filterOpen,
    setFilterOpen,
  ] =
    useState(false);

  const [
    viewsOpen,
    setViewsOpen,
  ] =
    useState(false);

  const [
    viewsLoading,
    setViewsLoading,
  ] =
    useState(true);

  const [
    viewsError,
    setViewsError,
  ] =
    useState<
      string | null
    >(null);

  const [
    savedViews,
    setSavedViews,
  ] =
    useState<
      SavedView[]
    >([]);

  const [
    memberId,
    setMemberId,
  ] =
    useState<
      string | null
    >(null);

  const [
    editor,
    setEditor,
  ] =
    useState<
      ViewEditorState
      | null
    >(null);

  const [
    savingView,
    setSavingView,
  ] =
    useState(false);

  const [
    deletingViewId,
    setDeletingViewId,
  ] =
    useState<
      string | null
    >(null);

  const [
    viewActionMenuId,
    setViewActionMenuId,
  ] =
    useState<
      string | null
    >(null);

  const [
    selectedViewKey,
    setSelectedViewKey,
  ] =
    useState(
      () =>
        viewKeyFromUrl(
          searchParams.get(
            "view",
          ),
        ),
    );

  useEffect(() => {
    setSelectedViewKey(
      viewKeyFromUrl(
        searchParams.get(
          "view",
        ),
      ),
    );
  }, [
    searchParams,
  ]);

  useEffect(() => {
    let cancelled =
      false;

    async function loadViews() {
      setViewsLoading(
        true,
      );
      setViewsError(null);

      try {
        const response =
          await fetch(
            "/api/inbox/views",
            {
              cache:
                "no-store",
            },
          );

        const result =
          (await response.json()) as
            ViewsResponse;

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ??
              "Unable to load Smart Views.",
          );
        }

        if (cancelled) {
          return;
        }

        setMemberId(
          result.memberId ??
            null,
        );

        setSavedViews(
          result.views ??
            [],
        );
      } catch (
        error
      ) {
        if (cancelled) {
          return;
        }

        setViewsError(
          error instanceof
            Error
            ? error.message
            : "Unable to load Smart Views.",
        );
      } finally {
        if (!cancelled) {
          setViewsLoading(
            false,
          );
        }
      }
    }

    void loadViews();

    return () => {
      cancelled =
        true;
    };
  }, []);

  /*
   * V3.11.25 — InboxView may keep one selected conversation locally so the
   * center panel survives left-panel navigation. Scope list rows/counts back
   * to the active server filters before applying Smart Views/search.
   */
  const scopedConversations =
    useMemo(
      () =>
        conversations.filter((conversation) => {
          if (
            activeStatus !== "all" &&
            conversation.status !== activeStatus
          ) {
            return false;
          }

          if (selectedChannelId) {
            return (
              conversation.social_account?.id ===
              selectedChannelId
            );
          }

          return true;
        }),
      [
        activeStatus,
        conversations,
        selectedChannelId,
      ],
    );

  const allTags =
    useMemo(
      () => {
        const map =
          new Map<
            string,
            {
              id: string;
              name: string;
              color: string;
              count: number;
            }
          >();

        for (
          const conversation of
          scopedConversations
        ) {
          for (
            const tag of
            conversation.contact
              ?.tags ?? []
          ) {
            const existing =
              map.get(
                tag.id,
              );

            if (existing) {
              existing.count +=
                1;
            } else {
              map.set(
                tag.id,
                {
                  id:
                    tag.id,
                  name:
                    tag.name,
                  color:
                    tag.color,
                  count: 1,
                },
              );
            }
          }
        }

        return Array.from(
          map.values(),
        ).sort(
          (
            first,
            second,
          ) =>
            first.name.localeCompare(
              second.name,
            ),
        );
      },
      [scopedConversations],
    );

  const totalUnreadCount =
    useMemo(
      () =>
        scopedConversations.reduce(
          (
            total,
            conversation,
          ) =>
            total +
            Math.max(
              0,
              conversation.unread_count ??
                0,
            ),
          0,
        ),
      [scopedConversations],
    );

  const unreadConversationCount =
    useMemo(
      () =>
        scopedConversations.filter(
          (conversation) =>
            conversation.unread_count >
            0,
        ).length,
      [scopedConversations],
    );

  const baseViewConversations =
    useMemo(
      () =>
        scopedConversations.filter(
          (conversation) =>
            matchesView({
              conversation,
              key:
                selectedViewKey,
              savedViews,
              memberId,
            }),
        ),
      [
        scopedConversations,
        memberId,
        savedViews,
        selectedViewKey,
      ],
    );

  const conversationSearchIndex =
    useMemo(() => {
      const index = new Map<
        string,
        string
      >();

      for (
        const conversation of
          baseViewConversations
      ) {
        const name =
          conversation.contact
            ?.full_name
            ?.trim()
            .toLowerCase() ??
          "";

        const phone =
          conversation.contact
            ?.phone
            ?.trim()
            .toLowerCase() ??
          "";

        const platform =
          getConversationPlatform(
            conversation,
            channelDirectory,
            channelDirectoryLoaded,
          );

        const telegramIdentity =
          getTelegramSearchIdentity(
            conversation,
            platform,
          );

        index.set(
          conversation.id,
          `${name} ${phone} ${telegramIdentity}`.trim(),
        );
      }

      return index;
    }, [
      baseViewConversations,
      channelDirectory,
      channelDirectoryLoaded,
    ]);

  const filteredConversations =
    useMemo(() => {
      const keyword =
        deferredSearch
          .trim()
          .toLowerCase()
          .replace(/^@/, "");

      if (!keyword) {
        return baseViewConversations;
      }

      return baseViewConversations.filter(
        (conversation) =>
          conversationSearchIndex
            .get(
              conversation.id,
            )
            ?.includes(
              keyword,
            ) ?? false,
      );
    }, [
      baseViewConversations,
      conversationSearchIndex,
      deferredSearch,
    ]);

  const builtInCounts =
    useMemo(
      () => ({
        all:
          scopedConversations.length,

        unread:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key:
                  "unread",
                savedViews,
                memberId,
              }),
          ).length,

        my:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key:
                  "my",
                savedViews,
                memberId,
              }),
          ).length,

        unassigned:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key:
                  "unassigned",
                savedViews,
                memberId,
              }),
          ).length,

        comment:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key:
                  "comment",
                savedViews,
                memberId,
              }),
          ).length,

        pinned:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key:
                  "pinned",
                savedViews,
                memberId,
              }),
          ).length,
      }),
      [
        scopedConversations,
        memberId,
        savedViews,
      ],
    );

  const activeViewLabel =
    useMemo(() => {
      if (
        selectedViewKey ===
        "all"
      ) {
        return null;
      }

      const builtInLabels:
        Record<
          Exclude<
            BuiltInViewKey,
            "all"
          >,
          string
        > = {
          unread:
            "Unread",
          my:
            "My conversations",
          unassigned:
            "Unassigned",
          comment:
            "Facebook comments",
          pinned:
            "Pinned",
        };

      if (
        selectedViewKey in
        builtInLabels
      ) {
        return (
          builtInLabels[
            selectedViewKey as
              Exclude<
                BuiltInViewKey,
                "all"
              >
          ]
        );
      }

      return (
        getSavedViewFromKey(
          selectedViewKey,
          savedViews,
        )?.name ??
        "Smart View"
      );
    }, [
      savedViews,
      selectedViewKey,
    ]);

  function selectView(
    key: string,
  ) {
    setRemindersOpen(false);
    setSearch("");
    setViewsOpen(
      false,
    );
    setEditor(null);
    setViewActionMenuId(
      null,
    );
    setSelectedViewKey(
      key,
    );

    const query =
      new URLSearchParams();

    if (selectedChannelId) {
      query.set(
        "channel",
        selectedChannelId,
      );
    }

    if (
      key !== "all"
    ) {
      query.set(
        "view",
        key,
      );
    }

    const queryString =
      query.toString();

    router.push(
      queryString
        ? `/dashboard/inbox?${queryString}`
        : "/dashboard/inbox",
    );
  }

  function openCreateView() {
    setViewActionMenuId(
      null,
    );

    setEditor({
      id: null,
      name: "",
      filters: {
        ...EMPTY_FILTERS,
        tagIds: [],
      },
    });
  }

  function openEditView(
    view: SavedView,
  ) {
    setViewActionMenuId(
      null,
    );

    setEditor({
      id:
        view.id,
      name:
        view.name,
      filters: {
        ...EMPTY_FILTERS,
        ...view.filters,
        tagIds: [
          ...(
            view.filters
              ?.tagIds ??
            []
          ),
        ],
      },
    });
  }

  async function saveView() {
    if (!editor) {
      return;
    }

    const name =
      editor.name
        .trim()
        .replace(
          /\s+/g,
          " ",
        );

    if (!name) {
      setViewsError(
        "Enter a Smart View name.",
      );
      return;
    }

    setSavingView(
      true,
    );
    setViewsError(null);

    try {
      const isEditing =
        Boolean(
          editor.id,
        );

      const endpoint =
        isEditing
          ? `/api/inbox/views/${encodeURIComponent(
              editor.id as string,
            )}`
          : "/api/inbox/views";

      const response =
        await fetch(
          endpoint,
          {
            method:
              isEditing
                ? "PATCH"
                : "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  name,
                  filters:
                    editor.filters,
                },
              ),
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          view?:
            SavedView;
        };

      if (
        !response.ok ||
        !result.success ||
        !result.view
      ) {
        throw new Error(
          result.error ??
            "Unable to save Smart View.",
        );
      }

      setSavedViews(
        (current) => {
          if (isEditing) {
            return current.map(
              (view) =>
                view.id ===
                result.view?.id
                  ? (result.view as
                      SavedView)
                  : view,
            );
          }

          return [
            ...current,
            result.view as
              SavedView,
          ];
        },
      );

      const nextKey =
        `saved:${result.view.id}`;

      setEditor(null);
      selectView(
        nextKey,
      );
    } catch (
      error
    ) {
      setViewsError(
        error instanceof
          Error
          ? error.message
          : "Unable to save Smart View.",
      );
    } finally {
      setSavingView(
        false,
      );
    }
  }

  async function deleteView(
    view: SavedView,
  ) {
    const confirmed =
      window.confirm(
        `Delete Smart View "${view.name}"?`,
      );

    if (!confirmed) {
      return;
    }

    setDeletingViewId(
      view.id,
    );
    setViewsError(null);

    try {
      const response =
        await fetch(
          `/api/inbox/views/${encodeURIComponent(
            view.id,
          )}`,
          {
            method:
              "DELETE",
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
        };

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to delete Smart View.",
        );
      }

      setSavedViews(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              view.id,
          ),
      );

      setViewActionMenuId(
        null,
      );

      if (
        selectedViewKey ===
        `saved:${view.id}`
      ) {
        selectView(
          "all",
        );
      }
    } catch (
      error
    ) {
      setViewsError(
        error instanceof
          Error
          ? error.message
          : "Unable to delete Smart View.",
      );
    } finally {
      setDeletingViewId(
        null,
      );
    }
  }

  const railViews: Array<{
    value:
      BuiltInViewKey;
    label: string;
    count: number;
    icon:
      React.ReactNode;
  }> = [
    {
      value: "all",
      label:
        "All conversations",
      count:
        builtInCounts.all,
      icon:
        <AllConversationIcon />,
    },
    {
      value:
        "unread",
      label:
        "Unread",
      count:
        builtInCounts.unread,
      icon:
        <UnreadIcon />,
    },
    {
      value: "my",
      label:
        "My conversations",
      count:
        builtInCounts.my,
      icon:
        <AssignedToMeIcon />,
    },
    {
      value:
        "unassigned",
      label:
        "Unassigned",
      count:
        builtInCounts.unassigned,
      icon:
        <UnassignedIcon />,
    },
    {
      value:
        "comment",
      label:
        "Facebook comments",
      count:
        builtInCounts.comment,
      icon:
        <CommentIcon />,
    },
    {
      value:
        "pinned",
      label:
        "Pinned",
      count:
        builtInCounts.pinned,
      icon:
        <PinIcon />,
    },
  ];

  return (
    <section className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden border-r border-slate-200 bg-white">
      <aside className="relative z-30 flex h-full w-16 shrink-0 flex-col overflow-visible border-r border-slate-200 bg-slate-50 py-3">
        {railViews.map(
          (view) => {
            const isActive =
              selectedViewKey ===
              view.value &&
              activeStatus ===
                "all";

            return (
              <button
                key={
                  view.value
                }
                type="button"
                onClick={() =>
                  selectView(
                    view.value,
                  )
                }
                className={`group relative mx-2 mb-1 flex h-12 shrink-0 items-center justify-center rounded-xl transition ${
                  isActive
                    ? "bg-blue-100 text-blue-700"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
                aria-label={
                  view.label
                }
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  {
                    view.icon
                  }
                </span>

                {view.value ===
                  "unread" &&
                totalUnreadCount >
                  0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                    {totalUnreadCount >
                    99
                      ? "99+"
                      : totalUnreadCount}
                  </span>
                ) : null}

                <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
                  {
                    view.label
                  }
                  {view.value ===
                    "unread" &&
                  totalUnreadCount >
                    0
                    ? ` · ${totalUnreadCount} message${
                        totalUnreadCount ===
                        1
                          ? ""
                          : "s"
                      } in ${unreadConversationCount} chat${
                        unreadConversationCount ===
                        1
                          ? ""
                          : "s"
                      }`
                    : ` · ${view.count}`}

                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
                </span>
              </button>
            );
          },
        )}

        <button
          type="button"
          onClick={() => {
            setFilterOpen(false);
            setViewsOpen(false);
            setEditor(null);
            setViewActionMenuId(null);
            setRemindersOpen(true);
            /*
             * Keep the current center conversation while opening reminders.
             * Only an explicit conversation click changes the active thread.
             */
          }}
          className={`group relative mx-2 mb-1 flex h-12 shrink-0 items-center justify-center rounded-xl transition ${
            remindersOpen
              ? "bg-amber-100 text-amber-700"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`}
          aria-label="Follow-up / Reminders"
          title="Follow-up / Reminders"
        >
          <ReminderIcon />

          {reminderCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-amber-500 px-1 text-[10px] font-bold leading-none text-white">
              {reminderCount > 99
                ? "99+"
                : reminderCount}
            </span>
          ) : null}

          <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
            Follow-up / Reminders
            {reminderCount > 0
              ? ` · ${reminderCount}`
              : ""}
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
          </span>
        </button>

        <div className="mx-2 my-2 h-px bg-slate-200" />

        <button
          type="button"
          onClick={() => {
            setRemindersOpen(false);
            setFilterOpen(
              false,
            );
            setViewsOpen(
              (current) =>
                !current,
            );
            setEditor(null);
            setViewActionMenuId(
              null,
            );
          }}
          className={`group relative mx-2 mb-1 flex h-12 shrink-0 items-center justify-center rounded-xl transition ${
            viewsOpen ||
            selectedViewKey.startsWith(
              "saved:",
            )
              ? "bg-violet-100 text-violet-700"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`}
          aria-label="Smart Views"
        >
          <ViewsIcon />

          {savedViews.length >
          0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-violet-600 px-1 text-[10px] font-bold leading-none text-white">
              {savedViews.length >
              9
                ? "9+"
                : savedViews.length}
            </span>
          ) : null}

          <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
            Smart Views
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
          </span>
        </button>
      </aside>

      {viewsOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => {
              setViewsOpen(
                false,
              );
              setEditor(
                null,
              );
              setViewActionMenuId(
                null,
              );
            }}
            aria-label="Close Smart Views"
          />

          <section className="absolute left-16 top-3 z-40 flex max-h-[calc(100%-24px)] w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">
                  Smart Views
                </h2>

                <p className="mt-0.5 text-xs text-slate-500">
                  Personal saved Inbox filters
                </p>
              </div>

              {!editor ? (
                <button
                  type="button"
                  onClick={
                    openCreateView
                  }
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  <PlusIcon />
                  New view
                </button>
              ) : null}
            </div>

            {viewsError ? (
              <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {
                  viewsError
                }
              </div>
            ) : null}

            {editor ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">
                    {editor.id
                      ? "Edit Smart View"
                      : "Create Smart View"}
                  </h3>

                  <button
                    type="button"
                    onClick={() =>
                      setEditor(
                        null,
                      )
                    }
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-600">
                    View name
                  </span>

                  <input
                    value={
                      editor.name
                    }
                    maxLength={
                      40
                    }
                    onChange={(
                      event,
                    ) =>
                      setEditor(
                        (
                          current,
                        ) =>
                          current
                            ? {
                                ...current,
                                name:
                                  event.target.value,
                              }
                            : current,
                      )
                    }
                    placeholder="Example: VIP Unread"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label>
                    <span className="text-xs font-semibold text-slate-600">
                      Status
                    </span>

                    <select
                      value={
                        editor.filters.status
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditor(
                          (
                            current,
                          ) =>
                            current
                              ? {
                                  ...current,
                                  filters: {
                                    ...current.filters,
                                    status:
                                      event.target.value as
                                        SavedViewFilters["status"],
                                  },
                                }
                              : current,
                        )
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="any">
                        Any status
                      </option>
                      <option value="open">
                        Open
                      </option>
                      <option value="pending">
                        Pending
                      </option>
                      <option value="resolved">
                        Resolved
                      </option>
                      <option value="closed">
                        Closed
                      </option>
                      <option value="spam">
                        Spam
                      </option>
                    </select>
                  </label>

                  <label>
                    <span className="text-xs font-semibold text-slate-600">
                      Assignment
                    </span>

                    <select
                      value={
                        editor.filters.assignment
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditor(
                          (
                            current,
                          ) =>
                            current
                              ? {
                                  ...current,
                                  filters: {
                                    ...current.filters,
                                    assignment:
                                      event.target.value as
                                        SavedViewFilters["assignment"],
                                  },
                                }
                              : current,
                        )
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="any">
                        Anyone
                      </option>
                      <option value="me">
                        Assigned to me
                      </option>
                      <option value="assigned">
                        Any assigned
                      </option>
                      <option value="unassigned">
                        Unassigned
                      </option>
                    </select>
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-600">
                    Channel
                  </span>

                  <select
                    value={
                      editor.filters.channel
                    }
                    onChange={(
                      event,
                    ) =>
                      setEditor(
                        (
                          current,
                        ) =>
                          current
                            ? {
                                ...current,
                                filters: {
                                  ...current.filters,
                                  channel:
                                    event.target.value as
                                      SavedViewFilters["channel"],
                                },
                              }
                            : current,
                      )
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="any">
                      Any channel
                    </option>
                    <option value="messenger">
                      Messenger
                    </option>
                    <option value="comment">
                      Facebook comments
                    </option>
                  </select>
                </label>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={
                        editor.filters.unreadOnly
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditor(
                          (
                            current,
                          ) =>
                            current
                              ? {
                                  ...current,
                                  filters: {
                                    ...current.filters,
                                    unreadOnly:
                                      event.target.checked,
                                  },
                                }
                              : current,
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />

                    <span className="text-xs font-semibold text-slate-700">
                      Unread only
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={
                        editor.filters.pinnedOnly
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditor(
                          (
                            current,
                          ) =>
                            current
                              ? {
                                  ...current,
                                  filters: {
                                    ...current.filters,
                                    pinnedOnly:
                                      event.target.checked,
                                  },
                                }
                              : current,
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />

                    <span className="text-xs font-semibold text-slate-700">
                      Pinned only
                    </span>
                  </label>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-600">
                      Customer tags
                    </span>

                    {editor.filters.tagIds.length >
                    0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditor(
                            (
                              current,
                            ) =>
                              current
                                ? {
                                    ...current,
                                    filters: {
                                      ...current.filters,
                                      tagIds:
                                        [],
                                    },
                                  }
                                : current,
                          )
                        }
                        className="text-[11px] font-semibold text-blue-600"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  {allTags.length ===
                  0 ? (
                    <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                      No customer tags are available in the current Inbox data.
                    </div>
                  ) : (
                    <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 p-2">
                      {allTags.map(
                        (
                          tag,
                        ) => {
                          const checked =
                            editor.filters.tagIds.includes(
                              tag.id,
                            );

                          return (
                            <label
                              key={
                                tag.id
                              }
                              className={`mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                                checked
                                  ? "bg-blue-50"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  checked
                                }
                                onChange={() =>
                                  setEditor(
                                    (
                                      current,
                                    ) => {
                                      if (
                                        !current
                                      ) {
                                        return current;
                                      }

                                      const currentIds =
                                        current.filters.tagIds;

                                      return {
                                        ...current,
                                        filters: {
                                          ...current.filters,
                                          tagIds:
                                            currentIds.includes(
                                              tag.id,
                                            )
                                              ? currentIds.filter(
                                                  (
                                                    id,
                                                  ) =>
                                                    id !==
                                                    tag.id,
                                                )
                                              : [
                                                  ...currentIds,
                                                  tag.id,
                                                ],
                                        },
                                      };
                                    },
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />

                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    tag.color,
                                }}
                              />

                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                                {
                                  tag.name
                                }
                              </span>

                              <span className="text-[10px] text-slate-400">
                                {
                                  tag.count
                                }
                              </span>
                            </label>
                          );
                        },
                      )}
                    </div>
                  )}

                  <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                    Selecting multiple tags uses OR matching: a customer may have any selected tag.
                  </p>
                </div>

                <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() =>
                      setEditor(
                        null,
                      )
                    }
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void saveView()
                    }
                    disabled={
                      savingView
                    }
                    className="flex-1 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-300"
                  >
                    {savingView
                      ? "Saving..."
                      : editor.id
                        ? "Save changes"
                        : "Create view"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {viewsLoading ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading Smart Views...
                  </div>
                ) : savedViews.length ===
                  0 ? (
                  <div className="px-5 py-10 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                      <ViewsIcon />
                    </div>

                    <p className="mt-3 font-semibold text-slate-800">
                      No custom views yet
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Save combinations such as VIP + Unread, My Open Conversations, or Unassigned Messenger.
                    </p>

                    <button
                      type="button"
                      onClick={
                        openCreateView
                      }
                      className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Create first view
                    </button>
                  </div>
                ) : (
                  savedViews.map(
                    (
                      view,
                    ) => {
                      const key =
                        `saved:${view.id}`;

                      const isActive =
                        selectedViewKey ===
                        key;

                      const count =
                        conversations.filter(
                          (
                            conversation,
                          ) =>
                            matchesSavedView({
                              conversation,
                              view,
                              memberId,
                            }),
                        ).length;

                      return (
                        <div
                          key={
                            view.id
                          }
                          className="relative mb-1 flex items-center gap-1"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              selectView(
                                key,
                              )
                            }
                            className={`min-w-0 flex-1 rounded-xl px-3 py-3 text-left transition ${
                              isActive
                                ? "bg-violet-50 text-violet-800"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">
                                  {
                                    view.name
                                  }
                                </span>

                                <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                                  Personal Smart View
                                </span>
                              </span>

                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {
                                  count
                                }
                              </span>
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setViewActionMenuId(
                                (
                                  current,
                                ) =>
                                  current ===
                                  view.id
                                    ? null
                                    : view.id,
                              )
                            }
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Manage ${view.name}`}
                          >
                            <MoreIcon />
                          </button>

                          {viewActionMenuId ===
                          view.id ? (
                            <div className="absolute right-0 top-10 z-20 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                              <button
                                type="button"
                                onClick={() =>
                                  openEditView(
                                    view,
                                  )
                                }
                                className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Edit view
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  void deleteView(
                                    view,
                                  )
                                }
                                disabled={
                                  deletingViewId ===
                                  view.id
                                }
                                className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {deletingViewId ===
                                view.id
                                  ? "Deleting..."
                                  : "Delete view"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  )
                )}
              </div>
            )}
          </section>
        </>
      ) : null}

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {remindersOpen ? (
          <ReminderListPanel
            refreshKey={reminderRefreshKey}
            onChanged={() => {
              window.dispatchEvent(
                new CustomEvent(
                  "tenh-reminder-changed",
                ),
              );
            }}
          />
        ) : (
          <>
        <InboxChannelSelector />

        <div className="relative shrink-0 border-b border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                  />
                  <path
                    d="m20 20-3.5-3.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>

              <input
                type="search"
                placeholder="Search name, phone or Telegram username..."
                value={
                  search
                }
                onChange={(
                  event,
                ) =>
                  setSearch(
                    event.target.value,
                  )
                }
                className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-[12px] placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {totalUnreadCount >
            0 ? (
              <button
                type="button"
                onClick={() =>
                  selectView(
                    "unread",
                  )
                }
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                title={`${totalUnreadCount} unread messages`}
              >
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                <span>
                  {totalUnreadCount >
                  99
                    ? "99+"
                    : totalUnreadCount}
                </span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setViewsOpen(
                  false,
                );
                setFilterOpen(
                  (
                    current,
                  ) =>
                    !current,
                );
              }}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${
                filterOpen ||
                activeStatus !==
                  "all"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              aria-label="Filter by status"
              aria-expanded={
                filterOpen
              }
            >
              <FilterIcon />

              {activeStatus !==
              "all" ? (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" />
              ) : null}
            </button>
          </div>

          {filterOpen ? (
            <>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() =>
                  setFilterOpen(
                    false,
                  )
                }
                className="fixed inset-0 z-30 cursor-default"
              />

              <div className="absolute right-3 top-[64px] z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    Filter by status
                  </p>

                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Status filters stay compatible with your existing Inbox URLs.
                  </p>
                </div>

                <div className="p-2">
                  {filterOptions.map(
                    (
                      filter,
                    ) => {
                      const isActive =
                        filter.value ===
                        activeStatus;

                      const statusQuery =
                        new URLSearchParams();

                      if (
                        selectedChannelId
                      ) {
                        statusQuery.set(
                          "channel",
                          selectedChannelId,
                        );
                      }

                      if (
                        filter.value !==
                        "all"
                      ) {
                        statusQuery.set(
                          "status",
                          filter.value,
                        );
                      }

                      const statusQueryString =
                        statusQuery.toString();

                      const href =
                        statusQueryString
                          ? `/dashboard/inbox?${statusQueryString}`
                          : "/dashboard/inbox";

                      return (
                        <Link
                          key={
                            filter.value
                          }
                          href={
                            href
                          }
                          onClick={() => {
                            setFilterOpen(
                              false,
                            );
                          }}
                          className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition ${
                            isActive
                              ? "bg-blue-50 font-semibold text-blue-700"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                filter.value ===
                                "all"
                                  ? "bg-slate-700"
                                  : filter.value ===
                                      "open"
                                    ? "bg-emerald-500"
                                    : filter.value ===
                                        "pending"
                                      ? "bg-amber-500"
                                      : filter.value ===
                                          "resolved"
                                        ? "bg-blue-500"
                                        : filter.value ===
                                            "closed"
                                          ? "bg-slate-400"
                                          : "bg-red-500"
                              }`}
                            />

                            {
                              filter.label
                            }
                          </span>

                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              isActive
                                ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {
                              statusCounts[
                                filter.value
                              ]
                            }
                          </span>
                        </Link>
                      );
                    },
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {activeStatus !==
        "all" ? (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Showing:
              </span>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                    activeStatus,
                  )}`}
                >
                  {getStatusLabel(
                    activeStatus,
                  )}
                </span>

                <Link
                  href={
                    selectedChannelId
                      ? `/dashboard/inbox?channel=${encodeURIComponent(
                          selectedChannelId,
                        )}`
                      : "/dashboard/inbox"
                  }
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Clear
                </Link>
              </div>
            </div>
          </div>
        ) : activeViewLabel ? (
          <div className="shrink-0 border-b border-violet-100 bg-violet-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-xs font-semibold text-violet-700">
                {
                  activeViewLabel
                }{" "}
                ·{" "}
                {
                  baseViewConversations.length
                }
              </span>

              <button
                type="button"
                onClick={() =>
                  selectView(
                    "all",
                  )
                }
                className="shrink-0 text-xs font-semibold text-violet-700 hover:underline"
              >
                Clear view
              </button>
            </div>
          </div>
        ) : null}


        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {filteredConversations.length ===
          0 ? (
            <div className="p-8 text-center">
              <p className="font-medium text-slate-800">
                No conversations found
              </p>

              <p className="mt-1 text-sm text-slate-500">
                {search.trim()
                  ? "No customer matches this search inside the selected view."
                  : activeViewLabel
                    ? "No conversations match this Smart View."
                    : "No conversations match this filter."}
              </p>
            </div>
          ) : (
            filteredConversations.map(
              (
                conversation,
              ) => {
                const customerName =
                  conversation.contact
                    ?.full_name ??
                  "Customer";

                const customerAvatarUrl =
                  conversation.contact
                    ?.profile_picture_url
                    ?.trim() ||
                  null;

                const isActive =
                  conversation.id ===
                  activeConversationId;

                const conversationPlatform =
                  getConversationPlatform(
                    conversation,
                    channelDirectory,
                    channelDirectoryLoaded,
                  );

                return (
                  <button
                    key={
                      conversation.id
                    }
                    type="button"
                    onClick={() => {
                      onSelectConversation(
                        conversation.id,
                      );
                    }}
                    onMouseEnter={() =>
                      onPrefetchConversation?.(
                        conversation.id,
                      )
                    }
                    onFocus={() =>
                      onPrefetchConversation?.(
                        conversation.id,
                      )
                    }
                    className={`mx-2 my-1 flex min-h-[104px] w-[calc(100%-1rem)] items-center gap-3 rounded-xl border-2 border-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition ${
                      isActive
                        ? "bg-blue-100 ring-1 ring-blue-100"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >

                    <div className="relative h-12 w-12 shrink-0">
                      {customerAvatarUrl ? (
                        <img
                          src={
                            customerAvatarUrl
                          }
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-12 w-12 rounded-full bg-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                          {getInitial(
                            customerName,
                          )}
                        </div>
                      )}

                      {conversationPlatform ? (
                        <ChannelAvatarBadge
                          platform={
                            conversationPlatform
                          }
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">
                          {
                            customerName
                          }
                        </p>

                        <span className="shrink-0 text-xs text-slate-400">
                          {hydrated
                            ? formatMessageTime(
                                conversation.last_message_at,
                              )
                            : ""}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
                          {conversation.last_message_text ??
                            "No messages"}
                        </p>

                        {conversation.unread_count >
                        0 ? (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                            {
                              conversation.unread_count
                            }
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {getConversationChannel(
                          conversation,
                        ) ===
                        "comment" ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            Comment
                          </span>
                        ) : null}

                        {isConversationPinned(
                          conversation,
                        ) ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Pinned
                          </span>
                        ) : null}

                        {(conversation.contact
                          ?.tags ??
                          [])
                          .slice(
                            0,
                            2,
                          )
                          .map(
                            (
                              tag,
                            ) => (
                              <span
                                key={
                                  tag.id
                                }
                                className="max-w-28 truncate rounded-full px-2 py-0.5 text-xs font-medium text-white"
                                style={{
                                  backgroundColor:
                                    tag.color,
                                }}
                              >
                                {
                                  tag.name
                                }
                              </span>
                            ),
                          )}

                        {(conversation.contact
                          ?.tags?.length ??
                          0) >
                        2 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            +
                            {(conversation
                              .contact
                              ?.tags
                              ?.length ??
                              0) -
                              2}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              },
            )
          )}
        </div>
          </>
        )}
      </div>
    </section>
  );
}
