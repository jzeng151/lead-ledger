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
    <div className="flex gap-1 border-b border-line">
      {TABS.map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            aria-current={isActive ? "true" : undefined}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              isActive ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {tab}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                isActive ? "bg-accent-soft text-on-accent-soft" : "bg-surface-2 text-muted"
              }`}
            >
              {counts[tab]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
