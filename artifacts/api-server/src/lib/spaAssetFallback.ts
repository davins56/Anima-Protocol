/**
 * Cloudflare Workers Assets with `not_found_handling: "single-page-application"`
 * serves `index.html` (200, text/html) for any unmatched path — including
 * stale content-hashed files like `/assets/NetBattle-<oldhash>.js`.
 *
 * Browsers then refuse the module (`'text/html' is not a valid JavaScript MIME
 * type`). Missing static files must be a real 404 with a non-HTML type.
 * Client routes (`/net-battle`, `/meditation`) still keep the HTML fallback.
 */

const STATIC_ASSET_EXTENSION =
  /\.(?:[cm]?js|map|css|json|wasm|txt|xml|webmanifest|png|jpe?g|gif|svg|webp|ico|avif|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|pdf)$/i;

/** Vite content-hashed files under /assets (e.g. index-Dqhepbdd.js). */
const HASHED_ASSET_PATH =
  /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9.]+$/;

export const HASHED_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export function isStaticAssetPath(pathname: string): boolean {
  const path = decodePathname(pathname);
  if (path === "/assets" || path.startsWith("/assets/")) {
    return true;
  }
  return STATIC_ASSET_EXTENSION.test(path);
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  return contentType.toLowerCase().includes("text/html");
}

export function staticAssetNotFoundResponse(pathname: string): Response {
  const path = decodePathname(pathname);
  return new Response(`Not Found: ${path}\n`, {
    status: 404,
    statusText: "Not Found",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function isHashedAssetPath(pathname: string): boolean {
  return HASHED_ASSET_PATH.test(decodePathname(pathname));
}

/**
 * Long-cache successful hashed /assets so repeat visits (especially mobile
 * Safari) do not re-download the main graph. 404s stay no-store.
 */
export function withHashedAssetCache(
  pathname: string,
  response: Response,
): Response {
  if (!response.ok || !isHashedAssetPath(pathname)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", HASHED_ASSET_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * If ASSETS SPA-fell-back a static file request to HTML, replace it with a
 * non-HTML 404. Pass through real JS/CSS/font responses and SPA HTML for
 * extensionless client routes. Hashed /assets get immutable cache headers.
 */
export function rejectSpaFallbackForStaticAsset(
  pathname: string,
  response: Response,
): Response {
  if (
    isStaticAssetPath(pathname) &&
    isHtmlContentType(response.headers.get("content-type"))
  ) {
    return staticAssetNotFoundResponse(pathname);
  }
  return withHashedAssetCache(pathname, response);
}

export async function fetchAssetsRejectingSpaHtml(
  request: Request,
  assets: { fetch: (request: Request) => Promise<Response> },
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const response = await assets.fetch(request);
  return rejectSpaFallbackForStaticAsset(pathname, response);
}

function decodePathname(pathname: string): string {
  const raw = pathname.split("?")[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
