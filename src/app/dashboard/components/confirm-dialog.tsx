"use client";

// Small yes/no gate for actions that spend credits or discard state (email
// reveals, un-marking processed leads). Same visual language as the unlock
// confirmation modal, but generic: title, short body, optional detail rows.
export default function ConfirmDialog({
  title,
  body,
  rows,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  rows?: { label: string; value: string; warn?: boolean }[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        {body && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
        )}

        {rows && rows.length > 0 && (
          <dl className="mt-5 space-y-3 text-sm">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-4"
              >
                <dt className="shrink-0 text-zinc-500">{row.label}</dt>
                <dd
                  className={`text-right font-semibold ${
                    row.warn
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
