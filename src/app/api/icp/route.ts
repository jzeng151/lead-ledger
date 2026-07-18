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

  // Shallow merge over the stored config. Nested keys (weights/blend/reviewBand)
  // are replaced wholesale, which is what the editor sends.
  const merged: IcpConfig = { ...readConfig(), ...patch };

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
