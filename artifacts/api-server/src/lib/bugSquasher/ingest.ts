/**
 * Validate and normalise one bug report from the browser.
 *
 * Every string is scrubbed (lib/bugSquasher/scrub.ts) and capped; the
 * fingerprint is recomputed here. The user id always comes from the Clerk
 * session, never from the body.
 */
import { bugFingerprint, bugSignature } from "./fingerprint";
import { scrubText, scrubUrlPath, scrubValue } from "./scrub";

export const BUG_KINDS = [
  "window_error",
  "unhandled_rejection",
  "react_crash",
  "api_error",
  "chat_failure",
  "manual",
] as const;
export type BugKind = (typeof BUG_KINDS)[number];

export const BUG_STATUSES = ["new", "triaged", "fixed", "ignored"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const LIMITS = {
  title: 300,
  message: 2000,
  stack: 8000,
  route: 300,
  appVersion: 64,
  userAgent: 300,
  description: 4000,
  breadcrumbs: 30,
  contextBytes: 16_000,
  screenshotChars: 700_000,
  occurrences: 50,
  adminNote: 2000,
} as const;

export class BugReportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BugReportInputError";
  }
}

export type BugReportInput = {
  kind: BugKind;
  fingerprint: string;
  signature: string;
  title: string;
  message: string | null;
  stack: string | null;
  route: string | null;
  appVersion: string | null;
  userAgent: string | null;
  description: string | null;
  context: Record<string, unknown>;
  screenshot: string | null;
  occurrences: number;
};

export function isBugKind(value: unknown): value is BugKind {
  return typeof value === "string" && (BUG_KINDS as readonly string[]).includes(value);
}

export function isBugStatus(value: unknown): value is BugStatus {
  return typeof value === "string" && (BUG_STATUSES as readonly string[]).includes(value);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optional(text: string): string | null {
  return text.trim() ? text : null;
}

const SCREENSHOT_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Accept only a bounded base64 image data URL. */
export function cleanScreenshot(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new BugReportInputError("screenshot must be an image data URL");
  if (value.length > LIMITS.screenshotChars) throw new BugReportInputError("screenshot is too large");
  if (!SCREENSHOT_RE.test(value)) throw new BugReportInputError("screenshot must be an image data URL");
  return value;
}

/** Breadcrumbs are kept newest-last and trimmed until the context fits. */
export function cleanContext(value: unknown): Record<string, unknown> {
  const raw = obj(value) ?? {};
  const scrubbed = (scrubValue(raw, { depth: 5, keys: 40, items: LIMITS.breadcrumbs, string: 500 }) ??
    {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...scrubbed };
  let size = JSON.stringify(out).length;
  while (size > LIMITS.contextBytes && Array.isArray(out.breadcrumbs) && out.breadcrumbs.length) {
    out.breadcrumbs = (out.breadcrumbs as unknown[]).slice(Math.ceil((out.breadcrumbs as unknown[]).length / 2));
    if ((out.breadcrumbs as unknown[]).length <= 1) out.breadcrumbs = [];
    size = JSON.stringify(out).length;
  }
  if (size > LIMITS.contextBytes) {
    return { truncated: true, note: "context was too large to keep" };
  }
  return out;
}

function defaultTitle(kind: BugKind, message: string, context: Record<string, unknown>): string {
  if (kind === "api_error") {
    const api = obj(context.api) ?? {};
    const status = Number(api.status) || 0;
    return `${String(api.method || "GET").toUpperCase()} ${String(api.path || "?")} → ${status || "network error"}`;
  }
  if (kind === "chat_failure") {
    const chat = obj(context.chat) ?? {};
    return `Chat turn failed: ${String(chat.failure_type || "unknown")} (${String(chat.phase || "unknown")})`;
  }
  return message.split("\n")[0] || kind.replace(/_/g, " ");
}

/** Parse a POST body into a storable report or throw BugReportInputError. */
export function parseBugReport(body: unknown, opts: { userAgent?: string } = {}): BugReportInput {
  const b = obj(body);
  if (!b) throw new BugReportInputError("Invalid bug report");
  if (!isBugKind(b.kind)) throw new BugReportInputError("Unknown bug report kind");
  const kind = b.kind;

  const message = scrubText(b.message, LIMITS.message);
  const stack = scrubText(b.stack, LIMITS.stack);
  const description = scrubText(b.description, LIMITS.description).trim();
  if (kind === "manual" && description.length < 3) {
    throw new BugReportInputError("Describe what went wrong (at least a few words)");
  }
  if (kind !== "manual" && !message.trim() && !obj(b.context)?.api && !obj(b.context)?.chat) {
    throw new BugReportInputError("An automatic report needs a message");
  }

  const context = cleanContext(b.context);
  const route = scrubUrlPath(b.route, LIMITS.route);
  const appVersion = /^[A-Za-z0-9._+-]{1,64}$/.test(String(b.app_version ?? "").trim())
    ? String(b.app_version).trim()
    : "";
  const userAgent = scrubText(b.user_agent || opts.userAgent || "", LIMITS.userAgent).replace(/\s+/g, " ").trim();
  const screenshot = kind === "manual" ? cleanScreenshot(b.screenshot) : null;

  const occurrencesRaw = Number(b.occurrences ?? 1);
  const occurrences = Number.isFinite(occurrencesRaw)
    ? Math.min(LIMITS.occurrences, Math.max(1, Math.trunc(occurrencesRaw)))
    : 1;

  const fpInput = {
    kind,
    message,
    stack,
    description,
    api: obj(context.api) as { method?: string; path?: string; status?: number } | null,
    chat: obj(context.chat) as { failure_type?: string; phase?: string } | null,
  };
  const titleSource = scrubText(b.title, LIMITS.title).trim();
  const title = (titleSource || defaultTitle(kind, kind === "manual" ? description : message, context))
    .replace(/\s+/g, " ")
    .slice(0, LIMITS.title) || kind;

  return {
    kind,
    fingerprint: bugFingerprint(fpInput),
    signature: bugSignature(fpInput),
    title,
    message: optional(message),
    stack: optional(stack),
    route: optional(route),
    appVersion: optional(appVersion),
    userAgent: optional(userAgent),
    description: optional(description),
    context,
    screenshot,
    occurrences,
  };
}

export type StatusUpdateInput = { status: BugStatus; note: string | null };

export function parseStatusUpdate(body: unknown): StatusUpdateInput {
  const b = obj(body);
  if (!b || !isBugStatus(b.status)) throw new BugReportInputError("status must be new, triaged, fixed or ignored");
  const note = b.note == null ? null : scrubText(b.note, LIMITS.adminNote).trim() || null;
  return { status: b.status, note };
}

const FINGERPRINT_RE = /^[a-z0-9_:-]{8,80}$/;
export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}
