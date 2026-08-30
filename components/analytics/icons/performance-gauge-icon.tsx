"use client";

type PerformanceGaugeIconProps = {
  tone?: "green" | "orange" | "red";
  size?: number;
};

export function PerformanceGaugeIcon({
  tone = "green",
  size = 40,
}: PerformanceGaugeIconProps) {
  const color =
    tone === "green"
      ? "#16A34A"
      : tone === "orange"
        ? "#F59E0B"
        : "#EF4444";

  const background =
    tone === "green"
      ? "#F0FDF4"
      : tone === "orange"
        ? "#FFF7ED"
        : "#FEF2F2";

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        backgroundColor: background,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(size * 0.6)}
        height={Math.round(size * 0.6)}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.5" />

        <path d="M12 5.5V7" />
        <path d="M7.4 7.4l1.05 1.05" />
        <path d="M5.5 12H7" />
        <path d="M16.6 7.4l-1.05 1.05" />
        <path d="M17 12h1.5" />

        <path d="M12 12l4-3" />
        <circle
          cx="12"
          cy="12"
          r="1.15"
          fill={color}
          stroke="none"
        />
      </svg>
    </span>
  );
}
