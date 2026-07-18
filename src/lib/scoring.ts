import type { IcpConfig } from "./icp";

// Axis values are validated at the schema boundary, but a re-score replays
// dossiers persisted before that guard existed, and a dossier with no icpFit at
// all yields undefined here. Coerce to a usable 0-1 so a stored bad value can
// never produce a fit outside the scale.
const axis = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

export function computeFit(icpFit: any, icp: IcpConfig) {
  const w = icp.weights;
  // Weights come from the ICP editor and are not required to sum to 1, so the
  // weighted sum is clamped too: fit is documented as 0-100 and feeds the grade
  // bands, and a weight set summing to 2 would otherwise persist a fit of 200.
  const raw = axis(
    axis(icpFit?.firmographic) * w.firmographic + axis(icpFit?.role) * w.role + axis(icpFit?.technographic) * w.technographic,
  );
  const disqualified = icpFit?.disqualified === true;
  return Math.round((disqualified ? Math.min(raw, 0.1) : raw) * 100);
}

// First-party intent (0-100) from recency-weighted engagement actions.
export function computeEngagement(e: any, icp: IcpConfig) {
  const weightOf = (a: string) => (a === "demo_request" ? 30 : a === "pricing_page_view" ? 20 : 8);
  const base = Math.min(100, (e?.topActions ?? []).reduce((s: number, a: string) => s + weightOf(a), 0));
  // A negative recencyDays (a future timestamp, or date math gone wrong upstream)
  // would make the decay multiplier greater than 1 and push engagement past 100.
  const months = Math.max(0, e?.recencyDays ?? 999) / 30;
  // Clamp the dial: the ICP editor accepts any number, and a decay above 1 makes
  // the base negative, which Math.pow turns into NaN for fractional months. That
  // NaN would then flow through engagement into priority.
  const perMonth = Math.min(1, Math.max(0, icp.engagementDecayPerMonth));
  const decay = Math.pow(1 - perMonth, months);
  return Math.max(0, Math.min(100, Math.round(base * decay)));
}

// Map the News subagent's free-form event `type` to a canonical trigger key that
// keys into icp.urgency.weights. Unmatched types fall through to "default".
export function classifyTrigger(type: string | undefined): string {
  const t = (type ?? "").toLowerCase();
  if (/down\s*round/.test(t)) return "down_round";
  if (/fund|raise|series|seed/.test(t)) return "funding";
  if (/layoff|reduction|\brif\b|headcount cut|job cut/.test(t)) return "layoffs";
  if (/hire|exec|\bvp\b|cto|chief|head of|leadership/.test(t)) return "exec_hire";
  if (/incident|outage|downtime|breach|postmortem/.test(t)) return "incident";
  if (/acqui|merger|m&a|acquired/.test(t)) return "mna";
  if (/launch|release|general availability|\bga\b|product/.test(t)) return "product_launch";
  if (/expand|expansion|new office|hiring/.test(t)) return "expansion";
  return "default";
}

// Signed timing in [-1, 1] from dated trigger events. Fresh events count fully;
// stale ones scale by staleFactor. Weights may be negative (distress signals),
// so a cold lead with only bad news lands below zero.
// How recent a dated trigger has to be to count as current.
const FRESH_DAYS = 90;

/**
 * Is this trigger current? The event's own date decides when it has one, since a
 * `fresh` flag is a claim made when the item was retrieved and does not age: a
 * dossier written months ago, or a fixture with a hardcoded flag, would keep
 * collecting the full urgency weight for news that is long past. The flag is the
 * fallback for an undated event.
 */
export function isFreshEvent(e: any, now = Date.now()): boolean {
  const t = Date.parse(e?.date ?? "");
  if (Number.isNaN(t)) return e?.fresh === true;
  return now - t <= FRESH_DAYS * 24 * 60 * 60 * 1000;
}

export function computeTiming(news: any, icp: IcpConfig): number {
  const events: any[] = news?.events ?? [];
  const weights = icp.urgency.weights;
  let sum = 0;
  for (const e of events) {
    const key = classifyTrigger(e?.type);
    const w = key in weights ? weights[key] : weights.default;
    sum += w * (isFreshEvent(e) ? 1 : icp.urgency.staleFactor);
  }
  return Math.max(-1, Math.min(1, sum));
}

export function score(d: any, icp: IcpConfig) {
  const u = icp.urgency;
  const fit = computeFit(d.icpFit, icp);
  const engagement = computeEngagement(d.engagement, icp); // 0-100 intent
  const timing = computeTiming(d.news, icp); // signed -1..1

  // Urgency lifts (or, for a negative trigger, dampens) the fit baseline. Intent
  // is always non-negative; only timing can push urgency below zero, floored so a
  // bad trigger nudges rather than overrides fit.
  const urgency = Math.max(u.floor, Math.min(1, timing + u.intentCoeff * (engagement / 100)));
  const priority = Math.max(0, Math.min(100, Math.round(fit + u.liftMax * urgency)));

  // Grade reflects fit only (US academic scale), so a great-fit cold lead is still
  // an A and lack of engagement never drags the letter down.
  // Cutoffs are four independent editor fields, so enforce the ordering the
  // first-match chain assumes. Saved as A:50 B:80, a fit of 60 would otherwise
  // match A and ship an inflated letter to the queue and to HubSpot.
  const g = icp.grades;
  const [dCut, cCut, bCut, aCut] = [g.A, g.B, g.C, g.D].sort((x, y) => x - y);
  const grade = fit >= aCut ? "A" : fit >= bCut ? "B" : fit >= cCut ? "C" : fit >= dCut ? "D" : "F";

  // Review reasons carry their specifics ("label: detail"), so the report shows
  // WHAT was wrong rather than a bare category the rep has to go digging for.
  const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n - 3).trimEnd() + "..." : s);
  const reasons: string[] = [];

  const contradictions: string[] = d.verification?.contradictions ?? [];
  if (contradictions.length) reasons.push("verification contradiction: " + clip(contradictions.join("; ")));

  const unsupported: number = d.verification?.unsupported ?? 0;
  if (unsupported >= 2) reasons.push(`unsupported claims: ${unsupported} claims were not backed by a cited source`);

  // Verification is the quality gate, so a run where it could not reach a verdict
  // on much of the dossier is not clean, it is unresolved. Uncertain claims are
  // not stripped (they were never rejected), so without this they leave no trace.
  const uncertain: number = d.verification?.uncertain ?? 0;
  if (uncertain >= 2) reasons.push(`unresolved verification: ${uncertain} claims could not be confirmed either way`);

  // Sort the band: the editor exposes the bounds as two independent fields, and
  // a reversed pair silently matches no priority at all, so every ambiguous lead
  // would skip review and become batch-approvable.
  const [bandLo, bandHi] = [...icp.reviewBand].sort((a, b) => a - b);
  if (priority >= bandLo && priority <= bandHi)
    reasons.push(`ambiguous score band: priority ${priority} sits in the ${bandLo}-${bandHi} review range`);

  if (d.identityUnverified)
    reasons.push("identity unverified: the contact could not be matched to a verified person at this domain");

  const conflicts: string[] = d.icpFit?.conflicts ?? [];
  if (conflicts.length >= 2) reasons.push("subagent conflict: " + clip(conflicts.join("; ")));

  if (d.engagement?.attributionUncertain)
    reasons.push("engagement attribution uncertain: activity could not be tied to the corporate domain");

  return {
    fit,
    engagement, // intent, 0-100
    timing: Math.round(timing * 100), // signed -100..100 for display/storage
    priority,
    grade,
    needsReview: reasons.length > 0,
    reviewReasons: reasons,
  };
}
