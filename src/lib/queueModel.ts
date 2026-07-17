// Pure, testable ranking logic for the dashboard queue. No DB, no React: it
// turns the three raw record sets (contacts, latest score per contact, latest
// writeback per contact) into an ordered list of rows the table renders. Kept
// side-effect free so the status derivation and ranking are unit-tested without
// a database.

export type QueueRow = {
  contactId: string;
  name: string;
  company: string;
  priority: number | null;
  grade: string | null;
  status: "new" | "scored" | "needs review" | "approved" | "synced";
};

/**
 * Derive one contact's status. Precedence (highest first):
 *   - no score               -> "new"
 *   - writeback "written"     -> "synced"
 *   - writeback "approved"    -> "approved"
 *   - score.needsReview       -> "needs review"
 *   - otherwise               -> "scored"
 */
function deriveStatus(
  score: { needsReview: boolean } | undefined,
  writeback: { status: string } | undefined,
): QueueRow["status"] {
  if (!score) return "new";
  if (writeback?.status === "written") return "synced";
  if (writeback?.status === "approved") return "approved";
  if (score.needsReview) return "needs review";
  return "scored";
}

/**
 * Build the ranked queue. Rows are sorted by priority descending; contacts with
 * no score yet (null priority, "new") sort last. The sort is stable, so contacts
 * that tie on priority (and all "new" contacts) keep their input order.
 */
export function buildQueue(
  contacts: { id: string; name: string; companyName: string | null }[],
  latestScoreByContact: Record<string, { priority: number; grade: string; needsReview: boolean } | undefined>,
  writebackByContact: Record<string, { status: string } | undefined>,
): QueueRow[] {
  const rows: QueueRow[] = contacts.map((c) => {
    const score = latestScoreByContact[c.id];
    return {
      contactId: c.id,
      name: c.name,
      company: c.companyName ?? "",
      priority: score ? score.priority : null,
      grade: score ? score.grade : null,
      status: deriveStatus(score, writebackByContact[c.id]),
    };
  });

  return rows.sort((a, b) => {
    if (a.priority === null && b.priority === null) return 0;
    if (a.priority === null) return 1; // new contacts last
    if (b.priority === null) return -1;
    return b.priority - a.priority; // highest priority first
  });
}
