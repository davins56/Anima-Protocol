// @ts-check
/**
 * Algolia Crawler for Netlify — frontend search widget.
 *
 * The search-only API key is public by design (it can only search, not write),
 * but it is still supplied at build time via VITE_ALGOLIA_SEARCH_API_KEY so it
 * is never committed. When the key is missing the widget stays hidden.
 *
 * The official snippet mounts into `div#search`. That node lives outside
 * React's `#root` so route changes / StrictMode remounts cannot destroy it.
 *
 * https://www.algolia.com/doc/tools/crawler/netlify-plugin/front-end/
 */

export const ALGOLIA_NETLIFY_APP_ID = "FQLOVAYP5E";
export const ALGOLIA_NETLIFY_SITE_ID = "01323ffe-2843-4d18-b5cd-113d8ab8e342";
export const ALGOLIA_NETLIFY_SELECTOR = "div#search";
export const ALGOLIA_NETLIFY_HOST_ID = "algolia-search-host";
export const ALGOLIA_NETLIFY_CSS_HREF =
  "https://cdn.jsdelivr.net/npm/@algolia/algoliasearch-netlify-frontend@1/dist/algoliasearchNetlify.css";
export const ALGOLIA_NETLIFY_JS_SRC =
  "https://cdn.jsdelivr.net/npm/@algolia/algoliasearch-netlify-frontend@1/dist/algoliasearchNetlify.js";

/** Dark theme aligned with the Anima Protocol cyan palette. */
export const ALGOLIA_NETLIFY_THEME = {
  mark: "#00e5e5",
  background: "#050505",
  selected: "#0a2a2a",
  text: "#a5f3fc",
  colorSourceIcon: "#22d3ee",
};

/** @typedef {(options: Record<string, unknown>) => void} AlgoliaSearchNetlifyFn */

let mounted = false;
/** @type {Promise<boolean> | null} */
let assetsPromise = null;

/**
 * @returns {AlgoliaSearchNetlifyFn | undefined}
 */
function getAlgoliaSearchNetlifyFn() {
  const fn = /** @type {{ algoliasearchNetlify?: AlgoliaSearchNetlifyFn }} */ (
    globalThis
  ).algoliasearchNetlify;
  return typeof fn === "function" ? fn : undefined;
}

/**
 * @returns {string}
 */
export function getAlgoliaSearchApiKey() {
  const key = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

/**
 * Git branch whose Algolia index to query. Netlify injects HEAD at build time;
 * Vite forwards it as VITE_ALGOLIA_BRANCH. Falls back to `main`.
 * @returns {string}
 */
export function getAlgoliaNetlifyBranch() {
  const fromEnv = import.meta.env.VITE_ALGOLIA_BRANCH;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return "main";
}

export function isAlgoliaSearchConfigured() {
  return getAlgoliaSearchApiKey().length > 0;
}

/**
 * Options object matching Algolia's Netlify frontend snippet.
 * @returns {Record<string, unknown> | null}
 */
export function getAlgoliaNetlifyOptions() {
  const apiKey = getAlgoliaSearchApiKey();
  if (!apiKey) return null;
  return {
    appId: ALGOLIA_NETLIFY_APP_ID,
    apiKey,
    siteId: ALGOLIA_NETLIFY_SITE_ID,
    branch: getAlgoliaNetlifyBranch(),
    selector: ALGOLIA_NETLIFY_SELECTOR,
    placeholder: "Search...",
    theme: ALGOLIA_NETLIFY_THEME,
  };
}

/**
 * Ensure the persistent `div#search` host exists outside React's root.
 * @param {Document} [doc]
 * @returns {HTMLElement | null}
 */
export function ensureAlgoliaSearchHost(doc = typeof document !== "undefined" ? document : undefined) {
  if (!doc?.body) return null;

  let host = doc.getElementById(ALGOLIA_NETLIFY_HOST_ID);
  if (!host) {
    host = doc.createElement("div");
    host.id = ALGOLIA_NETLIFY_HOST_ID;
    host.setAttribute("hidden", "");
    host.setAttribute("role", "search");
    host.setAttribute("aria-label", "Site search");
    doc.body.appendChild(host);
  }

  let search = host.querySelector("#search");
  if (!search) {
    search = doc.createElement("div");
    search.id = "search";
    host.appendChild(search);
  }

  return host;
}

/**
 * @param {string} href
 * @param {Document} doc
 */
function ensureStylesheet(href, doc) {
  const existing = doc.querySelector(`link[rel="stylesheet"][href="${href}"]`);
  if (existing) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  doc.head.appendChild(link);
}

/**
 * @param {string} src
 * @param {Document} doc
 * @returns {Promise<void>}
 */
function ensureScript(src, doc) {
  return new Promise((resolve, reject) => {
    if (getAlgoliaSearchNetlifyFn()) {
      resolve();
      return;
    }

    const fail = () =>
      reject(new Error("Failed to load Algolia Netlify search script"));

    const existing = doc.querySelector(`script[src="${src}"]`);
    /** @type {HTMLScriptElement} */
    let script;
    if (existing instanceof HTMLScriptElement) {
      script = existing;
    } else {
      script = doc.createElement("script");
      script.src = src;
      script.async = true;
      doc.head.appendChild(script);
    }

    script.addEventListener(
      "load",
      () => {
        if (getAlgoliaSearchNetlifyFn()) resolve();
        else fail();
      },
      { once: true },
    );
    script.addEventListener("error", fail, { once: true });
    // Vite may run the app module after a deferred CDN script already fired
    // `load`. The global is then already present (handled above) or appears
    // on the next microtask.
    queueMicrotask(() => {
      if (getAlgoliaSearchNetlifyFn()) resolve();
    });
  });
}

/**
 * Load the official Algolia Netlify frontend CSS + JS (no-op if already present).
 * @param {Document} [doc]
 * @returns {Promise<boolean>}
 */
export async function loadAlgoliaNetlifyAssets(
  doc = typeof document !== "undefined" ? document : undefined,
) {
  if (getAlgoliaSearchNetlifyFn()) return true;
  if (!doc?.head) return false;

  if (!assetsPromise) {
    assetsPromise = (async () => {
      ensureStylesheet(ALGOLIA_NETLIFY_CSS_HREF, doc);
      await ensureScript(ALGOLIA_NETLIFY_JS_SRC, doc);
      return Boolean(getAlgoliaSearchNetlifyFn());
    })().catch((err) => {
      assetsPromise = null;
      throw err;
    });
  }

  return assetsPromise;
}

/**
 * Replace `div#search` with the Algolia autocomplete. Safe to call repeatedly.
 * @param {((options: Record<string, unknown>) => void) | undefined} [algoliasearchNetlify]
 * @returns {boolean}
 */
export function mountAlgoliaNetlifySearch(algoliasearchNetlify) {
  if (mounted) return true;
  if (!isAlgoliaSearchConfigured()) return false;

  const options = getAlgoliaNetlifyOptions();
  const fn = algoliasearchNetlify || getAlgoliaSearchNetlifyFn();
  if (!options || typeof fn !== "function") return false;

  const host = ensureAlgoliaSearchHost();
  if (!host?.querySelector("#search")) return false;

  fn(options);
  mounted = true;
  host.removeAttribute("hidden");
  return true;
}

/**
 * Boot the widget: load CDN assets if needed, then mount once.
 * @returns {Promise<boolean>}
 */
export async function initAlgoliaNetlifySearch() {
  if (!isAlgoliaSearchConfigured()) return false;
  ensureAlgoliaSearchHost();
  try {
    await loadAlgoliaNetlifyAssets();
  } catch (err) {
    console.warn("[algolia] Netlify search assets failed to load", err);
    return false;
  }
  return mountAlgoliaNetlifySearch();
}

/** @internal */
export function resetAlgoliaNetlifySearchForTests() {
  mounted = false;
  assetsPromise = null;
}
