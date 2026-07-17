import type { IcpConfig } from "./icp";

export function computeFit(icpFit: any, icp: IcpConfig) {
  const w = icp.weights;
  const raw = icpFit.firmographic * w.firmographic + icpFit.role * w.role + icpFit.technographic * w.technographic;
  const disqualified = (icpFit.conflicts ?? []).some((c: string) => icp.disqualifiers.some((d) => c.includes(d.split(" ")[0])));
  return Math.round((disqualified ? Math.min(raw, 0.1) : raw) * 100);
}

export function computeEngagement(e: any, icp: IcpConfig) {
  const weightOf = (a: string) => (a === "demo_request" ? 30 : a === "pricing_page_view" ? 20 : 8);
  const base = Math.min(100, (e.topActions ?? []).reduce((s: number, a: string) => s + weightOf(a), 0));
  const months = e.recencyDays / 30;
  const decay = Math.pow(1 - icp.engagementDecayPerMonth, months);
  return Math.round(base * decay);
}

export function score(d: any, icp: IcpConfig) {
  const fit = computeFit(d.icpFit, icp);
  const engagement = computeEngagement(d.engagement, icp);
  const priority = Math.round(icp.blend.fit * fit + icp.blend.engagement * engagement);
  const grade = priority >= 75 ? "A" : priority >= 55 ? "B" : priority >= 35 ? "C" : "D";
  const reasons: string[] = [];
  if ((d.verification?.contradictions ?? []).length) reasons.push("verification contradiction");
  if ((d.verification?.unsupported ?? 0) >= 2) reasons.push("unsupported claims");
  if (priority >= icp.reviewBand[0] && priority <= icp.reviewBand[1]) reasons.push("ambiguous score band");
  if (d.identityUnverified) reasons.push("identity unverified");
  if ((d.icpFit?.conflicts ?? []).length >= 2) reasons.push("subagent conflict");
  return { fit, engagement, priority, grade, needsReview: reasons.length > 0, reviewReasons: reasons };
}
