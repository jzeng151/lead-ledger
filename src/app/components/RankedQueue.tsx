import Link from "next/link";
import type { QueueRow } from "@/lib/queueModel";

// Grade -> pill colors. A/B read green, C amber, D red, unscored grey.
const GRADE_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  B: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  D: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const STATUS_STYLES: Record<QueueRow["status"], string> = {
  new: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  scored: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  "needs review": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  approved: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  synced: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
};

function GradePill({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-zinc-400">-</span>;
  const style = GRADE_STYLES[grade] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${style}`}>
      {grade}
    </span>
  );
}

export function RankedQueue({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-12 text-center text-sm text-zinc-500">No contacts in this view.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <th className="w-12 px-4 py-3 font-medium">#</th>
          <th className="px-4 py-3 font-medium">Contact</th>
          <th className="px-4 py-3 font-medium">Company</th>
          <th className="w-24 px-4 py-3 text-right font-medium">Priority</th>
          <th className="w-20 px-4 py-3 text-center font-medium">Grade</th>
          <th className="w-32 px-4 py-3 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.contactId}
            className="border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
          >
            <td className="px-4 py-3 text-zinc-400 tabular-nums">{i + 1}</td>
            <td className="px-4 py-3 font-medium">
              <Link href={`/contacts/${row.contactId}`} className="hover:underline">
                {row.name}
              </Link>
            </td>
            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.company}</td>
            <td className="px-4 py-3 text-right tabular-nums">
              {row.priority === null ? <span className="text-zinc-400">-</span> : row.priority}
            </td>
            <td className="px-4 py-3 text-center">
              <GradePill grade={row.grade} />
            </td>
            <td className="px-4 py-3">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                {row.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
