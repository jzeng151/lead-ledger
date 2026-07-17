import { runContact } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 requires all dynamic segments sharing a path position to use one slug
// name, so this segment is `[id]` (here it carries the contactId; the sibling
// stream route reads the same slug as a runId).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const runId = `run-${contactId}-${Date.now()}`;
  // runContact creates the runs row + bus synchronously before its first await, so by the
  // time we return, the bus is live and early events are persisted. Fire-and-forget.
  runContact(runId, contactId).catch((e) => console.error("run failed", runId, e));
  return Response.json({ runId });
}
