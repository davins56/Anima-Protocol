/**
 * OpenAI-compatible chat is `{base}/chat/completions`.
 * Append `/v1` on the pathname when the operator omitted it.
 * A pathname that already ends in `/v1` (any case, optional trailing slash)
 * is left alone. Query strings and hashes stay on the URL.
 */
export function withOpenAiV1Suffix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (/\/v1$/i.test(path)) {
    if (url.pathname === path) return trimmed;
    url.pathname = path;
    return url.href;
  }
  url.pathname = path === "/" ? "/v1" : `${path}/v1`;
  return url.href;
}
