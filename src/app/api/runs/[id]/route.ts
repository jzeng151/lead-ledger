import { after } from "next/server";

import { runContact } from "@/lib/agents/orchestrator";
import { activeRunForContact } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 requires all dynamic segments sharing a path position to use one slug
// name, so this segment is `[id]` (here it carries the contactId; the sibling
// stream route reads the same slug as a runId).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;

  // Re-run is re-enabled as soon as this POST returns, so a second click while the
  // pipeline is still going would queue a duplicate run for the same contact:
  // wasted Anthropic calls plus two runs racing to write the same score row. Hand
  // back the run already in flight instead.
  const running = activeRunForContact(contactId);
  if (running) return Response.json({ runId: running, alreadyRunning: true });

  const runId = `run-${contactId}-${Date.now()}`;
  // Start it now, do not defer the call: runContact creates the runs row and the
  // bus synchronously before its first await, and the contact page opens the
  // stream for this runId the moment this responds. Deferring the whole call
  // meant the stream found no row and no bus and immediately ended, and a second
  // quick POST slipped past the active-run guard.
  const started = runContact(runId, contactId).catch((e) => console.error("run failed", runId, e));
  // after() keeps the already-started work tied to the route lifecycle, so a host
  // that freezes the instance once the response is sent cannot strand the run.
  after(() => started);
  return Response.json({ runId });
}
