"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type VoiceMessagePlayerProps = {
  src: string;
  isOutgoing?: boolean;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }

  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function PlayIcon({
  playing,
}: {
  playing: boolean;
}) {
  if (playing) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <rect x="6.5" y="5" width="4" height="14" rx="1" />
        <rect x="13.5" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4 translate-x-[1px]"
      aria-hidden="true"
    >
      <path d="M8 5.5v13l10-6.5L8 5.5Z" />
    </svg>
  );
}

export function VoiceMessagePlayer({
  src,
  isOutgoing = false,
}: VoiceMessagePlayerProps) {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] =
    useState(false);

  const [duration, setDuration] =
    useState(0);

  const [currentTime, setCurrentTime] =
    useState(0);

  const [playbackRate, setPlaybackRate] =
    useState(1);

  const bars = useMemo(
    () => [
      9, 15, 22, 13, 28, 18, 31, 20,
      12, 25, 34, 18, 27, 14, 30, 21,
      11, 24, 17, 32, 19, 27, 13, 22,
    ],
    [],
  );

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const syncDuration = () => {
      setDuration(
        Number.isFinite(audio.duration)
          ? audio.duration
          : 0,
      );
    };

    const syncTime = () => {
      setCurrentTime(audio.currentTime);
    };

    const stopPlaying = () => {
      setPlaying(false);
    };

    audio.addEventListener(
      "loadedmetadata",
      syncDuration,
    );
    audio.addEventListener(
      "durationchange",
      syncDuration,
    );
    audio.addEventListener(
      "timeupdate",
      syncTime,
    );
    audio.addEventListener(
      "ended",
      stopPlaying,
    );
    audio.addEventListener(
      "pause",
      stopPlaying,
    );
    audio.addEventListener(
      "play",
      () => setPlaying(true),
    );

    return () => {
      audio.pause();
      audio.removeEventListener(
        "loadedmetadata",
        syncDuration,
      );
      audio.removeEventListener(
        "durationchange",
        syncDuration,
      );
      audio.removeEventListener(
        "timeupdate",
        syncTime,
      );
      audio.removeEventListener(
        "ended",
        stopPlaying,
      );
      audio.removeEventListener(
        "pause",
        stopPlaying,
      );
    };
  }, [src]);

  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
      return;
    }

    audio.pause();
  }

  function seek(nextValue: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = nextValue;
    setCurrentTime(nextValue);
  }

  function cycleSpeed() {
    const audio = audioRef.current;
    const next =
      playbackRate === 1
        ? 1.5
        : playbackRate === 1.5
          ? 2
          : 1;

    setPlaybackRate(next);

    if (audio) {
      audio.playbackRate = next;
    }
  }

  const progress =
    duration > 0
      ? Math.min(
          1,
          Math.max(
            0,
            currentTime / duration,
          ),
        )
      : 0;

  return (
    <div
      className={`w-[310px] max-w-full rounded-2xl border px-3.5 py-3 shadow-sm ${
        isOutgoing
          ? "border-emerald-200 bg-emerald-50/90"
          : "border-slate-200 bg-white"
      }`}
    >
      <audio
        key={src}
        ref={audioRef}
        src={src}
        preload="metadata"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            void togglePlayback()
          }
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition ${
            isOutgoing
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
          aria-label={
            playing
              ? "Pause voice message"
              : "Play voice message"
          }
        >
          <PlayIcon playing={playing} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-[3px] overflow-hidden">
            {bars.map(
              (height, index) => {
                const completed =
                  index /
                    Math.max(
                      bars.length - 1,
                      1,
                    ) <=
                  progress;

                return (
                  <span
                    key={index}
                    className={`w-[3px] shrink-0 rounded-full transition ${
                      completed
                        ? isOutgoing
                          ? "bg-emerald-600"
                          : "bg-blue-600"
                        : "bg-slate-300"
                    }`}
                    style={{
                      height: `${height}px`,
                    }}
                  />
                );
              },
            )}
          </div>

          <input
            type="range"
            min={0}
            max={
              duration > 0
                ? duration
                : 0
            }
            step={0.01}
            value={
              duration > 0
                ? Math.min(
                    currentTime,
                    duration,
                  )
                : 0
            }
            onChange={(event) =>
              seek(
                Number(
                  event.target.value,
                ),
              )
            }
            className="mt-1 h-1 w-full cursor-pointer accent-blue-600"
            aria-label="Voice message progress"
          />

          <div className="mt-1 flex items-center justify-between gap-3 text-[11px] font-medium text-slate-500">
            <span>
              {formatTime(currentTime)}
              {" / "}
              {formatTime(duration)}
            </span>

            <button
              type="button"
              onClick={cycleSpeed}
              className="rounded-md px-1.5 py-0.5 font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              title="Playback speed"
            >
              {playbackRate}×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
