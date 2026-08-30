"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  notificationSounds,
  type NotificationSoundKey,
} from "@/lib/inbox/notification-sounds";
import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import {
  useBrowserNotifications,
} from "@/lib/inbox/use-browser-notifications";

function BellIcon() {
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
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 21h4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerIcon() {
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
        d="M5 9v6h4l5 4V5L9 9H5Z"
        strokeLinejoin="round"
      />
      <path
        d="M17 9.5a4 4 0 0 1 0 5M19.5 7a7.5 7.5 0 0 1 0 10"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

export function NotificationSettingsCard() {
  const {
    state,
    soundKey,
    volume,
    toggleNotifications,
    setNotificationSound,
    setNotificationVolume,
    previewSound,
  } = useBrowserNotifications();

  const [draftSound, setDraftSound] =
    useState<NotificationSoundKey>(
      soundKey,
    );

  const [draftVolume, setDraftVolume] =
    useState(volume);

  const [saved, setSaved] =
    useState(false);

  const [saveAlertVisible, setSaveAlertVisible] =
    useState(false);

  const [previewError, setPreviewError] =
    useState<string | null>(null);

  useEffect(() => {
    setDraftSound(soundKey);
  }, [soundKey]);

  useEffect(() => {
    setDraftVolume(volume);
  }, [volume]);

  const selectedSound = useMemo(
    () =>
      notificationSounds.find(
        (sound) =>
          sound.key === draftSound,
      ) ?? notificationSounds[0],
    [draftSound],
  );

  const notificationEnabled =
    state === "enabled";

  const notificationUnavailable =
    state === "unsupported" ||
    state === "denied";

  const volumePercent = Math.round(
    draftVolume * 100,
  );

  async function handlePreview(
    sound: NotificationSoundKey,
  ) {
    setPreviewError(null);

    const result = await previewSound(
      sound,
      draftVolume,
    );

    if (!result.success) {
      setPreviewError(
        "Unable to play this sound. Check that the audio file exists in public/alert-sound.",
      );
    }
  }

  function handleSave() {
    setNotificationSound(draftSound);
    setNotificationVolume(
      draftVolume,
    );

    setSaved(true);
    setSaveAlertVisible(true);

    window.setTimeout(() => {
      setSaved(false);
    }, 2500);

    window.setTimeout(() => {
      setSaveAlertVisible(false);
    }, 3000);
  }

  return (
    <>
      {saveAlertVisible ? (
        <div
          className="fixed right-6 top-6 z-[100] flex max-w-sm items-start gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-xl"
          role="status"
          aria-live="polite"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
            ✓
          </span>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              <WorkspaceLanguageText
                en="Settings saved"
                km="បានរក្សាទុកការកំណត់"
              />
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              <WorkspaceLanguageText
                en="Your notification sound and volume have been updated."
                km="សំឡេងជូនដំណឹង និងកម្រិតសំឡេងរបស់អ្នកត្រូវបានធ្វើបច្ចុប្បន្នភាព។"
              />
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSaveAlertVisible(false)}
            className="ml-2 text-lg leading-none text-slate-400 hover:text-slate-700"
            aria-label="Close saved notification"
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {/* Header */}
        <div className="border-b border-slate-200 px-7 py-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <BellIcon />
            </div>

            <div>
              <h3 className="text-[22px] font-bold tracking-[-0.02em] text-slate-900">
                <WorkspaceLanguageText
                  en="Notifications"
                  km="ការជូនដំណឹង"
                />
              </h3>
              <p className="mt-1.5 text-sm text-slate-500">
                <WorkspaceLanguageText
                  en="Choose how Tenh Chat alerts you when a new customer message arrives."
                  km="ជ្រើសរើសរបៀបដែល Tenh Chat ជូនដំណឹងអ្នក នៅពេលមានសារថ្មីពីអតិថិជន។"
                />
              </p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {/* Desktop notifications */}
          <div className="flex items-center justify-between gap-6 px-7 py-7">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M8 21h8M12 16v5" />
                </svg>
              </div>

              <div>
                <p className="text-base font-semibold text-slate-900">
                  <WorkspaceLanguageText
                    en="Desktop notifications"
                    km="ការជូនដំណឹងលើ Desktop"
                  />
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  <WorkspaceLanguageText
                    en="Show a browser notification when Tenh Chat is in the background."
                    km="បង្ហាញការជូនដំណឹងតាមកម្មវិធីរុករក នៅពេល Tenh Chat កំពុងដំណើរការនៅផ្ទៃខាងក្រោយ។"
                  />
                </p>

                {state === "denied" ? (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    Notifications are blocked in your browser. Allow them from the browser site settings first.
                  </p>
                ) : null}

                {state === "unsupported" ? (
                  <p className="mt-2 text-xs font-medium text-amber-600">
                    This browser does not support desktop notifications.
                  </p>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void toggleNotifications();
              }}
              disabled={
                notificationUnavailable ||
                state === "loading"
              }
              className={`relative h-9 w-[62px] shrink-0 rounded-full transition ${
                notificationEnabled
                  ? "bg-blue-600"
                  : "bg-slate-300"
              } disabled:cursor-not-allowed disabled:opacity-50`}
              aria-label="Toggle desktop notifications"
              aria-pressed={notificationEnabled}
            >
              <span
                className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${
                  notificationEnabled
                    ? "left-[31px]"
                    : "left-1"
                }`}
              />
            </button>
          </div>

          {/* Notification sound */}
          <div className="px-7 py-7">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                <SpeakerIcon />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-slate-900">
                  <WorkspaceLanguageText
                    en="Notification sound"
                    km="សំឡេងជូនដំណឹង"
                  />
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  <WorkspaceLanguageText
                    en="Select the sound used for new customer messages."
                    km="ជ្រើសរើសសំឡេងសម្រាប់សារថ្មីពីអតិថិជន។"
                  />
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {notificationSounds.map((sound) => {
                const selected =
                  draftSound === sound.key;

                return (
                  <div
                    key={sound.key}
                    className={`flex min-h-[82px] items-center gap-4 rounded-2xl border px-5 py-4 transition ${
                      selected
                        ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-100"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSound(sound.key);
                        setSaved(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? "border-blue-600"
                            : "border-slate-300"
                        }`}
                      >
                        {selected ? (
                          <span className="h-3 w-3 rounded-full bg-blue-600" />
                        ) : null}
                      </span>

                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-slate-800">
                          {sound.key === "droplet-ping" ? (
                            <WorkspaceLanguageText
                              en={sound.label}
                              km="Droplet Ping (លំនាំដើម)"
                            />
                          ) : sound.key === "none" ? (
                            <WorkspaceLanguageText
                              en={sound.label}
                              km="គ្មានសំឡេង"
                            />
                          ) : (
                            sound.label
                          )}
                        </span>
                      </span>
                    </button>

                    {sound.src ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handlePreview(sound.key);
                        }}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                        aria-label={`Preview ${sound.label}`}
                        title={`Preview ${sound.label}`}
                      >
                        <PlayIcon />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {previewError ? (
              <p className="mt-3 text-sm text-red-600">
                {previewError}
              </p>
            ) : null}
          </div>

          {/* Volume preserved */}
          <div className="px-7 py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  <WorkspaceLanguageText
                    en="Sound volume"
                    km="កម្រិតសំឡេង"
                  />
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  <WorkspaceLanguageText
                    en="Volume for Tenh Chat notification sounds."
                    km="កម្រិតសំឡេងសម្រាប់ការជូនដំណឹងរបស់ Tenh Chat។"
                  />
                </p>
              </div>

              <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
                {volumePercent}%
              </span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className="text-sm text-slate-400">
                🔈
              </span>

              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={volumePercent}
                disabled={
                  selectedSound.key ===
                  "none"
                }
                onChange={(event) => {
                  setDraftVolume(
                    Number(event.target.value) / 100,
                  );
                  setSaved(false);
                }}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Notification sound volume"
              />

              <span className="text-sm text-slate-500">
                🔊
              </span>
            </div>
          </div>
        </div>

        {/* Save footer preserved */}
        <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50/70 px-7 py-4">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            {saved ? (
              <WorkspaceLanguageText
                en="Saved ✓"
                km="បានរក្សាទុក ✓"
              />
            ) : (
              <WorkspaceLanguageText
                en="Save changes"
                km="រក្សាទុកការផ្លាស់ប្តូរ"
              />
            )}
          </button>
        </div>
      </section>
    </>
  );

}