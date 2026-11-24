/**
 * Bug fingerprints: the same bug on any device, build or user groups together.
 * The client computes the same signature (src/lib/bugSquasher/fingerprint.js)
 * for its local dedupe; the server always recomputes and never trusts it.
 */
import { createHash } from "node:crypto";

/** Replace volatile parts of an error message so repeats match. */
export function normalizeMessage(message: unknown): string {
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

/**
 * "fn@file" for the first useful stack frame. Bundle hashes, query strings
 * and line/column numbers are dropped so a rebuild keeps the same frame.
 */
export function topFrame(stack: unknown): string {
  const lines = String(stack ?? "").split("\n").slice(0, 30);
  for (const raw of lines) {
    const line = raw.trim();
    // V8: "at fn (url:1:2)" / "at url:1:2". Safari/Firefox: "fn@url:1:2".
    const v8 = /^at\s+(?:(.+?)\s+\()?(.+?)(?::\d+){0,2}\)?$/.exec(line);
    const gecko = /^(.*?)@(.+?)(?::\d+){0,2}$/.exec(line);
    const match = v8 || gecko;
    if (!match) continue;
    const fn = (match[1] || "").replace(/^async\s+/, "").trim() || "<anon>";
    const file = String(match[2] || "")
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

/** Normalise an API path so ids do not split one failing endpoint. */
export function normalizeApiPath(path: unknown): string {
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

export type FingerprintInput = {
  kind: string;
  message?: string | null;
  stack?: string | null;
  api?: { method?: string; path?: string; status?: number | null } | null;
  chat?: { failure_type?: string; phase?: string } | null;
  description?: string | null;
};

export function statusClass(status: unknown): string {
  const n = Number(status);
  if (!Number.isFinite(n) || n <= 0) return "network";
  return n >= 500 ? String(Math.trunc(n)) : `${Math.trunc(n / 100)}xx`;
}

/** Human-readable signature; the fingerprint is its hash. */
export function bugSignature(input: FingerprintInput): string {
  switch (input.kind) {
    case "api_error": {
      const api = input.api || {};
      return [
        "api",
        String(api.method || "GET").toUpperCase(),
        normalizeApiPath(api.path),
        statusClass(api.status),
      ].join("|");
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

export function bugFingerprint(input: FingerprintInput): string {
  const digest = createHash("sha256").update(bugSignature(input)).digest("hex");
  return `${input.kind === "manual" ? "m" : "a"}_${digest.slice(0, 32)}`;
}
