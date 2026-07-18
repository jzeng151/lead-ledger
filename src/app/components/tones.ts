// Semantic status tones. Each resolves to per-theme CSS variables (defined in
// globals.css) so a grade pill or status chip reads correctly on the light SaaS
// theme and on both dark themes without per-component conditionals. Apply with
// `ring-1 ring-inset` alongside the tone.
export const TONE = {
  slate: "bg-[var(--tone-slate-bg)] text-[var(--tone-slate-fg)] ring-[var(--tone-slate-ring)]",
  emerald: "bg-[var(--tone-emerald-bg)] text-[var(--tone-emerald-fg)] ring-[var(--tone-emerald-ring)]",
  sky: "bg-[var(--tone-sky-bg)] text-[var(--tone-sky-fg)] ring-[var(--tone-sky-ring)]",
  amber: "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)] ring-[var(--tone-amber-ring)]",
  orange: "bg-[var(--tone-orange-bg)] text-[var(--tone-orange-fg)] ring-[var(--tone-orange-ring)]",
  rose: "bg-[var(--tone-rose-bg)] text-[var(--tone-rose-fg)] ring-[var(--tone-rose-ring)]",
  accent: "bg-[var(--tone-accent-bg)] text-[var(--tone-accent-fg)] ring-[var(--tone-accent-ring)]",
} as const;

// US academic grades: A emerald, B sky, C amber, D orange, F rose.
const GRADE_TONE: Record<string, keyof typeof TONE> = { A: "emerald", B: "sky", C: "amber", D: "orange", F: "rose" };

export function gradeTone(grade: string | null): string {
  return TONE[GRADE_TONE[grade ?? ""] ?? "slate"];
}

// Row status -> tone. new slate, scored accent, needs review amber,
// approved/synced green.
export const STATUS_TONE: Record<string, string> = {
  new: TONE.slate,
  scored: TONE.accent,
  "needs review": TONE.amber,
  approved: TONE.emerald,
  synced: TONE.emerald,
};
