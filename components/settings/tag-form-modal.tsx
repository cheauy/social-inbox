"use client";

import { Check, Copy, X, Pipette } from "lucide-react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

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

  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-8 sm:pt-7">
          <div>
            <h2 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              {mode === "create" ? (isKhmer ? "បន្ថែមស្លាកថ្មី" : "Add a new tag") : (isKhmer ? "កែសម្រួលស្លាក" : "Edit tag")}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {mode === "create"
                ? (isKhmer
                    ? "បង្កើតស្លាក ដើម្បីជួយក្រុមរបស់អ្នករៀបចំការសន្ទនាឲ្យមានរបៀបរៀបរយ។"
                    : "Create a tag to help your team organize conversations.")
                : (isKhmer
                    ? "កែប្រែរបៀបដែលស្លាកនេះបង្ហាញ និងដំណើរការនៅក្នុងការសន្ទនាទាំងអស់។"
                    : "Update how this tag appears and behaves across conversations.")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isKhmer ? "បិទ" : "Close"}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 sm:px-8">
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-[0.72fr_1.28fr]">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  {isKhmer ? "លំដាប់ស្លាក" : "Tag order"}
                </label>

                <input
                  type="number"
                  min={0}
                  value={value.sortIndex}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      sortIndex: Math.max(0, Number(event.target.value)),
                    })
                  }
                  disabled={saving}
                  className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />

                <p className="mt-1.5 text-xs text-slate-500">
                  {isKhmer ? "លេខតូចជាងនឹងបង្ហាញមុន។" : "Lower numbers appear first."}
                </p>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  {isKhmer ? "ឈ្មោះស្លាក" : "Tag name"}
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
                  placeholder={isKhmer ? "ឈ្មោះស្លាក" : "Tag name"}
                  className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-700">
                {isKhmer ? "ពណ៌ស្លាក" : "Tag color"}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                {presetColors.map((color) => {
                  const selected = normalizedColor === color;

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
                      className={`relative flex h-11 w-11 items-center justify-center rounded-full transition ${
                        selected
                          ? "ring-2 ring-offset-4 ring-emerald-500"
                          : "hover:scale-105"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                      style={{ backgroundColor: color }}
                      aria-label={`Choose ${color}`}
                      title={color}
                    >
                      {selected ? (
                        <Check
                          className="h-5 w-5 text-white"
                          strokeWidth={3}
                        />
                      ) : null}
                    </button>
                  );
                })}

                <label
                  className={`relative flex cursor-pointer flex-col items-center gap-2 ${
                    !isPresetColor ? "scale-[1.02]" : ""
                  }`}
                  title={`Custom color: ${normalizedColor}`}
                >
                  <span
                    className={`relative flex h-[58px] w-[58px] items-center justify-center rounded-full transition ${
                      !isPresetColor
                        ? "ring-2 ring-blue-500 ring-offset-2"
                        : "hover:scale-105"
                    }`}
                    style={{
                      background:
                        "conic-gradient(from 180deg, #ff4d4f 0deg, #fa8c16 45deg, #fadb14 90deg, #52c41a 135deg, #13c2c2 180deg, #1677ff 225deg, #722ed1 270deg, #eb2f96 315deg, #ff4d4f 360deg)",
                    }}
                  >
                    <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-white shadow-[0_4px_16px_rgba(15,23,42,0.18)]">
                      <Pipette className="h-4 w-4 text-slate-600" strokeWidth={2.2} />
                    </span>
                  </span>

                  <span className="text-center text-sm font-medium leading-none text-blue-600">
                    {isKhmer ? "ពណ៌ផ្ទាល់ខ្លួន" : "Custom color"}
                  </span>

                  <input
                    type="color"
                    value={normalizedColor}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        color: event.target.value.toUpperCase(),
                      })
                    }
                    disabled={saving}
                    className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    aria-label={isKhmer ? "ជ្រើសរើសពណ៌ផ្ទាល់ខ្លួន" : "Choose custom color"}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">
                {isKhmer ? "ពណ៌ HEX" : "HEX color"}
              </label>

              <div className="mt-2 flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3 transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                <span
                  className="mr-3 h-8 w-8 shrink-0 rounded-lg border border-slate-200"
                  style={{ backgroundColor: normalizedColor }}
                />

                <input
                  value={value.color}
                  maxLength={7}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      color: event.target.value.toUpperCase(),
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
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-sm uppercase text-slate-700 outline-none"
                />

                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(normalizedColor);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isKhmer ? "ចម្លងពណ៌ HEX" : "Copy HEX color"}
                  title={isKhmer ? "ចម្លងពណ៌ HEX" : "Copy HEX color"}
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>

              <p className="mt-1.5 text-xs text-slate-500">
                {isKhmer ? "ប្រើពណ៌ HEX ដើម្បីរក្សាភាពស៊ីសង្វាក់គ្នានៃម៉ាករបស់អ្នក។" : "Use a HEX color to ensure brand consistency."}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-700">
                {isKhmer ? "មើលជាមុនភ្លាមៗ" : "Live preview"}
              </p>

              <span
                className="mt-3 inline-flex min-w-32 justify-center rounded-full px-5 py-2 text-sm font-bold text-white shadow-sm"
                style={{ backgroundColor: normalizedColor }}
              >
                {value.name.trim() || (isKhmer ? "មើលស្លាកជាមុន" : "Tag preview")}
              </span>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">
                {isKhmer ? "ការពិពណ៌នា" : "Description"}{" "}
                <span className="font-normal text-slate-400">
                  {isKhmer ? "(ស្រេចចិត្ត)" : "(optional)"}
                </span>
              </label>

              <textarea
                value={value.description}
                maxLength={500}
                rows={3}
                onChange={(event) =>
                  onChange({
                    ...value,
                    description: event.target.value,
                  })
                }
                disabled={saving}
                placeholder={isKhmer ? "បន្ថែមការពិពណ៌នា ដើម្បីជួយក្រុមរបស់អ្នកយល់ថាពេលណាគួរប្រើស្លាកនេះ។" : "Add a description to help your team understand when to use this tag."}
                className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              />

              <p className="mt-1 text-right text-xs text-slate-400">
                {value.description.length}/500
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <span className="relative mt-0.5 inline-flex shrink-0 items-center">
                <input
                  type="checkbox"
                  checked={!value.isActive}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      isActive: !event.target.checked,
                    })
                  }
                  disabled={saving}
                  className="peer sr-only"
                />
                <span className="h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-blue-600 peer-disabled:opacity-50" />
                <span className="absolute left-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
              </span>

              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  {isKhmer ? "បិទស្លាកនេះ" : "Disable this tag"}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {isKhmer ? "ស្លាកដែលបានបិទ នឹងមិនបង្ហាញក្នុងការជ្រើសរើសរហ័សទេ ហើយនឹងត្រូវផ្លាស់ទៅខាងក្រោមបញ្ជី។" : "Disabled tags are hidden from quick assignment and moved to the bottom of the list."}
                </span>
              </span>
            </label>

            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-w-[104px] rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isKhmer ? "បិទ" : "Close"}
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={
              saving ||
              !value.name.trim() ||
              !isValidHexColor(value.color)
            }
            className="min-w-[144px] rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving
              ? (isKhmer ? "កំពុងរក្សាទុក..." : "Saving...")
              : mode === "create"
                ? (isKhmer ? "បន្ថែមស្លាក" : "Add tag")
                : (isKhmer ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}
