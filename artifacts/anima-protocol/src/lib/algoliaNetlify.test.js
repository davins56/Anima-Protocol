import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALGOLIA_NETLIFY_APP_ID,
  ALGOLIA_NETLIFY_CSS_HREF,
  ALGOLIA_NETLIFY_HOST_ID,
  ALGOLIA_NETLIFY_JS_SRC,
  ALGOLIA_NETLIFY_SELECTOR,
  ALGOLIA_NETLIFY_SITE_ID,
  ALGOLIA_NETLIFY_THEME,
  ensureAlgoliaSearchHost,
  getAlgoliaNetlifyBranch,
  getAlgoliaNetlifyOptions,
  getAlgoliaSearchApiKey,
  initAlgoliaNetlifySearch,
  isAlgoliaSearchConfigured,
  loadAlgoliaNetlifyAssets,
  mountAlgoliaNetlifySearch,
  resetAlgoliaNetlifySearchForTests,
} from "./algoliaNetlify";

const SEARCH_KEY = "algolia-search-only-test-key";

describe("algoliaNetlify", () => {
  beforeEach(() => {
    resetAlgoliaNetlifySearchForTests();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete globalThis.algoliasearchNetlify;
  });

  afterEach(() => {
    resetAlgoliaNetlifySearchForTests();
    vi.unstubAllEnvs();
    delete globalThis.algoliasearchNetlify;
  });

  it("stays unconfigured when the search API key is missing", () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", "");
    expect(getAlgoliaSearchApiKey()).toBe("");
    expect(isAlgoliaSearchConfigured()).toBe(false);
    expect(getAlgoliaNetlifyOptions()).toBeNull();
    expect(mountAlgoliaNetlifySearch(vi.fn())).toBe(false);
  });

  it("builds the official Netlify frontend options from the snippet + env key", () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", `  ${SEARCH_KEY}  `);
    vi.stubEnv("VITE_ALGOLIA_BRANCH", "main");

    expect(isAlgoliaSearchConfigured()).toBe(true);
    expect(getAlgoliaSearchApiKey()).toBe(SEARCH_KEY);
    expect(getAlgoliaNetlifyBranch()).toBe("main");
    expect(getAlgoliaNetlifyOptions()).toEqual({
      appId: ALGOLIA_NETLIFY_APP_ID,
      apiKey: SEARCH_KEY,
      siteId: ALGOLIA_NETLIFY_SITE_ID,
      branch: "main",
      selector: ALGOLIA_NETLIFY_SELECTOR,
      placeholder: "Search...",
      theme: ALGOLIA_NETLIFY_THEME,
    });
    expect(ALGOLIA_NETLIFY_APP_ID).toBe("FQLOVAYP5E");
    expect(ALGOLIA_NETLIFY_SITE_ID).toBe("01323ffe-2843-4d18-b5cd-113d8ab8e342");
    expect(ALGOLIA_NETLIFY_SELECTOR).toBe("div#search");
  });

  it("falls back to main when no branch env is set", () => {
    vi.stubEnv("VITE_ALGOLIA_BRANCH", "");
    expect(getAlgoliaNetlifyBranch()).toBe("main");
  });

  it("creates a persistent host with div#search outside the React root", () => {
    const host = ensureAlgoliaSearchHost();
    expect(host).toBeTruthy();
    expect(host.id).toBe(ALGOLIA_NETLIFY_HOST_ID);
    expect(host.getAttribute("hidden")).toBe("");
    expect(host.getAttribute("role")).toBe("search");
    expect(host.querySelector("#search")).toBeTruthy();
    expect(document.getElementById("search")?.parentElement).toBe(host);

    const again = ensureAlgoliaSearchHost();
    expect(again).toBe(host);
    expect(document.querySelectorAll("#search")).toHaveLength(1);
  });

  it("mounts algoliasearchNetlify once and reveals the host", () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", SEARCH_KEY);
    const algoliasearchNetlify = vi.fn();

    expect(mountAlgoliaNetlifySearch(algoliasearchNetlify)).toBe(true);
    expect(algoliasearchNetlify).toHaveBeenCalledTimes(1);
    expect(algoliasearchNetlify).toHaveBeenCalledWith(
      getAlgoliaNetlifyOptions(),
    );

    const host = document.getElementById(ALGOLIA_NETLIFY_HOST_ID);
    expect(host?.hasAttribute("hidden")).toBe(false);

    expect(mountAlgoliaNetlifySearch(algoliasearchNetlify)).toBe(true);
    expect(algoliasearchNetlify).toHaveBeenCalledTimes(1);
  });

  it("does not mount when the global widget function is missing", () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", SEARCH_KEY);
    expect(mountAlgoliaNetlifySearch()).toBe(false);
    expect(document.getElementById(ALGOLIA_NETLIFY_HOST_ID)).toBeNull();
  });

  it("injects the official CSS and JS assets when they are not already on the page", async () => {
    const load = loadAlgoliaNetlifyAssets();

    const link = document.querySelector(
      `link[rel="stylesheet"][href="${ALGOLIA_NETLIFY_CSS_HREF}"]`,
    );
    const script = document.querySelector(
      `script[src="${ALGOLIA_NETLIFY_JS_SRC}"]`,
    );
    expect(link).toBeTruthy();
    expect(script).toBeTruthy();

    globalThis.algoliasearchNetlify = vi.fn();
    script.dispatchEvent(new Event("load"));

    await expect(load).resolves.toBe(true);
  });

  it("skips a second asset injection when algoliasearchNetlify is already defined", async () => {
    globalThis.algoliasearchNetlify = vi.fn();
    await expect(loadAlgoliaNetlifyAssets()).resolves.toBe(true);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(document.querySelectorAll("link")).toHaveLength(0);
  });

  it("init loads assets then mounts when the search key is set", async () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", SEARCH_KEY);
    globalThis.algoliasearchNetlify = vi.fn();

    await expect(initAlgoliaNetlifySearch()).resolves.toBe(true);
    expect(globalThis.algoliasearchNetlify).toHaveBeenCalledTimes(1);
    expect(
      document.getElementById(ALGOLIA_NETLIFY_HOST_ID)?.hasAttribute("hidden"),
    ).toBe(false);
  });

  it("init is a no-op without a search API key", async () => {
    vi.stubEnv("VITE_ALGOLIA_SEARCH_API_KEY", "");
    const algoliasearchNetlify = vi.fn();
    globalThis.algoliasearchNetlify = algoliasearchNetlify;

    await expect(initAlgoliaNetlifySearch()).resolves.toBe(false);
    expect(algoliasearchNetlify).not.toHaveBeenCalled();
  });
});
