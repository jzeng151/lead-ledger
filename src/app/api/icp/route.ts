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

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** The fields the scorer dereferences. Returns a message, or null when usable. */
function validateIcp(c: IcpConfig): string | null {
  const w = c.weights;
  if (!w || !num(w.firmographic) || !num(w.role) || !num(w.technographic)) return "weights must be three numbers";
  if (!num(c.engagementDecayPerMonth)) return "engagementDecayPerMonth must be a number";
  if (!Array.isArray(c.reviewBand) || c.reviewBand.length !== 2 || !c.reviewBand.every(num))
    return "reviewBand must be two numbers";

  const g = c.grades;
  if (!g || !num(g.A) || !num(g.B) || !num(g.C) || !num(g.D)) return "grades must be numbers for A, B, C and D";

  const u = c.urgency;
  if (!u || !num(u.liftMax) || !num(u.floor) || !num(u.intentCoeff) || !num(u.staleFactor))
    return "urgency needs numeric liftMax, floor, intentCoeff and staleFactor";
  if (!u.weights || typeof u.weights !== "object" || !num(u.weights.default))
    return "urgency.weights must be an object with a numeric default";
  return null;
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

  // Validate before writing. rescoreAll() below dereferences these, so an invalid
  // patch ({"weights":null}, {"reviewBand":"off"}) would persist a config that
  // every later run and the editor then load as if it were valid.
  const invalid = validateIcp(merged);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

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
