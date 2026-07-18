"use client";

import { useState } from "react";

type WritebackScore = {
  priority: number;
  grade: string;
  rationale: string | null;
  nextStep: string | null;
  needsReview: boolean;
};

export function WritebackPanel({
  contactId,
  score,
  writebackStatus,
  onApproved,
}: {
  contactId: string;
  score: WritebackScore;
  /** Persisted decision for this contact, so a refresh does not offer the buttons again. */
  writebackStatus?: string | null;
  onApproved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // dryRun is null for a decision restored from the DB: the row records that the
  // write happened, not whether it went to HubSpot or was a dry run.
  const [result, setResult] = useState<{ dryRun: boolean | null } | null>(
    writebackStatus === "written" ? { dryRun: null } : null,
  );
  const [skipped, setSkipped] = useState(writebackStatus === "skipped");
  const [error, setError] = useState<string | null>(null);

  // Skip must be persisted, not local-only: otherwise the decision vanishes on
  // refresh and the contact keeps resurfacing as pending work.
  async function handleSkip() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/writeback/${contactId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });
      if (!res.ok) {
        setError("Could not save skip");
        return;
      }
      setSkipped(true);
      onApproved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/writeback/${contactId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Write-back failed");
        return;
      }
      setResult({ dryRun: data.dryRun });
      onApproved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Write to HubSpot</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          Human approval required
        </span>
      </div>
      <p className="mt-1 text-xs text-subtle">These properties are written to the contact on approve.</p>

      <div className="mt-3.5 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 font-mono text-xs leading-relaxed">
        <div className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">payload</span>
        </div>
        <div className="px-3.5 py-3 text-slate-300">
          <div>
            <span className="text-sky-400">lead_priority_score</span> <span className="text-slate-500">=</span>{" "}
            <span className="text-emerald-400">{score.priority}</span>
          </div>
          <div>
            <span className="text-sky-400">lead_grade</span> <span className="text-slate-500">=</span>{" "}
            <span className="text-amber-300">&quot;{score.grade}&quot;</span>
          </div>
          <div className="mt-1 text-slate-500">+ timeline note: rationale and next step</div>
        </div>
      </div>

      {score.needsReview ? (
        <p className="mt-3 text-xs text-[var(--tone-amber-fg)]">
          Flagged needs review. You can still approve it individually.
        </p>
      ) : null}

      {result ? (
        <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-[var(--tone-emerald-fg)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--tone-emerald-fg)]" />
          {result.dryRun === null ? "Written" : result.dryRun ? "Written (dry run)" : "Written to HubSpot"}
        </p>
      ) : skipped ? (
        <p className="mt-4 text-sm text-subtle">Skipped.</p>
      ) : (
        <div className="mt-4 flex items-center gap-2.5">
          <button onClick={handleApprove} disabled={busy} className="btn btn-primary">
            {busy ? "Writing..." : "Approve & write"}
          </button>
          <button onClick={handleSkip} disabled={busy} className="btn btn-ghost">
            Skip
          </button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-[var(--tone-rose-fg)]">{error}</p> : null}
    </div>
  );
}
