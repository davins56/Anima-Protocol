/**
 * Payload schemas for bot→anima requests (plan §1, §3). Strict objects: any
 * unknown key (for example a `user_id`) is rejected, so a bot can never pick
 * which account its data lands in. The owner comes from the bot registry
 * (M2) on the server, never from the request.
 */
import { z } from "zod";
import { BOT_ID_PATTERN } from "./config";

// Printable text: no control characters except newline and tab.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(max: number, { multiline = false }: { multiline?: boolean } = {}) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), "control characters are not allowed")
    .refine((s) => multiline || !/[\r\n]/.test(s), "must be a single line");
}

const httpsUrl = z
  .string()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "must be an https URL without credentials");

const isoDateTime = z.iso.datetime({ offset: true });

export const DedupeKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, "8–128 chars of [A-Za-z0-9._:-]");
export const BotIdSchema = z.string().regex(BOT_ID_PATTERN, "lowercase slug, 2–48 chars");

export const BOT_STATES = ["working", "idle", "blocked", "offline"] as const;

export const BotStatusItemSchema = z.strictObject({
  title: text(120),
  status: text(40).optional(),
  url: httpsUrl.optional(),
});

export const BotStatusEntrySchema = z.strictObject({
  bot_id: BotIdSchema,
  display_name: text(60),
  role: text(120).optional(),
  state: z.enum(BOT_STATES),
  summary: text(280),
  items: z.array(BotStatusItemSchema).max(5).default([]),
  as_of: isoDateTime,
});

export const BotStatusDigestSchema = z.strictObject({
  v: z.literal(1),
  dedupe_key: DedupeKeySchema,
  bots: z.array(BotStatusEntrySchema).min(1).max(12),
});

export const BotMessageSchema = z.strictObject({
  v: z.literal(1),
  dedupe_key: DedupeKeySchema,
  /** Exactly one of companion_id / companion_name; resolved server-side against the owner's companions. */
  to: z
    .strictObject({
      companion_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
      companion_name: text(60).optional(),
    })
    .refine((t) => Boolean(t.companion_id) !== Boolean(t.companion_name), "give exactly one of companion_id or companion_name"),
  body: text(2000, { multiline: true }),
  sent_at: isoDateTime,
  /** Optional link back to an outbound anima→bot action this answers. */
  in_reply_to: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

export type BotStatusEntry = z.infer<typeof BotStatusEntrySchema>;
export type BotStatusDigest = z.infer<typeof BotStatusDigestSchema>;
export type BotMessage = z.infer<typeof BotMessageSchema>;

/** Validation issues as paths + messages only, never the submitted values. */
export function describeIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

/** as_of / sent_at may not be more than this far in the future. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function isTooFarInFuture(iso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t - nowMs > MAX_FUTURE_SKEW_MS;
}
