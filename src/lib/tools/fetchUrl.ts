import { fetchWithTimeout } from "./adapter";

/**
 * Is this a URL we are willing to fetch server-side?
 *
 * With LEAD_LEDGER_LIVE_TOOLS=1 the URL reaching fetchUrl is model-supplied, and
 * the model reads CRM data and page text that an attacker can influence. Without
 * this check a prompt injection can point the fetch at loopback, the private
 * network, or the cloud metadata endpoint (169.254.169.254) and feed the response
 * straight back into the model. Only public http(s) targets are allowed.
 *
 * This is a literal-host check, not a DNS resolution: it does not defeat a
 * hostname that resolves to a private address. Adequate here because the hard
 * guarantees are elsewhere (deterministic scoring, human-approved write-back).
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;

  // Decode an IPv4-mapped IPv6 literal to its IPv4 form, in both the dotted
  // (::ffff:127.0.0.1) and hex (::ffff:7f00:1) spellings, so the IPv4 range
  // checks below actually see it. Without this, loopback and private addresses
  // reach the network through the mapped spelling.
  const mapped = host.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const rest = mapped[1];
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      host = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
    } else {
      host = rest;
    }
  }
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;

  // IPv6 loopback, link-local, unique-local.
  if (host === "::1" || host === "::") return false;
  if (/^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) return false;

  // IPv4 loopback, private ranges, link-local (which covers cloud metadata).
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

// Enough of a page for the fingerprints and the https-liveness check, without
// letting a huge or attacker-controlled response consume server memory and model
// context. res.text() would buffer the whole body first, so read the stream and
// stop at the cap.
const MAX_BYTES = 512 * 1024;

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

// Keyless: returns page text, or "" on any failure so callers can fall back deterministically.
export async function fetchUrl(url: string): Promise<string> {
  if (!isPublicHttpUrl(url)) return "";
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return "";
    return await readCapped(res);
  } catch {
    return "";
  }
}
