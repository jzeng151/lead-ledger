import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { DEFAULT_ICP, type IcpConfig } from "@/lib/icp";
import { rescoreAll } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { icpConfig } = schema;

function readConfig(): IcpConfig {
  const row = db.select().from(icpConfig).where(eq(icpConfig.id, "default")).get();
  return (row?.config as IcpConfig) ?? DEFAULT_ICP;
}

export async function GET() {
  return Response.json(readConfig());
}

export async function PUT(req: Request) {
  // Lenient: ignore a malformed body or a non-object payload rather than 500.
  const body = await req.json().catch(() => ({}));
  const patch = body && typeof body === "object" ? (body as Partial<IcpConfig>) : {};

  // Merge over the stored config, one level deep for the object-valued sections.
  // A shallow merge would let a partial patch such as {"urgency":{"liftMax":10}}
  // replace the whole section, dropping urgency.weights and making every later
  // run and re-score throw when the scorer dereferences it.
  const current = readConfig();
  const nested = ["weights", "urgency", "grades", "headcount"] as const;
  const merged: IcpConfig = { ...current, ...patch };
  for (const k of nested) {
    const before = current[k] as Record<string, unknown> | undefined;
    const incoming = (patch as Record<string, unknown>)[k];
    if (before && incoming && typeof incoming === "object" && !Array.isArray(incoming))
      (merged as Record<string, unknown>)[k] = { ...before, ...(incoming as Record<string, unknown>) };
  }
  // urgency.weights is a level deeper again.
  if (current.urgency?.weights && (patch.urgency as { weights?: unknown } | undefined)?.weights)
    merged.urgency.weights = { ...current.urgency.weights, ...patch.urgency!.weights };

  db.insert(icpConfig)
    .values({ id: "default", config: merged })
    .onConflictDoUpdate({ target: icpConfig.id, set: { config: merged } })
    .run();

  // Re-score every stored run against the new dials, otherwise the queue keeps
  // serving verdicts computed under the old weights until each contact is
  // manually re-run. This replays the deterministic scorer over persisted
  // dossiers, so it costs no agent calls.
  // Response shape stays the bare config: the editor stores whatever it gets
  // back, so an extra field here would be persisted into the config on next save.
  rescoreAll(merged);

  return Response.json(merged);
}
