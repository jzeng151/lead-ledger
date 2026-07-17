import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { DEFAULT_ICP, type IcpConfig } from "@/lib/icp";

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

  return Response.json(merged);
}
