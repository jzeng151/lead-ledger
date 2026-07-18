import type { IcpConfig } from "./icp";

export function computeFit(icpFit: any, icp: IcpConfig) {
  const w = icp.weights;
  const raw = icpFit.firmographic * w.firmographic + icpFit.role * w.role + icpFit.technographic * w.technographic;
  const disqualified = icpFit.disqualified === true;
  return Math.round((disqualified ? Math.min(raw, 0.1) : raw) * 100);
}

// First-party intent (0-100) from recency-weighted engagement actions.
export function computeEngagement(e: any, icp: IcpConfig) {
  const weightOf = (a: string) => (a === "demo_request" ? 30 : a === "pricing_page_view" ? 20 : 8);
  const base = Math.min(100, (e?.topActions ?? []).reduce((s: number, a: string) => s + weightOf(a), 0));
  const months = (e?.recencyDays ?? 999) / 30;
  const decay = Math.pow(1 - icp.engagementDecayPerMonth, months);
  return Math.round(base * decay);
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
export function computeTiming(news: any, icp: IcpConfig): number {
  const events: any[] = news?.events ?? [];
  const weights = icp.urgency.weights;
  let sum = 0;
  for (const e of events) {
    const key = classifyTrigger(e?.type);
    const w = key in weights ? weights[key] : weights.default;
    sum += w * (e?.fresh === true ? 1 : icp.urgency.staleFactor);
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
  const g = icp.grades;
  const grade = fit >= g.A ? "A" : fit >= g.B ? "B" : fit >= g.C ? "C" : fit >= g.D ? "D" : "F";

  // Review reasons carry their specifics ("label: detail"), so the report shows
  // WHAT was wrong rather than a bare category the rep has to go digging for.
  const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n - 3).trimEnd() + "..." : s);
  const reasons: string[] = [];

  const contradictions: string[] = d.verification?.contradictions ?? [];
  if (contradictions.length) reasons.push("verification contradiction: " + clip(contradictions.join("; ")));

  const unsupported: number = d.verification?.unsupported ?? 0;
  if (unsupported >= 2) reasons.push(`unsupported claims: ${unsupported} claims were not backed by a cited source`);

  if (priority >= icp.reviewBand[0] && priority <= icp.reviewBand[1])
    reasons.push(`ambiguous score band: priority ${priority} sits in the ${icp.reviewBand[0]}-${icp.reviewBand[1]} review range`);

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
