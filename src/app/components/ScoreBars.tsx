// Two labeled 0-100 bars for a contact's fit and engagement subscores. Purely
// presentational; used on the contact detail page.
export function ScoreBars({ fit, engagement }: { fit: number; engagement: number }) {
  const bars = [
    { label: "Fit", value: fit },
    { label: "Engagement", value: engagement },
  ];
  return (
    <div className="flex flex-col gap-3">
      {bars.map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span>{label}</span>
            <span className="tabular-nums">{Math.round(value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
