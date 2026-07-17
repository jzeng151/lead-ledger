import { fetchWithTimeout } from "./adapter";

// Keyless: returns page text, or "" on any failure so callers can fall back deterministically.
export async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}
