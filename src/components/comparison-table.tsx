interface ComparisonRow {
  feature: string;
  whogoes: string;
  competitor: string;
  winner?: "whogoes" | "competitor" | "tie";
}

interface ComparisonTableProps {
  competitor: string;
  rows: ComparisonRow[];
}

export function ComparisonTable({ competitor, rows }: ComparisonTableProps) {
  return (
    <div className="overflow-x-auto my-8">
      <table className="w-full text-sm border-collapse border border-zinc-200 dark:border-zinc-700">
        <thead>
          <tr>
            <th className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-left font-semibold text-zinc-900 dark:text-white w-1/3">
              Feature
            </th>
            <th className="border border-zinc-200 dark:border-zinc-700 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-left font-semibold text-emerald-700 dark:text-emerald-400 w-1/3">
              WhoGoes
            </th>
            <th className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-left font-semibold text-zinc-900 dark:text-white w-1/3">
              {competitor}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="border border-zinc-200 dark:border-zinc-700 px-4 py-3 font-medium text-zinc-900 dark:text-white">
                {row.feature}
              </td>
              <td
                className={`border border-zinc-200 dark:border-zinc-700 px-4 py-3 ${
                  row.winner === "whogoes"
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {row.winner === "whogoes" && (
                  <span className="mr-1.5" aria-hidden="true">
                    ✓
                  </span>
                )}
                {row.whogoes}
              </td>
              <td
                className={`border border-zinc-200 dark:border-zinc-700 px-4 py-3 ${
                  row.winner === "competitor"
                    ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {row.winner === "competitor" && (
                  <span className="mr-1.5" aria-hidden="true">
                    ✓
                  </span>
                )}
                {row.competitor}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
