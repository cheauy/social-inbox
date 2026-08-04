import type {
  CustomerTag,
  TagColor,
} from "@/types/inbox";

const colorClasses: Record<
  TagColor,
  string
> = {
  slate:
    "bg-slate-100 text-slate-700 ring-slate-200",

  red:
    "bg-red-100 text-red-700 ring-red-200",

  orange:
    "bg-orange-100 text-orange-700 ring-orange-200",

  amber:
    "bg-amber-100 text-amber-700 ring-amber-200",

  teal:
    "bg-teal-100 text-teal-700 ring-teal-200",

  emerald:
    "bg-emerald-100 text-emerald-700 ring-emerald-200",

  blue:
    "bg-blue-100 text-blue-700 ring-blue-200",

  indigo:
    "bg-indigo-100 text-indigo-700 ring-indigo-200",

  violet:
    "bg-violet-100 text-violet-700 ring-violet-200",

  yellow:
    "bg-yellow-100 text-yellow-800 ring-yellow-200",

  pink:
    "bg-pink-100 text-pink-700 ring-pink-200",
};

type TagBadgeProps = {
  tag: CustomerTag;
  removable?: boolean;
  onRemove?: () => void;
};

export function TagBadge({
  tag,
  removable = false,
  onRemove,
}: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${colorClasses[tag.color]}`}
    >
      {tag.name}

      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-full px-1 hover:bg-black/10"
          aria-label={`Remove ${tag.name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
