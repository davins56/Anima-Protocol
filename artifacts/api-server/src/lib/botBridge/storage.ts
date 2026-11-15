/**
 * Storage seam for the bot bridge. The real implementation needs migrations
 * M1–M4 and M6 (registry, status, bridge_messages, tool_* CHECK widening,
 * bot_exchange recall fix), none of which are approved yet. Until then the
 * routes use `disabledBotBridgeStorage`, which reports itself unavailable,
 * so every route answers 503 `bridge_disabled` after verifying the request
 * and stores nothing.
 *
 * `createMemoryBotBridgeStorage` exists for tests only. It is never wired
 * into the app.
 */
import type { BotMessage, BotStatusEntry } from "./schemas";

export type RegisteredBot = {
  botId: string;
  /** Owner, from the server-side registry (M2). Never from the request. */
  userId: string;
  displayName: string;
  inboundEnabled: boolean;
};

export type InboundCounts = { botLastMinute: number; userLastDay: number };

export type SaveOutcome =
  | { status: "stored"; id: string }
  | { status: "duplicate" }
  | { status: "unknown_companion" };

export type DeniedReason = "killed" | "flagged_adult" | "rate_limited" | "inbound_disabled";

export interface BotBridgeStorage {
  readonly kind: "disabled" | "memory" | "postgres";
  /** False until the bridge tables exist and are reachable. */
  isAvailable(): Promise<boolean>;
  /** Registry lookup (M2). Null for an unregistered bot. */
  resolveBot(botId: string): Promise<RegisteredBot | null>;
  /** tool_user_settings.tools_killed or ANIMA_TOOLS_KILL. */
  isKilled(userId: string): Promise<boolean>;
  countInbound(userId: string, botId: string, nowMs: number): Promise<InboundCounts>;
  /** Upsert latest snapshot per (user_id, bot_id) (M3); dedupe on (user_id, dedupe_key). */
  saveStatus(bot: RegisteredBot, dedupeKey: string, entries: BotStatusEntry[], nowMs: number): Promise<SaveOutcome>;
  /** Append-only inbound message (M4); dedupe on (user_id, dedupe_key). */
  saveMessage(bot: RegisteredBot, message: BotMessage, flags: string[], nowMs: number): Promise<SaveOutcome>;
  /** Append-only audit of a dropped/denied inbound (tool_action_log 'denied' seq 1, M1). */
  logDenied(bot: RegisteredBot, reason: DeniedReason, nowMs: number): Promise<void>;
}

function unavailable(): never {
  throw new Error("bot bridge storage is not available (migrations M1–M4 not applied)");
}

export const disabledBotBridgeStorage: BotBridgeStorage = {
  kind: "disabled",
  isAvailable: async () => false,
  resolveBot: async () => null,
  isKilled: async () => true,
  countInbound: async () => unavailable(),
  saveStatus: async () => unavailable(),
  saveMessage: async () => unavailable(),
  logDenied: async () => undefined,
};

let activeStorage: BotBridgeStorage = disabledBotBridgeStorage;

/** The storage the routes use. Disabled until a migration-backed one exists. */
export function getBotBridgeStorage(): BotBridgeStorage {
  return activeStorage;
}

/** Tests only. */
export function setBotBridgeStorageForTests(storage: BotBridgeStorage | null): void {
  activeStorage = storage ?? disabledBotBridgeStorage;
}

export type MemoryBotBridgeStorage = BotBridgeStorage & {
  statuses: Map<string, BotStatusEntry & { userId: string; receivedAt: number }>;
  messages: Array<{ id: string; userId: string; botId: string; companionId: string; body: string; flags: string[]; receivedAt: number }>;
  denied: Array<{ userId: string; botId: string; reason: DeniedReason }>;
  inbound: Array<{ userId: string; botId: string; at: number }>;
  killed: Set<string>;
};

/** In-memory fake mirroring the planned DB semantics. Tests only. */
export function createMemoryBotBridgeStorage(
  bots: RegisteredBot[],
  companions: Array<{ userId: string; id: string; name: string }> = [],
): MemoryBotBridgeStorage {
  const registry = new Map(bots.map((b) => [b.botId, b]));
  const dedupe = new Set<string>();
  let seq = 0;
  const store: MemoryBotBridgeStorage = {
    kind: "memory",
    statuses: new Map(),
    messages: [],
    denied: [],
    inbound: [],
    killed: new Set(),
    isAvailable: async () => true,
    resolveBot: async (botId) => registry.get(botId) ?? null,
    isKilled: async (userId) => store.killed.has(userId),
    countInbound: async (userId, botId, nowMs) => ({
      botLastMinute: store.inbound.filter((r) => r.botId === botId && nowMs - r.at < 60_000).length,
      userLastDay: store.inbound.filter((r) => r.userId === userId && nowMs - r.at < 86_400_000).length,
    }),
    saveStatus: async (bot, dedupeKey, entries, nowMs) => {
      const key = `${bot.userId}:${dedupeKey}`;
      if (dedupe.has(key)) return { status: "duplicate" };
      dedupe.add(key);
      store.inbound.push({ userId: bot.userId, botId: bot.botId, at: nowMs });
      for (const entry of entries) {
        store.statuses.set(`${bot.userId}:${entry.bot_id}`, { ...entry, userId: bot.userId, receivedAt: nowMs });
      }
      return { status: "stored", id: `status-${++seq}` };
    },
    saveMessage: async (bot, message, flags, nowMs) => {
      const key = `${bot.userId}:${message.dedupe_key}`;
      if (dedupe.has(key)) return { status: "duplicate" };
      const companion = companions.find(
        (c) =>
          c.userId === bot.userId &&
          (message.to.companion_id
            ? c.id === message.to.companion_id
            : c.name.toLowerCase() === message.to.companion_name?.toLowerCase()),
      );
      if (!companion) return { status: "unknown_companion" };
      dedupe.add(key);
      store.inbound.push({ userId: bot.userId, botId: bot.botId, at: nowMs });
      const id = `msg-${++seq}`;
      store.messages.push({ id, userId: bot.userId, botId: bot.botId, companionId: companion.id, body: message.body, flags, receivedAt: nowMs });
      return { status: "stored", id };
    },
    logDenied: async (bot, reason) => {
      store.denied.push({ userId: bot.userId, botId: bot.botId, reason });
    },
  };
  return store;
}
