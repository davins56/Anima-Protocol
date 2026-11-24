// @ts-check
/**
 * Client-side scrubbing for Bug Squasher reports. The server scrubs again
 * (artifacts/api-server/src/lib/bugSquasher/scrub.ts); this copy keeps
 * secrets from ever leaving the browser in the first place.
 */

export const REDACTED = "[redacted]";

const SENSITIVE_KEY_SOURCE =
  "(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|x-api-key|client[_-]?secret|secret|password|passwd|pwd|passphrase|authorization|auth[_-]?token|cookie|set-cookie|session[_-]?id|__session|__clerk_db_jwt|__client_uat|signature|private[_-]?key|otp|card[_-]?number|cvc|cvv)";

const SENSITIVE_KEY_RE = new RegExp(`^${SENSITIVE_KEY_SOURCE}$`, "i");

/** @param {string} key */
export function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key || "").trim());
}

/** @type {Array<[RegExp, string]>} */
const PATTERNS = [
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
const OPAQUE_RE = /\b(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g;

/**
 * @param {unknown} input
 * @param {number} [max]
 * @returns {string}
 */
export function scrubText(input, max = 2000) {
  let text = typeof input === "string" ? input : input == null ? "" : String(input);
  if (!text) return "";
  if (text.length > max * 4) text = text.slice(0, max * 4);
  for (const [re, replacement] of PATTERNS) text = text.replace(re, replacement);
  text = text.replace(KEY_VALUE_RE, (_m, prefix) => `${prefix}${REDACTED}`);
  text = text.replace(OPAQUE_RE, REDACTED);
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Path plus query keys (values dropped, sensitive ones marked). No origin, no hash.
 * @param {unknown} input
 * @returns {string}
 */
export function scrubUrlPath(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://app.invalid");
    const keys = [...url.searchParams.keys()].slice(0, 12);
    const query = keys.length
      ? `?${keys.map((k) => `${encodeURIComponent(k)}=${isSensitiveKey(k) ? REDACTED : "…"}`).join("&")}`
      : "";
    return scrubText(`${url.pathname}${query}`, 300);
  } catch {
    return scrubText(raw.split("#")[0] || "", 300);
  }
}

/**
 * @param {unknown} value
 * @param {number} [level]
 * @returns {unknown}
 */
export function scrubValue(value, level = 0) {
  if (value == null) return null;
  if (typeof value === "string") return scrubText(value, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (level >= 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(-40).map((item) => scrubValue(item, level + 1));
  if (typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, child] of Object.entries(/** @type {Record<string, unknown>} */ (value)).slice(0, 40)) {
      if (isSensitiveKey(key)) continue;
      out[scrubText(key, 60)] = scrubValue(child, level + 1);
    }
    return out;
  }
  return scrubText(String(value), 500);
}
