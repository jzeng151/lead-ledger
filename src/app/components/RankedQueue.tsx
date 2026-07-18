import Link from "next/link";
import type { QueueRow } from "@/lib/queueModel";
import { gradeTone, STATUS_TONE, TONE } from "./tones";

function GradePill({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-subtle">-</span>;
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${gradeTone(grade)}`}
    >
      {grade}
    </span>
  );
}

export function RankedQueue({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-subtle">No contacts in this view.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
          <th className="w-12 px-4 py-2.5 font-semibold">#</th>
          <th className="px-4 py-2.5 font-semibold">Contact</th>
          <th className="px-4 py-2.5 font-semibold">Company</th>
          <th className="w-24 px-4 py-2.5 text-right font-semibold">Priority</th>
          <th className="w-16 px-4 py-2.5 text-right font-semibold">Fit</th>
          <th className="w-20 px-4 py-2.5 text-center font-semibold">Grade</th>
          <th className="w-32 px-4 py-2.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.contactId}
            className="group border-b border-line transition-colors last:border-0 hover:bg-surface-2/60"
          >
            <td className="px-4 py-3 tabular-nums text-subtle">{i + 1}</td>
            <td className="px-4 py-3 font-medium text-fg">
              <Link href={`/contacts/${row.contactId}`} className="transition-colors group-hover:text-accent">
                {row.name}
              </Link>
            </td>
            <td className="px-4 py-3 text-muted">{row.company}</td>
            <td className="px-4 py-3 text-right text-base font-semibold tabular-nums text-fg">
              {row.priority === null ? <span className="font-normal text-subtle">-</span> : row.priority}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-muted">
              {row.fit === null ? <span className="text-subtle">-</span> : row.fit}
            </td>
            <td className="px-4 py-3 text-center">
              <GradePill grade={row.grade} />
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[row.status] ?? TONE.slate}`}
              >
                {row.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
