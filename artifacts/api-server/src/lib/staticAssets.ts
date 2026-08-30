/**
 * EchoKeys / Profile helpers on top of the shared SPA-fallback guard.
 * Worker fetch uses `spaAssetFallback`; these aliases keep EchoKeys-focused
 * tests and call sites on the same HTML→404 behavior.
 */
import {
  fetchAssetsRejectingSpaHtml,
  isHtmlContentType,
  isStaticAssetPath,
  staticAssetNotFoundResponse,
} from "./spaAssetFallback";

const STATIC_MODULE_EXT =
  /\.(?:js|mjs|cjs|css|wasm|map|woff2?|ttf|otf)$/i;

export { isHtmlContentType };

export function isStaticModuleAssetPath(pathname: string): boolean {
  if (pathname.includes("..") || pathname.includes("\\")) return false;
  return isStaticAssetPath(pathname) && STATIC_MODULE_EXT.test(pathname);
}

export function shouldRejectHtmlAssetFallback(
  pathname: string,
  contentType: string | null | undefined,
): boolean {
  return isStaticModuleAssetPath(pathname) && isHtmlContentType(contentType ?? null);
}

export function missingStaticAssetResponse(pathname: string): Response {
  return staticAssetNotFoundResponse(pathname);
}

export async function fetchStaticModuleAsset(
  request: Request,
  assets: { fetch: (request: Request) => Promise<Response> },
): Promise<Response> {
  return fetchAssetsRejectingSpaHtml(request, assets);
}
