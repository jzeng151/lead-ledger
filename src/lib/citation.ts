export function checkCitations(
  claims: { text: string; ref: string }[],
  dossier: Record<string, { source?: string } | undefined>,
  verificationRejected: Set<string>,
) {
  const kept: typeof claims = [];
  const stripped: string[] = [];
  for (const c of claims) {
    const field = dossier[c.ref];
    const ok = field && field.source && !verificationRejected.has(c.ref);
    if (ok) kept.push(c); else stripped.push(c.ref);
  }
  return { kept, stripped };
}
