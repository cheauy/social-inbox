"use client";

import type { TagColor } from "@/types/inbox";

export type TagFormValue = {
  name: string;
  color: TagColor;
  sortIndex: number;
  description: string;
  isActive: boolean;
};

type TagFormModalProps = {
  mode: "create" | "edit";
  value: TagFormValue;
  saving: boolean;
  error: string | null;
  onChange: (value: TagFormValue) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const presetColors = [
  "#16A34A",
  "#FF7043",
  "#FB8C00",
  "#13C2C2",
  "#1E88E5",
  "#597EF7",
  "#9254DE",
  "#FBBF24",
  "#22B573",
];

function isValidHexColor(value: string) {
  return /^#[0-9A-F]{6}$/i.test(value);
}

export function TagFormModal({
  mode,
  value,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: TagFormModalProps) {
  const normalizedColor = isValidHexColor(
    value.color,
  )
    ? value.color.toUpperCase()
    : "#64748B";

  const isPresetColor = presetColors.includes(
    normalizedColor,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-900">
            {mode === "create"
              ? "Add a new tag"
              : "Edit tag"}
          </h2>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-2xl leading-none text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div>
            <label className="text-sm font-medium text-slate-700">
              Tag index
            </label>

            <input
              type="number"
              min={0}
              value={value.sortIndex}
              onChange={(event) =>
                onChange({
                  ...value,
                  sortIndex: Math.max(
                    0,
                    Number(event.target.value),
                  ),
                })
              }
              disabled={saving}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />

            <p className="mt-1 text-xs text-slate-500">
              Lower numbers appear first.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">
              Tag name
            </label>

            <input
              value={value.name}
              maxLength={50}
              onChange={(event) =>
                onChange({
                  ...value,
                  name: event.target.value,
                })
              }
              disabled={saving}
              placeholder="Tag name"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">
              Tag color
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {presetColors.map((color) => {
                const selected =
                  normalizedColor === color;

                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        color,
                      })
                    }
                    disabled={saving}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
                      selected
                        ? "ring-4 ring-blue-100"
                        : "hover:scale-105"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    style={{
                      backgroundColor: color,
                    }}
                    aria-label={`Choose ${color}`}
                    title={color}
                  >
                    {selected ? (
                      <span className="text-lg font-bold text-white">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}

              <label
                className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-2 border-slate-300 transition hover:scale-105 ${
                  !isPresetColor
                    ? "ring-4 ring-blue-100"
                    : ""
                }`}
                style={{
                  backgroundColor: normalizedColor,
                }}
                title={`Custom color: ${normalizedColor}`}
              >
                <span className="rounded bg-white/90 px-1 text-base">
                  🖌
                </span>

                <input
                  type="color"
                  value={normalizedColor}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      color:
                        event.target.value.toUpperCase(),
                    })
                  }
                  disabled={saving}
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  aria-label="Choose custom color"
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500">
                HEX color
              </label>

              <input
                value={value.color}
                maxLength={7}
                onChange={(event) =>
                  onChange({
                    ...value,
                    color:
                      event.target.value.toUpperCase(),
                  })
                }
                onBlur={() => {
                  if (!isValidHexColor(value.color)) {
                    onChange({
                      ...value,
                      color: "#64748B",
                    });
                  }
                }}
                disabled={saving}
                placeholder="#13C2C2"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm uppercase outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              />

              <p className="mt-1 text-xs text-slate-500">
                Example: #13C2C2
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">
              Preview
            </p>

            <span
              className="mt-3 inline-flex min-w-32 justify-center rounded-full px-4 py-2 text-sm font-semibold text-white"
              style={{
                backgroundColor: normalizedColor,
              }}
            >
              {value.name.trim() || "Tag preview"}
            </span>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">
              Tag description
            </label>

            <textarea
              value={value.description}
              maxLength={500}
              rows={4}
              onChange={(event) =>
                onChange({
                  ...value,
                  description:
                    event.target.value,
                })
              }
              disabled={saving}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />

            <p className="mt-1 text-right text-xs text-slate-400">
              {value.description.length}/500
            </p>
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!value.isActive}
              onChange={(event) =>
                onChange({
                  ...value,
                  isActive:
                    !event.target.checked,
                })
              }
              disabled={saving}
              className="mt-1 h-5 w-5 rounded border-slate-300"
            />

            <span>
              <span className="font-medium text-slate-800">
                Disable this tag
              </span>

              <span className="mt-1 block text-sm text-slate-500">
                Disablde tags are hidden from
                quick assignment and moved to the
                bottom of the list.
              </span>
            </span>
          </label>

          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Close
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={
              saving ||
              !value.name.trim() ||
              !isValidHexColor(value.color)
            }
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Add tag"
                : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}