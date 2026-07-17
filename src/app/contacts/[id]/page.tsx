"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ScoreBars } from "@/app/components/ScoreBars";
import { LiveView } from "@/app/components/LiveView";
import { WritebackPanel } from "@/app/components/WritebackPanel";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
};

type Citation = { text: string; ref: string };

type Score = {
  fit: number;
  engagement: number;
  priority: number;
  grade: string;
  needsReview: boolean;
  reviewReasons: string[] | null;
  rationale: string | null;
  nextStep: string | null;
  citations: Citation[] | null;
};

type Detail = { contact: Contact; score: Score | null; latestRunId: string | null };

const GRADE_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  B: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  D: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // The run shown in the live view. Seeded from the contact's latest run so the
  // view replays it on load; a Run/Re-run swaps in the new (live) run id.
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(`contact request failed: ${res.status}`);
      const data = (await res.json()) as Detail;
      setDetail(data);
      // Seed the live view from the latest run only when nothing is selected yet;
      // never clobber a run the user just started (a refetch mid-run would return
      // an older latestRunId until the new run scores).
      setActiveRunId((prev) => prev ?? data.latestRunId ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRun() {
    setStarting(true);
    try {
      const res = await fetch(`/api/runs/${id}`, { method: "POST" });
      const { runId: newRunId } = (await res.json()) as { runId: string };
      setActiveRunId(newRunId);
    } finally {
      setStarting(false);
    }
  }

  // When the live run reaches a terminal event, pull the fresh score/rationale.
  const handleRunDone = useCallback(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-full bg-zinc-50 dark:bg-black">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <p className="text-sm text-zinc-500">Loading contact...</p>
        </div>
      </div>
    );
  }

  if (loadFailed && !detail) {
    return (
      <div className="min-h-full bg-zinc-50 dark:bg-black">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            &larr; Back to queue
          </Link>
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Could not load this contact.</p>
          <button
            onClick={load}
            className="mt-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="min-h-full bg-zinc-50 dark:bg-black">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            &larr; Back to queue
          </Link>
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Contact not found.</p>
        </div>
      </div>
    );
  }

  const { contact, score } = detail;

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to queue
        </Link>

        <header className="mt-4 mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{contact.name}</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {[contact.title, contact.companyName].filter(Boolean).join(" - ")}
            </p>
            {contact.email ? <p className="mt-0.5 text-sm text-zinc-500">{contact.email}</p> : null}
          </div>
          <button
            onClick={handleRun}
            disabled={starting}
            className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {starting ? "Starting..." : activeRunId ? "Re-run" : "Run"}
          </button>
        </header>

        {score ? (
          <div className="flex flex-col gap-6">
            {score.needsReview ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Needs review</p>
                {score.reviewReasons && score.reviewReasons.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-200/90">
                    {score.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-sm text-zinc-500">Priority</span>
                  <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {score.priority}
                  </span>
                </div>
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                    GRADE_STYLES[score.grade] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {score.grade}
                </span>
              </div>
              <div className="mt-5">
                <ScoreBars fit={score.fit} engagement={score.engagement} />
              </div>
            </div>

            {score.rationale ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rationale</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {score.rationale}
                </p>
                {score.citations && score.citations.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Citations</p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {score.citations.map((c, i) => (
                        <li key={i} className="flex gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            [{c.ref}]
                          </span>
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {score.nextStep ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recommended next step</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{score.nextStep}</p>
              </div>
            ) : null}

            <WritebackPanel
              contactId={contact.id}
              score={{
                priority: score.priority,
                grade: score.grade,
                rationale: score.rationale,
                nextStep: score.nextStep,
                needsReview: score.needsReview,
              }}
              onApproved={load}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-sm text-zinc-500">Not scored yet. Run the pipeline to generate a score.</p>
          </div>
        )}

        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live run</h2>
          {activeRunId ? (
            <LiveView runId={activeRunId} onDone={handleRunDone} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <p className="text-sm text-zinc-500">Not run yet. Click Run to start the pipeline.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
