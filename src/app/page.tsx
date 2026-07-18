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
  const [approving, setApproving] = useState(false);
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

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      await loadContacts();
    } finally {
      setSyncing(false);
    }
  }

  // Batch-approve every scored lead that is not flagged for review, regardless of
  // grade (see isBatchApprovable). The server also 409-guards needs-review as a
  // backstop; any such 409 is ignored below.
  async function handleBatchApprove() {
    setApproving(true);
    try {
      const targets = rows.filter(isBatchApprovable);
      await Promise.all(
        targets.map((r) =>
          fetch(`/api/writeback/${r.contactId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ batch: true }),
          }).catch(() => {}),
        ),
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
          <button onClick={handleSync} disabled={syncing} className="btn btn-primary">
            {syncing ? (
              <>
                <Spinner /> Syncing...
              </>
            ) : (
              "Sync contacts"
            )}
          </button>
        </div>
      </header>

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
