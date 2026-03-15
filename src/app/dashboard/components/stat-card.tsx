interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "emerald" | "blue" | "indigo";
  subtitle?: string;
}

export default function StatCard({
  label,
  value,
  accent,
  subtitle,
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-bold tabular-nums ${
          accent === "emerald"
            ? "text-emerald-600 dark:text-emerald-400"
            : accent === "blue"
              ? "text-blue-600 dark:text-blue-400"
              : accent === "indigo"
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
      )}
    </div>
  );
}
