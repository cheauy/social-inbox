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
  useRef,
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
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  normalizeLegacyConversationPreview,
} from "@/lib/inbox/conversation-preview";
import { CONVERSATION_TEXT_FONT_STACK } from "@/lib/display/workspace-fonts";

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
  | "open"
  | "pinned";

type WorkspaceScope =
  | "all"
  | "current"
  | "selected";

type SavedViewFilters = {
  workspaceScope: WorkspaceScope;
  workspaceIds: string[];
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
    | "comment"
    | "telegram";
  unreadOnly: boolean;
  pinnedOnly: boolean;
  /*
   * New rows store `${workspaceId}::${tagId}` so the same label can safely
   * exist in more than one workspace. Legacy plain tag IDs remain readable.
   */
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
  businessId?: string;
  memberId?: string;
  views?: SavedView[];
};

type SmartViewWorkspaceOption = {
  businessId: string;
  businessName: string;
  memberId: string;
};

type SmartViewTagOption = {
  id: string;
  businessId: string;
  name: string;
  color: string;
  count: number;
};

type SmartViewOptionsResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: SmartViewWorkspaceOption[];
  tags?: SmartViewTagOption[];
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
    workspaceScope: "all",
    workspaceIds: [],
    status: "any",
    assignment: "any",
    channel: "any",
    unreadOnly: false,
    pinnedOnly: false,
    tagIds: [],
  };

const SMART_VIEW_TAG_SEPARATOR = "::";

function makeSmartViewTagReference(
  workspaceId: string,
  tagId: string,
) {
  return `${workspaceId}${SMART_VIEW_TAG_SEPARATOR}${tagId}`;
}

function parseSmartViewTagReference(
  value: string,
) {
  const separatorIndex = value.indexOf(
    SMART_VIEW_TAG_SEPARATOR,
  );

  if (separatorIndex <= 0) {
    return null;
  }

  const workspaceId = value
    .slice(0, separatorIndex)
    .trim();
  const tagId = value
    .slice(separatorIndex + SMART_VIEW_TAG_SEPARATOR.length)
    .trim();

  if (!workspaceId || !tagId) {
    return null;
  }

  return { workspaceId, tagId };
}

const DEFAULT_SMART_VIEW_ORDER_IDS = [
  "default:my",
  "default:unassigned",
  "default:comment",
  "default:open",
] as const;

function normalizeSmartViewOrder(
  stored: unknown,
  availableIds: string[],
) {
  const available = new Set(availableIds);
  const seen = new Set<string>();
  const next: string[] = [];

  if (Array.isArray(stored)) {
    for (const value of stored) {
      if (
        typeof value === "string" &&
        available.has(value) &&
        !seen.has(value)
      ) {
        seen.add(value);
        next.push(value);
      }
    }
  }

  for (const value of availableIds) {
    if (!seen.has(value)) {
      seen.add(value);
      next.push(value);
    }
  }

  return next;
}

/*
 * Smart Views have existed across several TENH Inbox versions. Keep old saved
 * JSON rows usable instead of silently turning a saved filter into zero
 * matches when one of the historical key names is present. New saves continue
 * to use the current camelCase shape.
 */
function normalizeSavedViewFilters(
  value: unknown,
): SavedViewFilters {
  const record =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const workspaceScope =
    typeof record.workspaceScope === "string" &&
    ["all", "current", "selected"].includes(record.workspaceScope)
      ? (record.workspaceScope as WorkspaceScope)
      : typeof record.workspace_scope === "string" &&
          ["all", "current", "selected"].includes(record.workspace_scope)
        ? (record.workspace_scope as WorkspaceScope)
        : "all";

  const rawWorkspaceIds =
    record.workspaceIds ??
    record.workspace_ids ??
    record.businessIds ??
    record.business_ids;

  const workspaceIds = Array.isArray(rawWorkspaceIds)
    ? Array.from(
        new Set(
          rawWorkspaceIds
            .filter(
              (workspaceId): workspaceId is string =>
                typeof workspaceId === "string" &&
                workspaceId.trim().length > 0,
            )
            .map((workspaceId) => workspaceId.trim()),
        ),
      ).slice(0, 30)
    : [];

  const status =
    typeof record.status === "string" &&
    [
      "any",
      "open",
      "pending",
      "resolved",
      "closed",
      "spam",
    ].includes(record.status)
      ? (record.status as SavedViewFilters["status"])
      : "any";

  const assignment =
    typeof record.assignment === "string" &&
    [
      "any",
      "me",
      "assigned",
      "unassigned",
    ].includes(record.assignment)
      ? (record.assignment as SavedViewFilters["assignment"])
      : "any";

  const channel =
    typeof record.channel === "string" &&
    ["any", "messenger", "comment", "telegram"].includes(record.channel)
      ? (record.channel as SavedViewFilters["channel"])
      : "any";

  const rawTagIds =
    record.tagIds ??
    record.tag_ids ??
    record.tags;

  const tagIds = Array.isArray(rawTagIds)
    ? Array.from(
        new Set(
          rawTagIds
            .filter(
              (tagId): tagId is string =>
                typeof tagId === "string" &&
                tagId.trim().length > 0,
            )
            .map((tagId) => tagId.trim()),
        ),
      ).slice(0, 20)
    : [];

  return {
    workspaceScope,
    workspaceIds,
    status,
    assignment,
    channel,
    unreadOnly:
      record.unreadOnly === true ||
      record.unread_only === true,
    pinnedOnly:
      record.pinnedOnly === true ||
      record.pinned_only === true,
    tagIds,
  };
}

function normalizeSavedView(
  view: SavedView,
): SavedView {
  return {
    ...view,
    filters: normalizeSavedViewFilters(view.filters),
  };
}

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
      strokeWidth="1.9"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M9 4h6"
        strokeLinecap="round"
      />
      <path
        d="M10 4 9.25 9.7 7 12v1.5h10V12l-2.25-2.3L14 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 13.5V21"
        strokeLinecap="round"
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
  businessId: string;
  subscriptionId: string | null;
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
    businessId: string;
    subscriptionId: string | null;
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
      className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-full border-2 border-white shadow-[0_1px_3px_rgba(15,23,42,0.20)] ${
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
  conversation: InboxConversation,
  channelDirectory?: ChannelDirectory,
) {
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

  const sourceType =
    extended.source_type
      ?.trim()
      .toLowerCase() || "";

  if (sourceType === "comment") {
    return "comment" as const;
  }

  const socialAccountId =
    conversation.social_account?.id;
  const registeredPlatform =
    socialAccountId && channelDirectory
      ? channelDirectory[socialAccountId]?.platform
      : null;

  if (registeredPlatform === "telegram") {
    return "telegram" as const;
  }

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
    sourceType === "telegram" ||
    explicitPlatform === "telegram"
  ) {
    return "telegram" as const;
  }

  return "messenger" as const;
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
  memberIdByBusiness,
  workspaceContextId,
  channelDirectory,
}: {
  conversation:
    InboxConversation;
  view:
    SavedView;
  memberId:
    | string
    | null;
  memberIdByBusiness?: Record<string, string>;
  workspaceContextId?: string | null;
  channelDirectory?: ChannelDirectory;
}) {
  const filters =
    normalizeSavedViewFilters(
      view.filters,
    );

  if (
    filters.workspaceScope === "current"
  ) {
    if (
      !workspaceContextId ||
      conversation.business_id !== workspaceContextId
    ) {
      return false;
    }
  } else if (
    filters.workspaceScope === "selected"
  ) {
    if (
      filters.workspaceIds.length === 0 ||
      !filters.workspaceIds.includes(
        conversation.business_id,
      )
    ) {
      return false;
    }
  }

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
      channelDirectory,
    ) !== filters.channel
  ) {
    return false;
  }

  if (
    filters.assignment ===
    "me"
  ) {
    const workspaceMemberId =
      memberIdByBusiness?.[
        conversation.business_id
      ] ?? memberId;

    if (
      !workspaceMemberId ||
      conversation.assigned_to !==
        workspaceMemberId
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
    const conversationTags =
      conversation.contact
        ?.tags ?? [];

    const conversationTagIds =
      new Set(
        conversationTags.map(
          (tag) => tag.id,
        ),
      );

    const conversationTagNames =
      new Set(
        conversationTags.map(
          (tag) =>
            tag.name
              .trim()
              .toLowerCase(),
        ),
      );

    const allowLegacyNameFallback =
      filters.workspaceScope === "current" ||
      (filters.workspaceScope === "selected" &&
        filters.workspaceIds.length === 1);

    /*
     * New references are workspace-scoped (`businessId::tagId`) so identical
     * tag names across subscriptions can never collide. Plain UUID/tag IDs
     * from older TENH Smart Views remain valid. The historical tag-name
     * fallback is intentionally limited to a single workspace because a
     * label like "VIP" is ambiguous across multiple businesses.
     */
    const hasSelectedTag =
      filters.tagIds.some(
        (tagReference) => {
          const scopedReference =
            parseSmartViewTagReference(
              tagReference,
            );

          if (scopedReference) {
            return (
              conversation.business_id ===
                scopedReference.workspaceId &&
              conversationTagIds.has(
                scopedReference.tagId,
              )
            );
          }

          if (
            conversationTagIds.has(
              tagReference,
            )
          ) {
            return true;
          }

          return (
            allowLegacyNameFallback &&
            conversationTagNames.has(
              tagReference
                .trim()
                .toLowerCase(),
            )
          );
        },
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
  memberIdByBusiness,
  workspaceContextId,
  channelDirectory,
}: {
  conversation:
    InboxConversation;
  key: string;
  savedViews:
    SavedView[];
  memberId:
    | string
    | null;
  memberIdByBusiness?: Record<string, string>;
  workspaceContextId?: string | null;
  channelDirectory?: ChannelDirectory;
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
    const workspaceMemberId =
      memberIdByBusiness?.[
        conversation.business_id
      ] ?? memberId;

    return Boolean(
      workspaceMemberId &&
        conversation.assigned_to ===
          workspaceMemberId,
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
        channelDirectory,
      ) === "comment"
    );
  }

  if (
    key === "open"
  ) {
    return conversation.status === "open";
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
    memberIdByBusiness,
    workspaceContextId,
    channelDirectory,
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
    value === "open" ||
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

  const isKhmer = useWorkspaceLanguageId() === "km";

  /*
   * Generic V3.11.4 channel key.
   * `page` remains a read-only compatibility alias
   * for older Facebook Page Inbox links.
   */
  const selectedChannelId =
    searchParams.get("channel") ??
    searchParams.get("page");

  const selectedWorkspaceId =
    searchParams.get("workspace");

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
  // Keep the reminder workflow active, but do not show its old left-rail icon.
  const showReminderRailShortcut = false;


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
            businessId:
              channel.businessId,
            subscriptionId:
              channel.subscriptionId,
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
    currentBusinessId,
    setCurrentBusinessId,
  ] = useState<string | null>(null);

  const [
    smartViewWorkspaces,
    setSmartViewWorkspaces,
  ] = useState<SmartViewWorkspaceOption[]>([]);

  const [
    smartViewTags,
    setSmartViewTags,
  ] = useState<SmartViewTagOption[]>([]);

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
    deleteViewTarget,
    setDeleteViewTarget,
  ] =
    useState<
      SavedView | null
    >(null);

  const [
    viewActionMenuId,
    setViewActionMenuId,
  ] =
    useState<
      string | null
    >(null);

  const [
    smartViewOrder,
    setSmartViewOrder,
  ] = useState<string[]>([
    ...DEFAULT_SMART_VIEW_ORDER_IDS,
  ]);

  const [
    draggingSmartViewId,
    setDraggingSmartViewId,
  ] = useState<string | null>(null);

  const smartViewOrderRef = useRef<string[]>([
    ...DEFAULT_SMART_VIEW_ORDER_IDS,
  ]);

  const draggingSmartViewIdRef = useRef<string | null>(null);

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
    let cancelled = false;

    async function loadSmartViewOptions() {
      try {
        const response = await fetch(
          "/api/inbox/smart-view-options",
          { cache: "no-store" },
        );

        const result =
          (await response.json()) as SmartViewOptionsResponse;

        if (
          cancelled ||
          !response.ok ||
          !result.success
        ) {
          return;
        }

        setCurrentBusinessId(
          result.currentBusinessId ?? null,
        );
        setSmartViewWorkspaces(
          result.workspaces ?? [],
        );
        setSmartViewTags(
          result.tags ?? [],
        );
      } catch {
        /*
         * Smart View filtering still works from the conversations already in
         * the Inbox. This lookup only supplies the complete cross-workspace
         * workspace/tag directory for the editor.
         */
      }
    }

    void loadSmartViewOptions();

    return () => {
      cancelled = true;
    };
  }, []);

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

        setCurrentBusinessId((current) =>
          current ?? result.businessId ?? null,
        );

        setSavedViews(
          (result.views ?? []).map(
            normalizeSavedView,
          ),
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

  const availableSmartViewOrderIds =
    useMemo(
      () => [
        ...DEFAULT_SMART_VIEW_ORDER_IDS,
        ...savedViews.map(
          (view) => `saved:${view.id}`,
        ),
      ],
      [savedViews],
    );

  const smartViewOrderIdentity =
    useMemo(() => {
      const memberIds = smartViewWorkspaces
        .map((workspace) => workspace.memberId)
        .filter(Boolean)
        .sort();

      return memberIds.length > 0
        ? memberIds.join("|")
        : memberId;
    }, [
      memberId,
      smartViewWorkspaces,
    ]);

  const smartViewOrderStorageKey =
    useMemo(
      () =>
        smartViewOrderIdentity
          ? `tenh:smart-view-order:v2:${smartViewOrderIdentity}`
          : null,
      [smartViewOrderIdentity],
    );

  useEffect(() => {
    if (!smartViewOrderStorageKey) {
      const next = normalizeSmartViewOrder(
        null,
        availableSmartViewOrderIds,
      );
      smartViewOrderRef.current = next;
      setSmartViewOrder(next);
      return;
    }

    let stored: unknown = null;

    try {
      const raw = window.localStorage.getItem(
        smartViewOrderStorageKey,
      );

      if (raw) {
        stored = JSON.parse(raw);
      } else if (memberId) {
        // Migrate the existing per-workspace order from the previous build.
        const legacyKeys = [
          `tenh:smart-view-order:${memberId}:${selectedWorkspaceId ?? "current"}`,
          `tenh:smart-view-order:${memberId}:current`,
        ];

        for (const legacyKey of legacyKeys) {
          const legacyRaw = window.localStorage.getItem(legacyKey);
          if (!legacyRaw) {
            continue;
          }

          stored = JSON.parse(legacyRaw);
          break;
        }
      }
    } catch {
      stored = null;
    }

    const next = normalizeSmartViewOrder(
      stored,
      availableSmartViewOrderIds,
    );

    smartViewOrderRef.current = next;
    setSmartViewOrder(next);

    try {
      window.localStorage.setItem(
        smartViewOrderStorageKey,
        JSON.stringify(next),
      );
    } catch {
      // Ordering is a convenience only; Smart Views still work without storage.
    }
  }, [
    availableSmartViewOrderIds,
    memberId,
    selectedWorkspaceId,
    smartViewOrderStorageKey,
  ]);

  function persistSmartViewOrder(
    next: string[],
  ) {
    smartViewOrderRef.current = next;
    setSmartViewOrder(next);

    if (!smartViewOrderStorageKey) {
      return;
    }

    try {
      window.localStorage.setItem(
        smartViewOrderStorageKey,
        JSON.stringify(next),
      );
    } catch {
      // Keep the in-memory order if browser storage is unavailable.
    }
  }

  function moveSmartView(
    draggedId: string,
    targetId: string,
  ) {
    if (draggedId === targetId) {
      return;
    }

    const current =
      normalizeSmartViewOrder(
        smartViewOrderRef.current,
        availableSmartViewOrderIds,
      );
    const fromIndex = current.indexOf(draggedId);
    const targetIndex = current.indexOf(targetId);

    if (fromIndex < 0 || targetIndex < 0) {
      return;
    }

    const next = [...current];
    next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, draggedId);
    persistSmartViewOrder(next);
  }

  function beginSmartViewPointerDrag(
    orderId: string,
  ) {
    draggingSmartViewIdRef.current = orderId;
    setDraggingSmartViewId(orderId);
  }

  function endSmartViewPointerDrag() {
    draggingSmartViewIdRef.current = null;
    setDraggingSmartViewId(null);
  }

  function moveSmartViewFromPointer(
    clientX: number,
    clientY: number,
  ) {
    const draggedId = draggingSmartViewIdRef.current;
    if (!draggedId) {
      return;
    }

    const pointedElement = document.elementFromPoint(
      clientX,
      clientY,
    ) as HTMLElement | null;
    const targetRow = pointedElement?.closest<HTMLElement>(
      "[data-smart-view-order-id]",
    );
    const targetId = targetRow?.dataset.smartViewOrderId;

    if (targetId && targetId !== draggedId) {
      moveSmartView(draggedId, targetId);
    }
  }

  function moveSmartViewByKeyboard(
    orderId: string,
    direction: -1 | 1,
  ) {
    const current = normalizeSmartViewOrder(
      smartViewOrderRef.current,
      availableSmartViewOrderIds,
    );
    const index = current.indexOf(orderId);
    const targetIndex = index + direction;

    if (
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= current.length
    ) {
      return;
    }

    moveSmartView(orderId, current[targetIndex]);
  }

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

  const workspaceContextId =
    selectedWorkspaceId ?? currentBusinessId;

  const fallbackWorkspaceOptions =
    useMemo(() => {
      const businessIds = Array.from(
        new Set(
          conversations
            .map((conversation) => conversation.business_id)
            .filter(Boolean),
        ),
      );

      return businessIds.map((businessId) => ({
        businessId,
        businessName: `Workspace ${businessId.slice(0, 8)}`,
        memberId:
          businessId === currentBusinessId
            ? memberId ?? ""
            : "",
      }));
    }, [
      conversations,
      currentBusinessId,
      memberId,
    ]);

  const availableSmartViewWorkspaces =
    smartViewWorkspaces.length > 0
      ? smartViewWorkspaces
      : fallbackWorkspaceOptions;

  const memberIdByBusiness =
    useMemo(() => {
      const map: Record<string, string> = {};

      for (const workspace of smartViewWorkspaces) {
        if (workspace.memberId) {
          map[workspace.businessId] = workspace.memberId;
        }
      }

      if (
        currentBusinessId &&
        memberId &&
        !map[currentBusinessId]
      ) {
        map[currentBusinessId] = memberId;
      }

      return map;
    }, [
      currentBusinessId,
      memberId,
      smartViewWorkspaces,
    ]);

  const fallbackSmartViewTags =
    useMemo(() => {
      const map = new Map<string, SmartViewTagOption>();

      for (const conversation of conversations) {
        for (const tag of conversation.contact?.tags ?? []) {
          const businessId =
            tag.business_id || conversation.business_id;
          const key = makeSmartViewTagReference(
            businessId,
            tag.id,
          );
          const existing = map.get(key);

          if (existing) {
            existing.count += 1;
          } else {
            map.set(key, {
              id: tag.id,
              businessId,
              name: tag.name,
              color: tag.color,
              count: 1,
            });
          }
        }
      }

      return Array.from(map.values()).sort((first, second) =>
        first.name.localeCompare(second.name),
      );
    }, [conversations]);

  const availableSmartViewTags =
    smartViewTags.length > 0
      ? smartViewTags
      : fallbackSmartViewTags;

  const editorWorkspaceIds =
    useMemo(() => {
      if (!editor) {
        return [] as string[];
      }

      if (editor.filters.workspaceScope === "all") {
        return availableSmartViewWorkspaces.map(
          (workspace) => workspace.businessId,
        );
      }

      if (editor.filters.workspaceScope === "current") {
        return workspaceContextId
          ? [workspaceContextId]
          : [];
      }

      return editor.filters.workspaceIds;
    }, [
      editor,
      availableSmartViewWorkspaces,
      workspaceContextId,
    ]);

  const editorTagGroups =
    useMemo(() => {
      if (!editor) {
        return [] as Array<{
          businessId: string;
          businessName: string;
          tags: SmartViewTagOption[];
        }>;
      }

      const allowed = new Set(editorWorkspaceIds);
      const restrictByWorkspace =
        editor.filters.workspaceScope !== "all" ||
        allowed.size > 0;
      const workspaceNameById = new Map(
        availableSmartViewWorkspaces.map((workspace) => [
          workspace.businessId,
          workspace.businessName,
        ]),
      );
      const groups = new Map<
        string,
        {
          businessId: string;
          businessName: string;
          tags: SmartViewTagOption[];
        }
      >();

      for (const tag of availableSmartViewTags) {
        if (
          restrictByWorkspace &&
          !allowed.has(tag.businessId)
        ) {
          continue;
        }

        let group = groups.get(tag.businessId);
        if (!group) {
          group = {
            businessId: tag.businessId,
            businessName:
              workspaceNameById.get(tag.businessId) ??
              `Workspace ${tag.businessId.slice(0, 8)}`,
            tags: [],
          };
          groups.set(tag.businessId, group);
        }

        group.tags.push(tag);
      }

      return Array.from(groups.values())
        .map((group) => ({
          ...group,
          tags: [...group.tags].sort((first, second) =>
            first.name.localeCompare(second.name),
          ),
        }))
        .sort((first, second) =>
          first.businessName.localeCompare(second.businessName),
        );
    }, [
      editor,
      editorWorkspaceIds,
      availableSmartViewTags,
      availableSmartViewWorkspaces,
    ]);

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
              memberIdByBusiness,
              workspaceContextId,
              channelDirectory,
            }),
        ),
      [
        scopedConversations,
        memberId,
        memberIdByBusiness,
        workspaceContextId,
        savedViews,
        selectedViewKey,
        channelDirectory,
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
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
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
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
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
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
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
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
              }),
          ).length,

        open:
          scopedConversations.filter(
            (conversation) =>
              matchesView({
                conversation,
                key: "open",
                savedViews,
                memberId,
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
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
                memberIdByBusiness,
                workspaceContextId,
                channelDirectory,
              }),
          ).length,
      }),
      [
        scopedConversations,
        memberId,
        memberIdByBusiness,
        workspaceContextId,
        savedViews,
        channelDirectory,
      ],
    );

  const defaultSmartViews =
    useMemo(
      () => [
        {
          orderId: "default:my",
          key: "my" as BuiltInViewKey,
          name: isKhmer ? "ចាត់តាំងឱ្យខ្ញុំ" : "Assign to me",
          count: builtInCounts.my,
        },
        {
          orderId: "default:unassigned",
          key: "unassigned" as BuiltInViewKey,
          name: isKhmer ? "មិនទាន់ចាត់តាំង" : "Unassigned",
          count: builtInCounts.unassigned,
        },
        {
          orderId: "default:comment",
          key: "comment" as BuiltInViewKey,
          name: isKhmer ? "មតិយោបល់ Facebook" : "Facebook Comment",
          count: builtInCounts.comment,
        },
        {
          orderId: "default:open",
          key: "open" as BuiltInViewKey,
          name: isKhmer ? "ការសន្ទនាបើក" : "Open conversation",
          count: builtInCounts.open,
        },
      ],
      [
        builtInCounts.comment,
        builtInCounts.my,
        builtInCounts.open,
        builtInCounts.unassigned,
        isKhmer,
      ],
    );

  const orderedSmartViewItems =
    useMemo(() => {
      const byId = new Map<
        string,
        | {
            kind: "default";
            orderId: string;
            key: BuiltInViewKey;
            name: string;
            count: number;
          }
        | {
            kind: "saved";
            orderId: string;
            view: SavedView;
          }
      >();

      for (const item of defaultSmartViews) {
        byId.set(item.orderId, {
          kind: "default",
          ...item,
        });
      }

      for (const view of savedViews) {
        const orderId = `saved:${view.id}`;
        byId.set(orderId, {
          kind: "saved",
          orderId,
          view,
        });
      }

      const order = normalizeSmartViewOrder(
        smartViewOrder,
        Array.from(byId.keys()),
      );

      return order
        .map((id) => byId.get(id))
        .filter(
          (item): item is NonNullable<typeof item> =>
            Boolean(item),
        );
    }, [
      defaultSmartViews,
      savedViews,
      smartViewOrder,
    ]);

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
            isKhmer ? "មិនទាន់អាន" : "Unread",
          my:
            isKhmer ? "ចាត់តាំងឱ្យខ្ញុំ" : "Assign to me",
          unassigned:
            isKhmer ? "មិនទាន់ចាត់តាំង" : "Unassigned",
          comment:
            isKhmer ? "មតិយោបល់ Facebook" : "Facebook Comment",
          open:
            isKhmer ? "ការសន្ទនាបើក" : "Open conversation",
          pinned:
            isKhmer ? "Pin" : "Pinned",
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
      isKhmer,
    ]);

  function selectView(
    key: string,
    viewOverride?: SavedView,
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
      new URLSearchParams(
        searchParams.toString(),
      );

    query.delete("conversation");
    query.delete("status");
    query.delete("view");

    const savedView =
      viewOverride ??
      getSavedViewFromKey(
        key,
        savedViews,
      );

    const isDefaultSmartView =
      ["my", "unassigned", "comment", "open"].includes(key);

    /*
     * Smart Views own their workspace/channel scope. Default Smart Views are
     * intentionally global across every accessible subscription. Personal
     * Smart Views may target all, the current workspace, or selected
     * workspaces. Clear URL-level channel/workspace filters when needed so a
     * previous Inbox selection cannot silently hide valid Smart View matches.
     */
    if (savedView) {
      const filters = normalizeSavedViewFilters(
        savedView.filters,
      );

      query.delete("channel");
      query.delete("page");

      if (filters.workspaceScope === "current") {
        if (workspaceContextId) {
          query.set("workspace", workspaceContextId);
        } else {
          query.delete("workspace");
        }
      } else if (
        filters.workspaceScope === "selected" &&
        filters.workspaceIds.length === 1
      ) {
        query.set("workspace", filters.workspaceIds[0]);
      } else {
        query.delete("workspace");
      }
    } else if (isDefaultSmartView) {
      query.delete("workspace");
      query.delete("channel");
      query.delete("page");
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
    if (savingView || deletingViewId) {
      return;
    }

    const currentView =
      savedViews.find(
        (item) => item.id === view.id,
      );

    if (!currentView) {
      setViewActionMenuId(null);
      setViewsError(
        "This Smart View is no longer available. Refresh and try again.",
      );
      return;
    }

    const normalizedFilters =
      normalizeSavedViewFilters(
        currentView.filters,
      );

    setViewActionMenuId(null);
    setViewsError(null);

    setEditor({
      id:
        currentView.id,
      name:
        currentView.name,
      filters: {
        ...normalizedFilters,
        workspaceIds: [
          ...normalizedFilters.workspaceIds,
        ],
        tagIds: [
          ...normalizedFilters.tagIds,
        ],
      },
    });
  }

  async function saveView() {
    if (!editor || savingView) {
      return;
    }

    const editingViewId = editor.id;

    if (
      editingViewId &&
      !savedViews.some(
        (view) => view.id === editingViewId,
      )
    ) {
      setViewsError(
        "This Smart View is no longer available. Refresh and try again.",
      );
      setEditor(null);
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

    if (
      editor.filters.workspaceScope === "selected" &&
      editor.filters.workspaceIds.length === 0
    ) {
      setViewsError(
        "Select at least one workspace for this Smart View.",
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

      if (
        isEditing &&
        editingViewId &&
        result.view.id !== editingViewId
      ) {
        throw new Error(
          "Smart View update returned an unexpected result. Nothing was switched.",
        );
      }

      setSavedViews(
        (current) => {
          const normalizedResultView =
            normalizeSavedView(
              result.view as SavedView,
            );

          if (isEditing) {
            return current.map(
              (view) =>
                view.id === normalizedResultView.id
                  ? normalizedResultView
                  : view,
            );
          }

          return [
            ...current,
            normalizedResultView,
          ];
        },
      );

      const nextKey =
        `saved:${result.view.id}`;

      setEditor(null);

      if (!isEditing) {
        selectView(
          nextKey,
          normalizeSavedView(result.view),
        );
      }
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

      persistSmartViewOrder(
        smartViewOrder.filter(
          (itemId) =>
            itemId !== `saved:${view.id}`,
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

      setDeleteViewTarget(
        null,
      );
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
        isKhmer ? "ការសន្ទនាទាំងអស់" : "All conversations",
      count:
        builtInCounts.all,
      icon:
        <AllConversationIcon />,
    },
    {
      value:
        "unread",
      label:
        isKhmer ? "មិនទាន់អាន" : "Unread",
      count:
        builtInCounts.unread,
      icon:
        <UnreadIcon />,
    },
    {
      value:
        "pinned",
      label:
        isKhmer ? "Pin" : "Pinned",
      count:
        builtInCounts.pinned,
      icon:
        <PinIcon />,
    },
  ];

  const isSmartViewSelected =
    selectedViewKey.startsWith("saved:") ||
    ["my", "unassigned", "comment", "open"].includes(
      selectedViewKey,
    );

  return (
    <section className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden border-r border-slate-200 bg-white">
      <aside className="relative z-30 flex h-full w-15 shrink-0 flex-col overflow-visible border-r border-slate-200 bg-slate-50 py-3">
        {/*
         * Channel picker and status filter sit above the Smart Views. The
         * channel panel floats to the right of the rail the same way Smart
         * Views do; the filter panel opens beside the list.
         */}
        <div className="px-2 pb-1.5">
          <InboxChannelSelector variant="rail" />
        </div>

        <div className="mx-3 mb-2 mt-0.5 border-t border-slate-200" />

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

                {/*
                 * Counts conversations, not messages: this badge sits on a
                 * filter that opens a list of chats, so the number should
                 * match the rows behind it. One customer sending 30 rapid
                 * messages is still one person to reply to. The per-chat
                 * badge further down still shows the message count, and the
                 * tooltip below spells out both numbers.
                 */}
                {view.value ===
                  "unread" &&
                unreadConversationCount >
                  0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                    {unreadConversationCount >
                    99
                      ? "99+"
                      : unreadConversationCount}
                  </span>
                ) : null}

                {view.value ===
                  "pinned" &&
                view.count >
                  0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                    {view.count >
                    99
                      ? "99+"
                      : view.count}
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
                    ? isKhmer
                      ? ` · ${totalUnreadCount} សារ ក្នុង ${unreadConversationCount} ការសន្ទនា`
                      : ` · ${totalUnreadCount} message${
                          totalUnreadCount === 1 ? "" : "s"
                        } in ${unreadConversationCount} chat${
                          unreadConversationCount === 1 ? "" : "s"
                        }`
                    : ` · ${view.count}`}

                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
                </span>
              </button>
            );
          },
        )}

        <div className="px-2 pb-1.5">
          <button
            type="button"
            onClick={() => {
              setViewsOpen(false);
              setFilterOpen((current) => !current);
            }}
            className={`group relative mx-auto flex h-11 w-11 items-center justify-center rounded-xl border transition ${
              filterOpen || activeStatus !== "all"
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-transparent text-slate-500 hover:bg-white hover:text-slate-900"
            }`}
            aria-label={isKhmer ? "ត្រងតាមស្ថានភាព" : "Filter by status"}
            aria-expanded={filterOpen}
          >
            <FilterIcon />

            {activeStatus !== "all" ? (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" />
            ) : null}

            <span className="pointer-events-none absolute left-[52px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
              {isKhmer ? "ស្ថានភាពការសន្ទនា" : "Conversation status"}
              <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
            </span>
          </button>
        </div>

        {showReminderRailShortcut ? (
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
          aria-label={isKhmer ? "តាមដាន / ការរំលឹក" : "Follow-up / Reminders"}
          title={isKhmer ? "តាមដាន / ការរំលឹក" : "Follow-up / Reminders"}
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
            {isKhmer ? "តាមដាន / ការរំលឹក" : "Follow-up / Reminders"}
            {reminderCount > 0
              ? ` · ${reminderCount}`
              : ""}
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
          </span>
        </button>

        ) : null}

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
            isSmartViewSelected
              ? "bg-violet-100 text-violet-700"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`}
          aria-label={isKhmer ? "Smart Views" : "Smart Views"}
        >
          <ViewsIcon />

          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-violet-600 px-1 text-[10px] font-bold leading-none text-white">
            {savedViews.length + DEFAULT_SMART_VIEW_ORDER_IDS.length > 9
              ? "9+"
              : savedViews.length + DEFAULT_SMART_VIEW_ORDER_IDS.length}
          </span>

          <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
            {isKhmer ? "Smart Views" : "Smart Views"}
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

                <p className="mt-1 max-w-[250px] text-xs leading-5 text-slate-500">
                  Save filters to find conversations faster.
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

                <label className="mt-5 block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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

                <section className="mt-5 border-b border-slate-200 pb-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900">
                      1 · Workspace scope
                    </h4>
                  </div>

                  <label className="block">
                    <span className="sr-only">Workspace scope</span>

                    <select
                      value={editor.filters.workspaceScope}
                      onChange={(event) => {
                        const nextScope =
                          event.target.value as WorkspaceScope;

                        setEditor((current) => {
                          if (!current) {
                            return current;
                          }

                          const fallbackWorkspaceId =
                            workspaceContextId ??
                            availableSmartViewWorkspaces[0]?.businessId ??
                            null;

                          return {
                            ...current,
                            filters: {
                              ...current.filters,
                              workspaceScope: nextScope,
                              workspaceIds:
                                nextScope === "selected" &&
                                current.filters.workspaceIds.length === 0 &&
                                fallbackWorkspaceId
                                  ? [fallbackWorkspaceId]
                                  : current.filters.workspaceIds,
                              // Avoid hidden tag filters when scope changes.
                              tagIds: [],
                            },
                          };
                        });
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="all">
                        All workspaces
                      </option>
                      <option value="current">
                        Current workspace
                      </option>
                      <option value="selected">
                        Select workspaces
                      </option>
                    </select>
                  </label>

                  {editor.filters.workspaceScope === "current" ? (
                    <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] text-slate-500 ring-1 ring-slate-200">
                      {availableSmartViewWorkspaces.find(
                        (workspace) =>
                          workspace.businessId === workspaceContextId,
                      )?.businessName ?? "Current workspace"}
                    </div>
                  ) : null}

                  {editor.filters.workspaceScope === "selected" ? (
                    <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                      {availableSmartViewWorkspaces.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-slate-500">
                          No accessible workspaces are available.
                        </div>
                      ) : (
                        availableSmartViewWorkspaces.map((workspace) => {
                          const checked =
                            editor.filters.workspaceIds.includes(
                              workspace.businessId,
                            );

                          return (
                            <label
                              key={workspace.businessId}
                              className={`mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition ${
                                checked
                                  ? "bg-violet-50 text-violet-800"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setEditor((current) => {
                                    if (!current) {
                                      return current;
                                    }

                                    const workspaceIds =
                                      event.target.checked
                                        ? Array.from(
                                            new Set([
                                              ...current.filters.workspaceIds,
                                              workspace.businessId,
                                            ]),
                                          )
                                        : current.filters.workspaceIds.filter(
                                            (businessId) =>
                                              businessId !== workspace.businessId,
                                          );

                                    const removedWorkspaceTagIds =
                                      new Set(
                                        availableSmartViewTags
                                          .filter(
                                            (tag) =>
                                              tag.businessId ===
                                              workspace.businessId,
                                          )
                                          .map((tag) => tag.id),
                                      );

                                    const tagIds = event.target.checked
                                      ? current.filters.tagIds
                                      : current.filters.tagIds.filter(
                                          (reference) => {
                                            const scopedReference =
                                              parseSmartViewTagReference(
                                                reference,
                                              );

                                            if (scopedReference) {
                                              return (
                                                scopedReference.workspaceId !==
                                                workspace.businessId
                                              );
                                            }

                                            return !removedWorkspaceTagIds.has(
                                              reference,
                                            );
                                          },
                                        );

                                    return {
                                      ...current,
                                      filters: {
                                        ...current.filters,
                                        workspaceIds,
                                        tagIds,
                                      },
                                    };
                                  })
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />

                              <span className="min-w-0 flex-1 truncate font-medium">
                                {workspace.businessName}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  ) : null}

                  <p className="mt-2 text-[11px] leading-4 text-slate-400">
                    Choose which workspace conversations this Smart View can include.
                  </p>
                </section>

                <section className="border-b border-slate-200 py-5">
                  <h4 className="mb-4 text-sm font-semibold text-slate-900">
                    2 · What to match
                  </h4>

                  <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Assigned to
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
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                    <option value="telegram">
                      Telegram
                    </option>
                  </select>
                  </label>

                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Only include
                    </div>
                    <div className="flex flex-wrap gap-2">
                  <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    editor.filters.unreadOnly
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}>
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
                      className="sr-only"
                    />

                    <span>Unread</span>
                  </label>

                  <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    editor.filters.pinnedOnly
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}>
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
                      className="sr-only"
                    />

                    <span>Pinned</span>
                  </label>
                    </div>
                  </div>
                </section>

                <section className="pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900">
                      3 · Customer tags
                    </h4>

                    {editor.filters.tagIds.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  filters: {
                                    ...current.filters,
                                    tagIds: [],
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

                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                    Tags belong to one workspace. A conversation only matches tags from its own workspace.
                  </p>

                  {editorTagGroups.length === 0 ? (
                    <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                      No customer tags are available for the selected workspace scope.
                    </div>
                  ) : (
                    <div className="mt-3 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                      {editorTagGroups.map((group) => (
                        <div
                          key={group.businessId}
                          className="mb-2 last:mb-0"
                        >
                          <div className="sticky top-0 z-[1] mb-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {group.businessName}
                          </div>

                          {group.tags.map((tag) => {
                            const reference =
                              makeSmartViewTagReference(
                                tag.businessId,
                                tag.id,
                              );
                            const checked =
                              editor.filters.tagIds.includes(reference) ||
                              editor.filters.tagIds.includes(tag.id);

                            return (
                              <label
                                key={reference}
                                className={`mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                                  checked
                                    ? "bg-blue-50"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setEditor((current) => {
                                      if (!current) {
                                        return current;
                                      }

                                      const currentIds =
                                        current.filters.tagIds.filter(
                                          (value) => value !== tag.id,
                                        );

                                      return {
                                        ...current,
                                        filters: {
                                          ...current.filters,
                                          tagIds: currentIds.includes(reference)
                                            ? currentIds.filter(
                                                (value) => value !== reference,
                                              )
                                            : [...currentIds, reference],
                                        },
                                      };
                                    })
                                  }
                                  className="h-4 w-4 rounded border-slate-300"
                                />

                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: tag.color,
                                  }}
                                />

                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                                  {tag.name}
                                </span>

                                {tag.count > 0 ? (
                                  <span className="text-[10px] text-slate-400">
                                    {tag.count}
                                  </span>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-2 text-[10px] leading-4 text-slate-400">
                    Multiple selected tags use OR matching.
                  </p>
                </section>

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
              <div className="min-h-0 flex-1 overflow-y-auto p-2 pb-20">
                {viewsLoading ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading Smart Views...
                  </div>
                ) : (
                  <>
                    <div className="mb-2 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Drag any view to reorder
                    </div>

                    {orderedSmartViewItems.map((item) => {
                      const isDefault = item.kind === "default";
                      const key = isDefault
                        ? item.key
                        : `saved:${item.view.id}`;
                      const name = isDefault
                        ? item.name
                        : item.view.name;
                      const count = isDefault
                        ? item.count
                        : scopedConversations.filter((conversation) =>
                            matchesSavedView({
                              conversation,
                              view: item.view,
                              memberId,
                              memberIdByBusiness,
                              workspaceContextId,
                              channelDirectory,
                            }),
                          ).length;
                      const isActive = selectedViewKey === key;
                      const savedView =
                        item.kind === "saved" ? item.view : null;

                      return (
                        <div
                          key={item.orderId}
                          data-smart-view-order-id={item.orderId}
                          className={`relative mb-1 flex items-center gap-1 rounded-xl transition ${
                            draggingSmartViewId === item.orderId
                              ? "opacity-50"
                              : ""
                          }`}
                        >
                          <span
                            onPointerDown={(event) => {
                              if (
                                event.pointerType === "mouse" &&
                                event.button !== 0
                              ) {
                                return;
                              }

                              event.preventDefault();
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                              beginSmartViewPointerDrag(item.orderId);
                            }}
                            onPointerMove={(event) => {
                              if (
                                draggingSmartViewIdRef.current !==
                                item.orderId
                              ) {
                                return;
                              }

                              event.preventDefault();
                              moveSmartViewFromPointer(
                                event.clientX,
                                event.clientY,
                              );
                            }}
                            onPointerUp={(event) => {
                              if (
                                event.currentTarget.hasPointerCapture(
                                  event.pointerId,
                                )
                              ) {
                                event.currentTarget.releasePointerCapture(
                                  event.pointerId,
                                );
                              }
                              endSmartViewPointerDrag();
                            }}
                            onPointerCancel={() =>
                              endSmartViewPointerDrag()
                            }
                            onKeyDown={(event) => {
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveSmartViewByKeyboard(item.orderId, -1);
                              } else if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveSmartViewByKeyboard(item.orderId, 1);
                              }
                            }}
                            className="ml-1 flex h-9 w-6 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
                            title="Drag up or down to reorder"
                            aria-label={`Drag ${name} to reorder`}
                            role="button"
                            tabIndex={0}
                          >
                            ⋮⋮
                          </span>

                          <button
                            type="button"
                            onClick={() => selectView(key)}
                            className={`min-w-0 flex-1 rounded-xl px-3 py-3 text-left transition ${
                              isActive
                                ? "bg-violet-50 text-violet-800"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">
                                  {name}
                                </span>

                                <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                                  {isDefault
                                    ? "Default Smart View"
                                    : "Personal Smart View"}
                                </span>
                              </span>

                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {count}
                              </span>
                            </span>
                          </button>

                          {savedView ? (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setViewActionMenuId((current) =>
                                    current === savedView.id
                                      ? null
                                      : savedView.id,
                                  );
                                }}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label={`Manage ${savedView.name}`}
                              >
                                <MoreIcon />
                              </button>

                              {viewActionMenuId === savedView.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="fixed inset-0 z-10 cursor-default"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setViewActionMenuId(null);
                                    }}
                                    aria-label="Close Smart View actions"
                                  />

                                  <div
                                    className="absolute right-0 top-10 z-20 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
                                    onClick={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditView(savedView)
                                      }
                                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      Edit view
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setViewActionMenuId(null);
                                        setDeleteViewTarget(savedView);
                                      }}
                                      disabled={
                                        deletingViewId === savedView.id
                                      }
                                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      {deletingViewId === savedView.id
                                        ? "Deleting..."
                                        : "Delete view"}
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })}

                    {savedViews.length === 0 ? (
                      <button
                        type="button"
                        onClick={openCreateView}
                        className="mt-3 w-full rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-3 py-3 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        + Create personal Smart View
                      </button>
                    ) : null}
                  </>
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
        <div className="relative shrink-0 border-b border-slate-200 p-3">
          {/* Full-width search: the status filter now lives in the rail. */}
          <div className="relative w-full">
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
                placeholder={isKhmer ? "ស្វែងរកការសន្ទនា ទំនាក់ទំនង ឬសារ..." : "Search conversations, contacts or messages..."}
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
                className="w-full rounded-xl border-0 bg-slate-100 py-3 pl-10 pr-3 text-[13px] text-slate-700 outline-none transition placeholder:text-[12.5px] placeholder:text-slate-400 focus:bg-slate-200/60 focus:ring-2 focus:ring-blue-200"
              />
            </div>
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

              <div className="absolute left-0 top-[64px] z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Filter
                  </p>

                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    Conversation status
                  </p>

                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    Show conversations based on their current status.
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

                const isUnread =
                  (conversation.unread_count ?? 0) > 0;

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
                    /*
                     * Full-bleed rows separated by a hairline, so the
                     * selected and hovered states fill the whole width
                     * instead of floating as inset cards.
                     */
                    /*
                     * Selected, hovered and unread each get their own signal
                     * so two of them can never look like the same thing:
                     * selected is a blue rail plus a blue wash, hover is a
                     * plain grey wash, and unread is carried by weight and
                     * contrast in the text rather than another background.
                     */
                    className={`relative flex w-full items-start gap-2.5 border-b border-slate-100 py-2.5 pl-3 pr-3 text-left transition ${
                      isActive
                        ? "bg-blue-50 shadow-[inset_3px_0_0_0_var(--color-blue-600,#2563eb)]"
                        : "hover:bg-slate-100/70"
                    }`}
                  >
                    <div className="relative mt-0.5 h-10 w-10 shrink-0">
                      {customerAvatarUrl ? (
                        <img
                          src={
                            customerAvatarUrl
                          }
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 rounded-full bg-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
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
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`min-w-0 flex-1 truncate text-[13.5px] ${
                            isUnread
                              ? "font-bold text-slate-950"
                              : "font-medium text-slate-700"
                          }`}
                          style={{
                            fontFamily: CONVERSATION_TEXT_FONT_STACK,
                          }}
                        >
                          {
                            customerName
                          }
                        </p>

                        {/* Pin sits with the time so a row with no tags
                            still has somewhere stable to show it. */}
                        {isConversationPinned(
                          conversation,
                        ) ? (
                          <span
                            className="inline-flex shrink-0 scale-75 items-center justify-center text-red-600"
                            title={isKhmer ? "បានខ្ទាស់" : "Pinned"}
                            aria-label={isKhmer ? "បានខ្ទាស់" : "Pinned"}
                          >
                            <PinIcon />
                          </span>
                        ) : null}

                        <span
                          className={`shrink-0 text-[11px] ${
                            isUnread
                              ? "font-semibold text-blue-600"
                              : "text-slate-400"
                          }`}
                        >
                          {hydrated
                            ? formatMessageTime(
                                conversation.last_message_at,
                              )
                            : ""}
                        </span>
                      </div>

                      <div className="mt-0.5 flex items-center gap-2">
                        <p
                          className={`min-w-0 flex-1 truncate text-[12.5px] ${
                            isUnread
                              ? "font-medium text-slate-700"
                              : "text-slate-400"
                          }`}
                          style={{
                            fontFamily: CONVERSATION_TEXT_FONT_STACK,
                          }}
                        >
                          {normalizeLegacyConversationPreview(
                            conversation.last_message_text,
                          )}
                        </p>

                        {conversation.unread_count >
                        0 ? (
                          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                            {
                              conversation.unread_count
                            }
                          </span>
                        ) : null}
                      </div>

                      {(conversation.contact?.tags?.length ?? 0) > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {(conversation.contact
                          ?.tags ??
                          [])
                          .slice(
                            0,
                            4,
                          )
                          .map(
                            (
                              tag,
                            ) => (
                              <span
                                key={
                                  tag.id
                                }
                                className="max-w-24 truncate rounded-full px-2 py-[1px] text-[10.5px] font-semibold text-white"
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
                        4 ? (
                          <span className="rounded-full bg-slate-100 px-1.5 py-[1px] text-[10.5px] font-semibold text-slate-500">
                            +
                            {(conversation
                              .contact
                              ?.tags
                              ?.length ??
                              0) -
                              4}
                          </span>
                        ) : null}
                      </div>
                      ) : null}
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

      <DeleteConfirmDialog
        open={Boolean(deleteViewTarget)}
        title="Delete Smart View?"
        description={
          deleteViewTarget
            ? `"${deleteViewTarget.name}" will be permanently deleted. This action cannot be undone.`
            : ""
        }
        loading={
          Boolean(
            deleteViewTarget &&
              deletingViewId === deleteViewTarget.id,
          )
        }
        onCancel={() => {
          if (!deletingViewId) {
            setDeleteViewTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteViewTarget && !deletingViewId) {
            void deleteView(deleteViewTarget);
          }
        }}
      />
    </section>
  );
}
