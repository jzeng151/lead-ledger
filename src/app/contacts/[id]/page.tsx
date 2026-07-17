"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ScoreBars } from "@/app/components/ScoreBars";
import { LiveView } from "@/app/components/LiveView";
import { WritebackPanel } from "@/app/components/WritebackPanel";
import { gradeTone } from "@/app/components/tones";

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
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-subtle">Loading contact...</p>
      </div>
    );
  }

  if (loadFailed && !detail) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <BackLink />
        <p className="mt-6 text-sm text-muted">Could not load this contact.</p>
        <button onClick={load} className="btn btn-ghost mt-3">
          Retry
        </button>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <BackLink />
        <p className="mt-6 text-sm text-muted">Contact not found.</p>
      </div>
    );
  }

  const { contact, score } = detail;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <BackLink />

      <header className="mt-4 mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{contact.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[contact.title, contact.companyName].filter(Boolean).join(" · ")}
          </p>
          {contact.email ? <p className="mt-0.5 text-sm text-subtle">{contact.email}</p> : null}
        </div>
        <button onClick={handleRun} disabled={starting} className="btn btn-primary shrink-0">
          {starting ? "Starting..." : activeRunId ? "Re-run pipeline" : "Run pipeline"}
        </button>
      </header>

      {score ? (
        <div className="flex flex-col gap-5">
          {score.needsReview ? (
            <div className="rounded-xl border border-[var(--tone-amber-ring)] bg-[var(--tone-amber-bg)] px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--tone-amber-fg)]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--tone-amber-fg)]" />
                Needs review
              </p>
              {score.reviewReasons && score.reviewReasons.length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-sm text-[var(--tone-amber-fg)]">
                  {score.reviewReasons.map((r, i) => (
                    <li key={i} className="rounded-md bg-[var(--tone-amber-bg)] px-2 py-0.5 ring-1 ring-inset ring-[var(--tone-amber-ring)]">
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="card p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4 sm:w-52 sm:shrink-0">
                <div>
                  <p className="eyebrow">Priority</p>
                  <p className="mt-0.5 text-5xl font-semibold leading-none tabular-nums text-fg">{score.priority}</p>
                </div>
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold ring-1 ring-inset ${gradeTone(
                    score.grade,
                  )}`}
                >
                  {score.grade}
                </span>
              </div>
              <div className="flex-1 sm:border-l sm:border-line sm:pl-6">
                <ScoreBars fit={score.fit} engagement={score.engagement} />
              </div>
            </div>
          </div>

          {score.rationale ? (
            <div className="card p-6">
              <h2 className="eyebrow">Rationale</h2>
              <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{score.rationale}</p>
              {score.citations && score.citations.length > 0 ? (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="eyebrow">Citations</p>
                  <ul className="mt-2.5 flex flex-col gap-2">
                    {score.citations.map((c, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-muted">
                        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
                          {c.ref}
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
            <div className="card border-l-2 border-l-accent p-6">
              <h2 className="eyebrow text-accent">Recommended next step</h2>
              <p className="mt-2.5 text-[15px] leading-relaxed text-fg">{score.nextStep}</p>
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
        <div className="card border-dashed px-4 py-14 text-center">
          <p className="text-sm text-subtle">Not scored yet. Run the pipeline to generate a score.</p>
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
          Live run
          <span className="text-xs font-normal text-subtle">the agentic research pipeline</span>
        </h2>
        {activeRunId ? (
          <LiveView runId={activeRunId} onDone={handleRunDone} />
        ) : (
          <div className="card border-dashed px-4 py-14 text-center">
            <p className="text-sm text-subtle">Not run yet. Click Run pipeline to start.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-fg"
    >
      <span aria-hidden>&larr;</span> Back to queue
    </Link>
  );
}
