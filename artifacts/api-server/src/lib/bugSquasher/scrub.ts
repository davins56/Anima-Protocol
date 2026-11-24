/**
 * Secret / PII scrubbing for bug reports. Runs on every string the server
 * stores (the client scrubs too, but the server never trusts that).
 *
 * Redacts bearer tokens, JWTs, well-known API key shapes, `key=value` pairs
 * whose key names a credential, email addresses, data: URLs and long opaque
 * strings. Object keys that name a credential are dropped outright.
 */

export const REDACTED = "[redacted]";

const SENSITIVE_KEY_SOURCE =
  "(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|x-api-key|client[_-]?secret|secret|password|passwd|pwd|passphrase|authorization|auth[_-]?token|cookie|set-cookie|session[_-]?id|__session|__clerk_db_jwt|__client_uat|signature|private[_-]?key|otp|card[_-]?number|cvc|cvv)";

/** True when an object key names a credential, so its value is never kept. */
export function isSensitiveKey(key: string): boolean {
  return new RegExp(`^${SENSITIVE_KEY_SOURCE}$`, "i").test(String(key || "").trim());
}

const PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/g, `Basic ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, REDACTED],
  [/\b(?:sk|pk|rk|whsec)_(?:live|test)_[A-Za-z0-9]{6,}/g, REDACTED],
  [/\bsk-(?:or-|proj-|ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\bdata:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{16,}/gi, "[data-url]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, "[connection-string]"],
];

const KEY_VALUE_RE = new RegExp(
  `(["']?\\b${SENSITIVE_KEY_SOURCE}["']?\\s*[:=]\\s*["']?)(?!\\[redacted\\])([^\\s"'&,;}\\]]+)`,
  "gi",
);

// 40+ chars of base64/hex-ish with at least one digit: session ids, signed
// tokens. Paths and words rarely look like this.
const OPAQUE_RE = /\b(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g;

/** Scrub one string. Never throws. */
export function scrubText(input: unknown, max = 2000): string {
  let text = typeof input === "string" ? input : input == null ? "" : String(input);
  if (!text) return "";
  // Bound the work before regexes run on attacker-sized input.
  if (text.length > max * 4) text = text.slice(0, max * 4);
  for (const [re, replacement] of PATTERNS) text = text.replace(re, replacement);
  text = text.replace(KEY_VALUE_RE, (_m, prefix: string) => `${prefix}${REDACTED}`);
  text = text.replace(OPAQUE_RE, REDACTED);
  // Control characters (except newline / tab) never help a triager.
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Path + scrubbed query for a URL or path. Drops the origin and hash. */
export function scrubUrlPath(input: unknown, max = 300): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  let path = raw;
  try {
    const url = new URL(raw, "https://app.invalid");
    const params = [...url.searchParams.keys()];
    const query = params.length
      ? `?${params
          .slice(0, 12)
          .map((k) => `${encodeURIComponent(k)}=${isSensitiveKey(k) ? REDACTED : "…"}`)
          .join("&")}`
      : "";
    path = `${url.pathname}${query}`;
  } catch {
    path = raw.split("#")[0] ?? "";
  }
  return scrubText(path, max);
}

export type ScrubLimits = {
  depth?: number;
  keys?: number;
  items?: number;
  string?: number;
};

/** Deep-scrub a JSON-ish value with size caps. Unknown types become strings. */
export function scrubValue(value: unknown, limits: ScrubLimits = {}, level = 0): unknown {
  const depth = limits.depth ?? 5;
  const keys = limits.keys ?? 40;
  const items = limits.items ?? 40;
  const str = limits.string ?? 500;
  if (value == null) return null;
  if (typeof value === "string") return scrubText(value, str);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (level >= depth) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(-items).map((item) => scrubValue(item, limits, level + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, keys)) {
      const cleanKey = scrubText(key, 60);
      if (!cleanKey || isSensitiveKey(cleanKey)) continue;
      out[cleanKey] = scrubValue(child, limits, level + 1);
    }
    return out;
  }
  return scrubText(String(value), str);
}
