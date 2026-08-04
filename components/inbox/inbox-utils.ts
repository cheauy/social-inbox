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

export function formatMessageTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
