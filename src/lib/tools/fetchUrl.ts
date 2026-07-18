import dns from "node:dns/promises";

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
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 192 && b === 0) return false; // IETF protocol assignments
    if (a === 192 && b === 88) return false; // 6to4 relay anycast
    if (a >= 224) return false; // multicast and reserved
  }
  return true;
}

// Enough of a page for the fingerprints and the https-liveness check, without
// letting a huge or attacker-controlled response consume server memory and model
// context. res.text() would buffer the whole body first, so read the stream and
// stop at the cap.
const MAX_BYTES = 512 * 1024;
const BODY_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // fetchWithTimeout's abort only covers the response headers; once they arrive
  // its timer is cleared, so a server that stalls mid-body would hang the run
  // here. Bound the read on its own.
  const deadline = Date.now() + BODY_TIMEOUT_MS;
  try {
    while (total < MAX_BYTES) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), left).unref?.()),
      ]);
      if (!next || next.done) break;
      chunks.push(next.value);
      total += next.value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

/**
 * Fetch following redirects by hand, validating every hop.
 *
 * Automatic redirect following would check only the model-supplied URL: a public
 * page the lead controls can 302 to loopback or the metadata endpoint, and the
 * response comes back to the model even though that target would be rejected if
 * requested directly.
 */
/**
 * Reject a hostname whose DNS record points inside the network.
 *
 * The literal check above only sees the string, so "internal.example.com" with
 * an A record of 127.0.0.1 (trivial to arrange, and services like nip.io hand it
 * out for free) sails through it. Resolving first closes that.
 *
 * This is not proof against DNS rebinding: the name is resolved here and again
 * by fetch, and the answer can change in between. Pinning the connection to a
 * vetted address needs a custom dispatcher, which is more than this path is
 * worth given live tools are off by default and the write path is human-gated.
 */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  // A literal address was already range-checked; no lookup to do.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return true;
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPublicHttpUrl(`http://${a.family === 6 ? `[${a.address}]` : a.address}`));
  } catch {
    return false; // unresolvable: nothing to fetch anyway
  }
}

async function fetchGuarded(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(current)) return null;
    if (!(await resolvesPublicly(new URL(current).hostname))) return null;
    const res = await fetchWithTimeout(current, { redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  return null; // redirect loop or too many hops
}

// Keyless: returns page text, or "" on any failure so callers can fall back deterministically.
export async function fetchUrl(url: string): Promise<string> {
  if (!isPublicHttpUrl(url)) return "";
  try {
    const res = await fetchGuarded(url);
    if (!res || !res.ok) return "";
    return await readCapped(res);
  } catch {
    return "";
  }
}
