/**
 * EchoKeys / Profile helpers on top of the shared SPA-fallback guard.
 * Worker fetch uses `spaAssetFallback`; these aliases keep EchoKeys-focused
 * tests on the same HTML→404 behavior without a second rewrite path.
 */
import {
  fetchAssetsRejectingSpaHtml,
  isHtmlContentType,
  staticAssetNotFoundResponse,
} from "./spaAssetFallback";

/** Extension must be the last path segment — a trailing slash is not a module. */
const STATIC_MODULE_EXT =
  /\.(?:js|mjs|cjs|css|wasm|map|woff2?|ttf|otf)$/i;

export { isHtmlContentType };

function modulePathname(pathname: string): string {
  const raw = (pathname.split("?")[0] ?? "").split("#")[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function isStaticModuleAssetPath(pathname: string): boolean {
  const path = modulePathname(pathname);
  if (path.includes("..") || path.includes("\\")) return false;
  // `/assets/foo.js/` is a directory URL, not a hashed module. `isStaticAssetPath`
  // treats everything under `/assets/` as static, so this helper still requires
  // a real extension at the end of the pathname.
  if (!path.startsWith("/assets/") || path.endsWith("/")) return false;
  return STATIC_MODULE_EXT.test(path);
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
