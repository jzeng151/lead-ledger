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
  onApproved,
}: {
  contactId: string;
  score: WritebackScore;
  onApproved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ dryRun: boolean } | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Write to HubSpot</h2>
      <p className="mt-1 text-xs text-zinc-500">Will write to HubSpot on approve.</p>

      <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        <div>lead_priority_score = {score.priority}</div>
        <div>lead_grade = &quot;{score.grade}&quot;</div>
        <div className="mt-1 text-zinc-500">+ timeline note: rationale and next step</div>
      </div>

      {score.needsReview ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          Flagged needs review. You can still approve it individually.
        </p>
      ) : null}

      {result ? (
        <p className="mt-4 text-sm font-medium text-green-700 dark:text-green-400">
          {result.dryRun ? "Written (dry run)" : "Written to HubSpot"}
        </p>
      ) : skipped ? (
        <p className="mt-4 text-sm text-zinc-500">Skipped.</p>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleApprove}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {busy ? "Writing..." : "Approve & write"}
          </button>
          <button
            onClick={() => setSkipped(true)}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Skip
          </button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
