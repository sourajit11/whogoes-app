"use client";

interface KpiCardProps {
  label: string;
  value: number | string;
  prefix?: string;
  changePercent?: number;
  comparisonLabel?: string;
  accent?: "emerald" | "blue" | "indigo" | "amber";
}

export default function KpiCard({
  label,
  value,
  prefix,
  changePercent,
  comparisonLabel,
  accent,
}: KpiCardProps) {
  const formattedValue =
    typeof value === "number" ? value.toLocaleString() : value;

  const accentColor =
    accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : accent === "indigo"
          ? "text-indigo-600 dark:text-indigo-400"
          : accent === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className={`text-3xl font-bold tabular-nums ${accentColor}`}>
          {prefix}
          {formattedValue}
        </p>
        {changePercent !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
              changePercent > 0
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : changePercent < 0
                  ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {changePercent > 0 ? (
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            ) : changePercent < 0 ? (
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            ) : null}
            {changePercent > 0 ? "+" : ""}
            {changePercent}%
          </span>
        )}
      </div>
      {comparisonLabel && (
        <p className="mt-1 text-xs text-zinc-400">{comparisonLabel}</p>
      )}
    </div>
  );
}
