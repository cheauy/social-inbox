"use client";

type TrendSparklineProps = {
  values?: number[];
  width?: number;
  height?: number;
};

function buildPoints(
  values: number[],
  width: number,
  height: number,
) {
  if (values.length === 0) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : (index / (values.length - 1)) * width;

      const y =
        height -
        ((value - min) / range) * (height - 6) -
        3;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TrendSparkline({
  values = [2, 5, 4, 7, 5, 8, 10],
  width = 64,
  height = 28,
}: TrendSparklineProps) {
  const points = buildPoints(values, width, height);

  const lastValue = values.at(-1) ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const lastY =
    height -
    ((lastValue - min) / range) * (height - 6) -
    3;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="tenhTrendFill"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#2563EB"
            stopOpacity="0.18"
          />
          <stop
            offset="100%"
            stopColor="#2563EB"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      {points ? (
        <>
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill="url(#tenhTrendFill)"
          />

          <polyline
            points={points}
            stroke="#2563EB"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <circle
            cx={width}
            cy={lastY}
            r="2.2"
            fill="#2563EB"
          />
        </>
      ) : null}
    </svg>
  );
}
