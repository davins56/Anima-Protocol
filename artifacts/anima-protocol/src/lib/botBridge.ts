/**
 * Anima ↔ Grok Bot bridge client (server: /api/bridge, see
 * artifacts/api-server/src/routes/botBridge.ts and docs/bot-bridge.md).
 *
 * Everything here is behind the server flag `ANIMA_BOT_BRIDGE` and the bridge
 * tables (migrations M1–M6, not yet approved). Until the server reports
 * `enabled: true`, the UI renders nothing. Any error, unexpected shape or
 * missing route counts as disabled (fail closed).
 *
 * Bot text is untrusted outside content: it is rendered as plain text only,
 * links are shown as text with their domain, never as HTML.
 */
import { z } from "zod";
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "@/lib/apiOrigin";

export const BOT_STATUS_STALE_MS = 6 * 60 * 60 * 1000;

export const BridgeConfigSchema = z.object({
  enabled: z.boolean(),
  capabilities: z
    .object({
      awareness: z.boolean().default(false),
      inboundMessages: z.boolean().default(false),
      outboundDrafts: z.boolean().default(false),
      standingPermission: z.boolean().default(false),
      remember: z.boolean().default(false),
    })
    .default({
      awareness: false,
      inboundMessages: false,
      outboundDrafts: false,
      standingPermission: false,
      remember: false,
    }),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
export const DISABLED_BRIDGE_CONFIG: BridgeConfig = BridgeConfigSchema.parse({ enabled: false });

export const BotStatusCardSchema = z.object({
  bot_id: z.string(),
  display_name: z.string(),
  role: z.string().optional(),
  state: z.enum(["working", "idle", "blocked", "offline"]),
  summary: z.string(),
  items: z.array(z.object({ title: z.string(), status: z.string().optional(), url: z.string().optional() })).default([]),
  as_of: z.string(),
});
export type BotStatusCard = z.infer<typeof BotStatusCardSchema>;

export const PERMISSION_MODES = ["ask", "allow"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const BotPermissionsSchema = z.object({
  companions: z.array(z.object({ id: z.string(), name: z.string() })),
  bots: z.array(z.object({ bot_id: z.string(), display_name: z.string() })),
  rules: z.array(
    z.object({ companion_id: z.string(), bot_id: z.string(), mode: z.enum(PERMISSION_MODES) }),
  ),
});
export type BotPermissions = z.infer<typeof BotPermissionsSchema>;

export type BotDraft = {
  actionId: string;
  companionName: string;
  botName: string;
  /** The exact text that would be sent. */
  text: string;
  expiresAt: string;
};

export type InboundBotMessage = {
  id: string;
  botName: string;
  body: string;
  receivedAt: string;
  flagged?: boolean;
};

type FetchOpts = { fetchImpl?: typeof fetch };

async function getJson(path: string, { fetchImpl = globalThis.fetch }: FetchOpts = {}) {
  const headers = await requireChatAuthHeaders();
  const res = await fetchImpl(apiUrl(path), { method: "GET", headers });
  return { res, body: res.ok ? await res.json().catch(() => null) : null };
}

function errorMessage(status: number): string {
  if (status === 503) return "The bot bridge is not enabled on this server.";
  if (status === 501) return "This part of the bot bridge isn't available yet.";
  if (status === 401) return "Sign in again to continue.";
  return "Could not reach the bot bridge.";
}

/** Server config. Anything other than a well-formed `enabled: true` is disabled. */
export async function loadBridgeConfig(opts: FetchOpts = {}): Promise<BridgeConfig> {
  try {
    const { res, body } = await getJson("/bridge/config", opts);
    if (!res.ok) return DISABLED_BRIDGE_CONFIG;
    const parsed = BridgeConfigSchema.safeParse(body);
    return parsed.success ? parsed.data : DISABLED_BRIDGE_CONFIG;
  } catch {
    return DISABLED_BRIDGE_CONFIG;
  }
}

export async function loadBotStatuses(
  opts: FetchOpts = {},
): Promise<{ ok: true; bots: BotStatusCard[] } | { ok: false; message: string }> {
  try {
    const { res, body } = await getJson("/bridge/bots", opts);
    if (!res.ok) return { ok: false, message: errorMessage(res.status) };
    const parsed = z.object({ bots: z.array(BotStatusCardSchema) }).safeParse(body);
    if (!parsed.success) return { ok: false, message: "Could not read bot status." };
    return { ok: true, bots: parsed.data.bots };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export async function loadBotPermissions(
  opts: FetchOpts = {},
): Promise<{ ok: true; permissions: BotPermissions } | { ok: false; message: string }> {
  try {
    const { res, body } = await getJson("/bridge/permissions", opts);
    if (!res.ok) return { ok: false, message: errorMessage(res.status) };
    const parsed = BotPermissionsSchema.safeParse(body);
    if (!parsed.success) return { ok: false, message: "Could not read bot permissions." };
    return { ok: true, permissions: parsed.data };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Send or cancel a pending anima→bot draft. The server re-checks everything. */
export async function decideBotDraft(
  actionId: string,
  decision: "send" | "cancel",
  { fetchImpl = globalThis.fetch }: FetchOpts = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const headers = await requireChatAuthHeaders();
    const res = await fetchImpl(apiUrl(`/bridge/drafts/${encodeURIComponent(actionId)}/decision`), {
      method: "POST",
      headers,
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) return { ok: false, message: errorMessage(res.status) };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Effective mode for a pair. Everything defaults to "ask". */
export function permissionModeFor(rules: BotPermissions["rules"], companionId: string, botId: string): PermissionMode {
  const rule = rules.find((r) => r.companion_id === companionId && r.bot_id === botId);
  return rule?.mode === "allow" ? "allow" : "ask";
}

export function isStatusStale(asOf: string, nowMs = Date.now()): boolean {
  const t = Date.parse(asOf);
  return !Number.isFinite(t) || nowMs - t > BOT_STATUS_STALE_MS;
}

export function relativeTime(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "at an unknown time";
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Display form of a bot-supplied link: "github.com" for https links, else null (not shown). */
export function linkDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
