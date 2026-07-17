import { db, schema } from "@/db";

const { writebacks } = schema;

export type WritebackPayload = {
  properties: { lead_priority_score: number; lead_grade: string };
  note: string;
};

type ScoreInput = {
  priority: number;
  grade: string;
  rationale: string | null;
  nextStep: string | null;
};

/**
 * Build the HubSpot write-back payload: two custom properties plus a timeline
 * note that is the rationale followed by the recommended next step.
 */
export function buildPayload(score: ScoreInput): WritebackPayload {
  const note = (score.rationale ?? "") + (score.nextStep ? "\n\nNext step: " + score.nextStep : "");
  return {
    properties: { lead_priority_score: score.priority, lead_grade: score.grade },
    note,
  };
}

/**
 * Apply an approved write-back for one contact. With a HUBSPOT_TOKEN set this
 * PATCHes the contact's custom properties and POSTs a note engagement associated
 * to the contact; any non-2xx throws. Without a token it is a dry run: the
 * payload is logged and no network calls are made. Either way the `writebacks`
 * row is upserted to "written" (approvedAt and writtenAt both now).
 */
export async function applyWriteback(
  contactId: string,
  score: ScoreInput,
): Promise<{ status: "written"; payload: WritebackPayload; dryRun: boolean }> {
  const payload = buildPayload(score);
  const token = process.env.HUBSPOT_TOKEN;
  const dryRun = !token;

  if (token) {
    const patchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: payload.properties }),
    });
    if (!patchRes.ok) throw new Error(`HubSpot contact PATCH ${patchRes.status}`);

    const noteRes = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { hs_note_body: payload.note, hs_timestamp: Date.now() },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
          },
        ],
      }),
    });
    if (!noteRes.ok) throw new Error(`HubSpot note POST ${noteRes.status}`);
  } else {
    console.log("[writeback dry-run]", contactId, JSON.stringify(payload));
  }

  const now = new Date();
  db.insert(writebacks)
    .values({ contactId, status: "written", payload, approvedAt: now, writtenAt: now })
    .onConflictDoUpdate({
      target: writebacks.contactId,
      set: { status: "written", payload, approvedAt: now, writtenAt: now },
    })
    .run();

  return { status: "written", payload, dryRun };
}
