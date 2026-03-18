"use client";

import type { TimeRange } from "@/types/admin";

const OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "4w", label: "4 Weeks" },
  { value: "3m", label: "3 Months" },
  { value: "all", label: "All Time" },
];

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export default function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/50">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === option.value
              ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-700 dark:text-white"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
