// Three subscores for a contact. Fit and Intent are 0-100 bars; Timing is a
// signed news-trigger signal (-100..100) shown as a diverging bar from center,
// green when a trigger lifts priority, rose when it dampens (e.g. layoffs).
export function ScoreBars({ fit, timing, intent }: { fit: number; timing: number; intent: number }) {
  return (
    <div className="flex flex-col gap-4">
      <Bar label="Fit" value={fit} fill="bg-gradient-to-r from-accent to-accent-hover" />
      <TimingBar value={timing} />
      <Bar label="Intent" value={intent} fill="bg-[var(--tone-sky-fg)]" />
    </div>
  );
}

function Bar({ label, value, fill }: { label: string; value: number; fill: string }) {
  return (
    <div className="flex flex-col gap-1.5">
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
  );
}

function TimingBar({ value }: { value: number }) {
  const v = Math.max(-100, Math.min(100, Math.round(value)));
  const magnitude = (Math.abs(v) / 100) * 50; // 0-50% of the track width
  const positive = v >= 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">Timing</span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            v > 0 ? "text-[var(--tone-emerald-fg)]" : v < 0 ? "text-[var(--tone-rose-fg)]" : "text-subtle"
          }`}
        >
          {v > 0 ? `+${v}` : v}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-surface-2">
        {/* center tick */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line" />
        <div
          className={`absolute top-0 h-full rounded-full transition-all duration-500 ${
            positive ? "bg-[var(--tone-emerald-fg)]" : "bg-[var(--tone-rose-fg)]"
          }`}
          style={{ left: positive ? "50%" : `${50 - magnitude}%`, width: `${magnitude}%` }}
        />
      </div>
    </div>
  );
}
