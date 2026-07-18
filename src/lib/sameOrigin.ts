/**
 * Reject a state-changing request that did not come from this app.
 *
 * These routes spend provider quota and write to a customer's CRM, and they
 * parse their bodies leniently, so a cross-site form post (which carries no
 * JSON content type and no custom headers) would otherwise reach them as an
 * ordinary in-app action. Returns a Response to send back, or null to proceed.
 *
 * Both headers are absent on a same-process fetch, which is why neither is
 * required: only a value that positively identifies another origin is rejected.
 */
export function rejectCrossSite(req: Request): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "cross-site request" }, { status: 403 });

  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host !== new URL(req.url).host)
      return Response.json({ error: "cross-origin request" }, { status: 403 });
  } catch {
    return Response.json({ error: "bad origin" }, { status: 403 });
  }
  return null;
}
