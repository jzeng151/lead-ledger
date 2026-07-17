import type { QueueRow } from "@/lib/queueModel";

export const TABS = ["All", "Needs review", "Approved", "Synced"] as const;
export type Tab = (typeof TABS)[number];

// Maps a tab to the row status it filters on. "All" has no filter.
const TAB_STATUS: Record<Tab, QueueRow["status"] | null> = {
  All: null,
  "Needs review": "needs review",
  Approved: "approved",
  Synced: "synced",
};

export function tabMatches(tab: Tab, row: QueueRow): boolean {
  const status = TAB_STATUS[tab];
  return status === null || row.status === status;
}

export function StatusTabs({
  active,
  counts,
  onChange,
}: {
  active: Tab;
  counts: Record<Tab, number>;
  onChange: (tab: Tab) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === tab
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
          }`}
        >
          {tab}
          <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {counts[tab]}
          </span>
        </button>
      ))}
    </div>
  );
}
