// @ts-check
/**
 * Same signature as the server (artifacts/api-server/src/lib/bugSquasher/fingerprint.ts),
 * hashed with FNV-1a for a cheap, synchronous local dedupe key. The server
 * recomputes the real fingerprint and never trusts this one.
 */

/** @param {unknown} message */
export function normalizeMessage(message) {
  return String(message ?? "")
    .replace(/https?:\/\/[^\s"')]+/gi, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?:user|sess|turn|msg|ent|char|org)_[A-Za-z0-9]{6,}\b/g, "<id>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/g, "<str>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** @param {unknown} stack */
export function topFrame(stack) {
  const lines = String(stack ?? "").split("\n").slice(0, 30);
  for (const raw of lines) {
    const line = raw.trim();
    const match =
      /^at\s+(?:(.+?)\s+\()?(.+?)(?::\d+){0,2}\)?$/.exec(line) ||
      /^(.*?)@(.+?)(?::\d+){0,2}$/.exec(line);
    if (!match) continue;
    const fn = (match[1] || "").replace(/^async\s+/, "").trim() || "<anon>";
    const file =
      String(match[2] || "")
        .replace(/[?#].*$/, "")
        .replace(/:\d+(?::\d+)?$/, "")
        .split("/")
        .pop() || "";
    if (!file || /^(?:native|<anonymous>)$/.test(file)) continue;
    const base = file.replace(/[-.][A-Za-z0-9_]{6,12}(?=\.m?[jt]sx?$)/, "");
    return `${fn}@${base}`.slice(0, 160);
  }
  return "";
}

/** @param {unknown} path */
export function normalizeApiPath(path) {
  return String(path ?? "")
    .replace(/[?#].*$/, "")
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) ||
      /^[0-9a-f-]{16,}$/i.test(seg) ||
      /^(?:user|sess|turn|msg|ent|char)_[A-Za-z0-9]+$/.test(seg) ||
      (seg.length >= 20 && /\d/.test(seg))
        ? ":id"
        : seg,
    )
    .join("/")
    .slice(0, 200);
}

/** @param {unknown} status */
export function statusClass(status) {
  const n = Number(status);
  if (!Number.isFinite(n) || n <= 0) return "network";
  return n >= 500 ? String(Math.trunc(n)) : `${Math.trunc(n / 100)}xx`;
}

/**
 * @param {{ kind: string, message?: string | null, stack?: string | null, description?: string | null,
 *   api?: { method?: string, path?: string, status?: number | null } | null,
 *   chat?: { failure_type?: string, phase?: string } | null }} input
 * @returns {string}
 */
export function bugSignature(input) {
  switch (input.kind) {
    case "api_error": {
      const api = input.api || {};
      return ["api", String(api.method || "GET").toUpperCase(), normalizeApiPath(api.path), statusClass(api.status)].join("|");
    }
    case "chat_failure": {
      const chat = input.chat || {};
      return ["chat", chat.failure_type || "unknown", chat.phase || "unknown"].join("|");
    }
    case "manual":
      return ["manual", normalizeMessage(input.description || input.message).toLowerCase()].join("|");
    default:
      return [input.kind, normalizeMessage(input.message), topFrame(input.stack)].join("|");
  }
}

/** 32-bit FNV-1a, hex. @param {string} text */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** @param {Parameters<typeof bugSignature>[0]} input */
export function localFingerprint(input) {
  return `${input.kind}:${fnv1a(bugSignature(input))}`;
}
