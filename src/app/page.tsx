"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { QueueRow } from "@/lib/queueModel";
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

  // Batch-approve clear A/B leads. Needs-review rows are filtered out client-side
  // (status !== "needs review") and 409-guarded server-side; any 409 is ignored.
  async function handleBatchApprove() {
    setApproving(true);
    try {
      const targets = rows.filter((r) => (r.grade === "A" || r.grade === "B") && r.status === "scored");
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
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Lead Ledger</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
              Tracepoint sells an observability API to funded software startups. Lead Ledger scores each
              HubSpot contact on fit and engagement so a rep works the best lead first, not the freshest.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/icp"
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Scoring settings
            </Link>
            <button
              onClick={handleBatchApprove}
              disabled={approving}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {approving ? "Approving..." : "Approve clear A/B leads"}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>
        </header>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="px-4 pt-2">
            <StatusTabs active={tab} counts={counts} onChange={setTab} />
          </div>
          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-zinc-500">Loading contacts...</p>
          ) : loadFailed ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-zinc-500">Could not load contacts.</p>
              <button
                onClick={loadContacts}
                className="mt-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Retry
              </button>
            </div>
          ) : (
            <RankedQueue rows={visible} />
          )}
        </div>
      </div>
    </div>
  );
}
