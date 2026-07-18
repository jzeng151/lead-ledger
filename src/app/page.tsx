"use client";

import { useEffect, useMemo, useState } from "react";
import { isBatchApprovable, type QueueRow } from "@/lib/queueModel";
import { RankedQueue } from "./components/RankedQueue";
import { StatusTabs, TABS, tabMatches, type Tab } from "./components/StatusTabs";

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Count of in-flight scoring runs (from any trigger). Drives the dashboard
  // auto-refresh and the Sync button's disabled + progress state.
  const [activeRuns, setActiveRuns] = useState(0);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("All");

  async function loadContacts() {
    try {
      const res = await fetch("/api/contacts");
      if (!res.ok) throw new Error(`contacts request failed: ${res.status}`);
      setRows(await res.json());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  // Fully reactive: subscribe to the activity SSE stream. The server pushes the
  // in-flight run count on connect and on every run lifecycle transition (a sync
  // here, or a "Run" from a contact page); each push updates the button state and
  // refreshes the queue, so scores appear the moment a review finishes. No polling.
  useEffect(() => {
    let alive = true;
    const es = new EventSource("/api/activity/stream");
    es.onmessage = async (m) => {
      try {
        const { running } = JSON.parse(m.data) as { running: number };
        if (!alive) return;
        setActiveRuns(running);
        const c = await fetch("/api/contacts");
        if (alive && c.ok) setRows(await c.json());
      } catch {
        /* ignore a malformed frame */
      }
    };
    // A dropped stream auto-reconnects (EventSource default), which re-sends the
    // snapshot, so there is nothing to handle on error.
    return () => {
      alive = false;
      es.close();
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      await loadContacts();
      // The sync returns after the pull; scoring runs fire in the background. The
      // activity poll above keeps the queue and the button's scoring state current.
    } finally {
      setSyncing(false);
    }
  }

  // Batch-approve every scored lead that is not flagged for review, regardless of
  // grade (see isBatchApprovable). The server also 409-guards needs-review as a
  // backstop; any such 409 is ignored below.
  async function handleBatchApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const targets = rows.filter(isBatchApprovable);
      // fetch resolves on a 4xx/5xx, so a rejected HubSpot write is only visible
      // through res.ok. Without this check the batch reports success while some
      // contacts were never written. A 409 is the server's needs-review guard
      // doing its job, not a failure.
      const results = await Promise.all(
        targets.map(async (r) => {
          try {
            const res = await fetch(`/api/writeback/${r.contactId}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ batch: true }),
            });
            return res.ok || res.status === 409 ? null : r.name;
          } catch {
            return r.name;
          }
        }),
      );
      const failed = results.filter((n): n is string => n !== null);
      if (failed.length)
        setApproveError(
          `${failed.length} write-back${failed.length > 1 ? "s" : ""} failed: ` +
            failed.slice(0, 3).join(", ") +
            (failed.length > 3 ? `, +${failed.length - 3} more` : ""),
        );
      await loadContacts();
    } finally {
      setApproving(false);
    }
  }

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t, rows.filter((r) => tabMatches(t, r)).length])) as Record<Tab, number>,
    [rows],
  );
  const visible = useMemo(() => rows.filter((r) => tabMatches(tab, r)), [rows, tab]);
  const unscored = useMemo(() => rows.filter((r) => r.status === "new").length, [rows]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Prioritization queue</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button onClick={handleBatchApprove} disabled={approving} className="btn btn-ghost">
            {approving ? (
              <>
                <Spinner /> Approving...
              </>
            ) : (
              "Approve scored"
            )}
          </button>
          <button onClick={handleSync} disabled={syncing || activeRuns > 0} className="btn btn-primary">
            {syncing ? (
              <>
                <Spinner /> Syncing...
              </>
            ) : activeRuns > 0 ? (
              <>
                <Spinner /> Scoring{unscored > 0 ? ` ${unscored} left` : ""}...
              </>
            ) : (
              "Sync contacts"
            )}
          </button>
        </div>
      </header>

      {approveError ? <p className="mb-4 text-sm text-[var(--tone-rose-fg)]">{approveError}</p> : null}

      <div className="card overflow-hidden">
        <div className="px-3 pt-2">
          <StatusTabs active={tab} counts={counts} onChange={setTab} />
        </div>
        {loading ? (
          <p className="px-4 py-16 text-center text-sm text-subtle">Loading contacts...</p>
        ) : loadFailed ? (
          <div className="px-4 py-16 text-center">
            <p className="text-sm text-muted">Could not load contacts.</p>
            <button onClick={loadContacts} className="btn btn-ghost mt-3">
              Retry
            </button>
          </div>
        ) : (
          <RankedQueue rows={visible} />
        )}
      </div>
    </div>
  );
}
