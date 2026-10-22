/** Server-side search adapters. Keys are server env only (never VITE_*). */
import { normalizeBrave, normalizeSerper, type SearchProviderId, type SearchResult } from "./searchCore";

const TIMEOUT_MS = 6000;

export async function runProviderSearch(
  provider: SearchProviderId,
  query: string,
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResult[]> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  if (provider === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(20, count * 2)));
    url.searchParams.set("safesearch", "strict");
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": String(process.env.BRAVE_SEARCH_API_KEY || "").trim() },
      signal,
    });
    if (!res.ok) throw Object.assign(new Error(`Brave search failed (${res.status})`), { status: res.status });
    return normalizeBrave(await res.json());
  }
  const res = await fetchImpl("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": String(process.env.SERPER_API_KEY || "").trim() },
    body: JSON.stringify({ q: query, num: Math.min(20, count * 2), safe: "active" }),
    signal,
  });
  if (!res.ok) throw Object.assign(new Error(`Serper search failed (${res.status})`), { status: res.status });
  return normalizeSerper(await res.json());
}
