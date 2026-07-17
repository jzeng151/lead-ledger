// Two labeled 0-100 bars for a contact's fit and engagement subscores. Purely
// presentational; used on the contact detail page. Fit reads brand indigo,
// engagement sky, so the two axes are distinguishable at a glance.
export function ScoreBars({ fit, engagement }: { fit: number; engagement: number }) {
  const bars = [
    { label: "Fit", value: fit, fill: "bg-gradient-to-r from-accent to-accent-hover" },
    { label: "Engagement", value: engagement, fill: "bg-[var(--tone-sky-fg)]" },
  ];
  return (
    <div className="flex flex-col gap-4">
      {bars.map(({ label, value, fill }) => (
        <div key={label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted">{label}</span>
            <span className="text-sm font-semibold tabular-nums text-fg">{Math.round(value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${fill} transition-[width] duration-500`}
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
