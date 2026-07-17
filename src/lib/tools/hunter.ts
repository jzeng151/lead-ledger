import { pickImpl, loadFixture, type FieldVal } from "./adapter";

function domainOf(email: string): string {
  return email.split("@")[1] ?? "";
}

async function realVerify(email: string): Promise<{ verified: FieldVal<boolean>; confidence: number }> {
  const res = await fetch(
    `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${process.env.HUNTER_API_KEY}`,
  );
  if (!res.ok) throw new Error(`Hunter ${res.status}`);
  const d = await res.json();
  const status: string | undefined = d.data?.status;
  const confidence = typeof d.data?.score === "number" ? d.data.score / 100 : 0;
  return {
    verified: { value: status ? status === "valid" : null, confidence, source: "hunter.io" },
    confidence,
  };
}
async function mockVerify(email: string): Promise<{ verified: FieldVal<boolean>; confidence: number }> {
  const v = loadFixture(domainOf(email)).person?.emailVerified ?? null;
  const confidence = v === null ? 0 : 0.9;
  return {
    verified: { value: v, confidence, source: "fixture:hunter" },
    confidence,
  };
}

export const hunterVerifyEmail = pickImpl(process.env.HUNTER_API_KEY, realVerify, mockVerify);
