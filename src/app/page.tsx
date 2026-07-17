"use client";

import { useEffect, useMemo, useState } from "react";
import { isBatchApprovable, type QueueRow } from "@/lib/queueModel";
import { RankedQueue } from "./components/RankedQueue";
import { StatusTabs, TABS, tabMatches, type Tab } from "./components/StatusTabs";

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
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
            Tracepoint sells an observability API to funded software startups. Every HubSpot contact is scored
            on fit and engagement so a rep works the best lead first, not the freshest.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button onClick={handleBatchApprove} disabled={approving} className="btn btn-ghost">
            {approving ? "Approving..." : "Approve scored"}
          </button>
          <button onClick={handleSync} disabled={syncing} className="btn btn-primary">
            {syncing ? "Syncing..." : "Sync contacts"}
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
