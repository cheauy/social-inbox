import type { ConversationStatus } from "@/types/inbox";

export const statusOptions: Array<{
  value: ConversationStatus;
  label: string;
}> = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "spam", label: "Spam" },
];

export function getInitial(name: string | null) {
  if (!name) {
    return "?";
  }

  return name.trim().charAt(0).toUpperCase();
}

export function formatMessageTime(
  value: string | null,
) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();

  const differenceMs =
    now.getTime() - date.getTime();

  const differenceSeconds =
    Math.max(
      0,
      Math.floor(
        differenceMs / 1000,
      ),
    );

  if (differenceSeconds < 60) {
    return "Now";
  }

  const differenceMinutes =
    Math.floor(
      differenceSeconds / 60,
    );

  if (differenceMinutes < 60) {
    return `${differenceMinutes}m`;
  }

  const differenceHours =
    Math.floor(
      differenceMinutes / 60,
    );

  if (differenceHours < 24) {
    return `${differenceHours}h`;
  }

  const startOfToday =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

  const startOfMessageDay =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );

  const dayDifference =
    Math.round(
      (
        startOfToday.getTime() -
        startOfMessageDay.getTime()
      ) /
        86_400_000,
    );

  if (dayDifference === 1) {
    return "Yesterday";
  }

  if (dayDifference < 7) {
    return date.toLocaleDateString(
      undefined,
      {
        weekday: "short",
      },
    );
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  );
}

export function getStatusClasses(
  status: ConversationStatus,
) {
  switch (status) {
    case "open":
      return "bg-emerald-100 text-emerald-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    case "resolved":
      return "bg-blue-100 text-blue-700";
    case "closed":
      return "bg-slate-200 text-slate-700";
    case "spam":
      return "bg-red-100 text-red-700";
  }
}

export function getStatusLabel(
  status: ConversationStatus,
) {
  return (
    statusOptions.find(
      (item) => item.value === status,
    )?.label ?? status
  );
}
