import {
  PerformanceGaugeIcon,
} from "@/components/analytics/icons/performance-gauge-icon";
import {
  TrendSparkline,
} from "@/components/analytics/icons/trend-sparkline";

export function PerformanceVisualExample() {
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <PerformanceGaugeIcon tone="green" />
        <span>Fast</span>
      </div>

      <div className="flex items-center gap-2">
        <PerformanceGaugeIcon tone="orange" />
        <span>Normal</span>
      </div>

      <div className="flex items-center gap-2">
        <PerformanceGaugeIcon tone="red" />
        <span>Slow</span>
      </div>

      <TrendSparkline
        values={[4, 7, 5, 9, 6, 10, 12]}
      />
    </div>
  );
}
