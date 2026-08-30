/**
 * Cloudflare Workers `assets.not_found_handling = "single-page-application"`
 * serves index.html (200 text/html) for any unmatched path — including a
 * missing Vite hashed module such as `/assets/EchoKeys-XXXX.js`.
 *
 * Browsers then reject the HTML as a module script:
 *   'text/html' is not a valid JavaScript MIME type for module script
 *
 * Hashed /assets/* modules must never take that fallback. Missing files 404
 * with a non-HTML type so Workbox/SW cannot precache homepage HTML as JS.
 */

const STATIC_MODULE_EXT =
  /\.(?:js|mjs|cjs|css|wasm|map|woff2?|ttf|otf)$/i;

export function isStaticModuleAssetPath(pathname: string): boolean {
  if (!pathname.startsWith("/assets/")) return false;
  if (pathname.includes("..") || pathname.includes("\\")) return false;
  return STATIC_MODULE_EXT.test(pathname);
}

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("text/html");
}

export function shouldRejectHtmlAssetFallback(
  pathname: string,
  contentType: string | null | undefined,
): boolean {
  return isStaticModuleAssetPath(pathname) && isHtmlContentType(contentType);
}

export function missingStaticAssetResponse(pathname: string): Response {
  return new Response(`Not found: ${pathname}\n`, {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function fetchStaticModuleAsset(
  request: Request,
  assets: { fetch: (request: Request) => Promise<Response> },
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const asset = await assets.fetch(request);
  if (shouldRejectHtmlAssetFallback(pathname, asset.headers.get("content-type"))) {
    return missingStaticAssetResponse(pathname);
  }
  return asset;
}
