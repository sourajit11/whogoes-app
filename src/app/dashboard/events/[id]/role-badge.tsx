// Shared event-role badge used by the public event preview table, the pre-unlock
// filtered preview, and the My Events contact table so role styling stays consistent.
// Attendee (confirmed) is shown in green per product decision; the tentative
// "expected attendee" tier stays muted so it reads as "not confirmed".
const ROLE_STYLES: Record<string, string> = {
  organizer:
    "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-500/20",
  sponsor:
    "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
  exhibitor:
    "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
  attendee:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  expected_attendee:
    "bg-zinc-50 text-zinc-400 ring-zinc-300/70 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-700",
};

const ROLE_LABELS: Record<string, string> = {
  organizer: "Organizer",
  sponsor: "Sponsor",
  exhibitor: "Exhibitor",
  attendee: "Attendee",
  expected_attendee: "Expected",
};

export function RoleBadge({
  role,
  isSpeaker = false,
}: {
  role: string | null | undefined;
  isSpeaker?: boolean;
}) {
  const key = (role ?? "attendee").toLowerCase();
  const style = ROLE_STYLES[key] ?? ROLE_STYLES.attendee;
  const label = ROLE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={
          key === "expected_attendee"
            ? "Expected attendee — reposted the event without confirming attendance"
            : undefined
        }
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
      >
        {label}
      </span>
      {isSpeaker && (
        <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          Speaker
        </span>
      )}
    </span>
  );
}
