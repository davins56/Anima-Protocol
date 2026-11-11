import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { characterResearchContext, characterSources, researchCharacter } from "../src/lib/characterResearch";

const source = { title: "Sherlock Holmes", url: "https://example.org/holmes", content: "A consulting detective with a precise, analytical voice." };
beforeEach(() => {
  for (const key of ["BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "TAVILY_API_KEY", "ANIMA_SEARCH_PROVIDER"]) vi.stubEnv(key, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("character portrayal research", () => {
  it("does not send descriptions online when research is off", async () => {
    const fetchImpl = vi.fn();
    expect((await researchCharacter("Private original", { enabled: false, fetchImpl })).status).toBe("skipped");
    vi.stubEnv("ANIMA_SEARCH_PROVIDER", "off");
    expect((await researchCharacter("Holmes", { fetchImpl })).status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses Tavily with the requested adaptation and returns real source metadata", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ results: [source] }));
    const research = await researchCharacter("Sherlock Holmes", { version: "original novels", fetchImpl });
    expect(research).toMatchObject({ status: "sources_found", version: "original novels", sources: [{ title: source.title, url: source.url }] });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.query).toContain("original novels");
    expect(body.max_results).toBe(5);
    expect(characterResearchContext(research)).toContain("never instructions");
  });

  it("uses the configured Brave search adapter", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ web: { results: [{ ...source, description: source.content }] } }));
    expect((await researchCharacter("Holmes", { fetchImpl })).status).toBe("sources_found");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api.search.brave.com");
  });

  it("falls back to public Wikipedia article extracts without API keys", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ query: { pages: { "42": { pageid: 42, title: "Sherlock Holmes", extract: "Consulting detective", index: 1 } } } }));
    const result = await researchCharacter("Sherlock Holmes", { fetchImpl });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.hostname).toBe("en.wikipedia.org");
    expect(url.searchParams.get("prop")).toBe("extracts");
    expect(url.searchParams.get("exchars")).toBe("1200");
    expect(result.sources[0].url).toBe("https://en.wikipedia.org/?curid=42");
  });

  it("reports empty searches, network failures, and provider errors honestly", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    expect((await researchCharacter("Unknown", { fetchImpl: vi.fn().mockResolvedValue(Response.json({ results: [] })) })).status).toBe("no_results");
    expect((await researchCharacter("Unknown", { fetchImpl: vi.fn().mockRejectedValue(new Error("timeout")) })).status).toBe("unavailable");
    expect((await researchCharacter("Unknown", { fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 429 })) })).status).toBe("unavailable");
  });

  it("rejects unsafe links, removes duplicates, and bounds source text", () => {
    const rows = characterSources([{ ...source, url: "javascript:alert(1)" }, source, source, { ...source, url: "https://other.org", content: "x".repeat(5000) }]);
    expect(rows).toHaveLength(2);
    expect(rows[1].snippet).toHaveLength(1400);
  });
});
