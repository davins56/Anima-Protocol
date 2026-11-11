/**
 * Sacred Space experiences as companion-scoped memory.
 *
 * A completed session becomes ONE `milestone` row in memory_events
 * (payload.kind = "sacred_space_experience") owned by the participating
 * character. No new table, no migration, no second memory system:
 *
 * - Scope: every read filters user_id AND character_id. Another companion
 *   sees nothing unless the user explicitly shares, which appends a copy under
 *   the target character (payload.shared_from_event_id). Nothing is ever
 *   promoted to a user fact.
 * - Content: a deterministic digest (focus, the user's own words, their
 *   reflection). The transcript is never stored and never reaches a prompt,
 *   and no emotion is inferred. A session without a reflection records that
 *   plainly.
 * - Forgetting: memory_events is append-only, so forgetting appends
 *   retractions for the row and every shared copy. Optional `retention_days`
 *   expires an experience without a write.
 * - Idempotent: dedupe key `sacred_space:<sessionId>` (per user).
 *
 * Pure builders and the service functions take a store, so scoping is
 * unit-testable without Postgres; `pgSacredSpaceStore` is the SQL binding.
 */
import { getPool } from "@workspace/db";
import { appendMemoryEvent } from "../memoryCore/memoryCore";

export const SACRED_SPACE_KIND = "sacred_space_experience";
export const SACRED_SPACE_EVENT_TYPE = "milestone";
const MAX_DISCLOSURES = 3;
const DISCLOSURE_MIN_CHARS = 30;
const DISCLOSURE_MAX_CHARS = 240;
const REFLECTION_MAX_CHARS = 600;
const MAX_RETENTION_DAYS = 3650;

export type SacredSpaceTurn = { role: string; content: string };

export type SacredSpaceExperience = {
  id: string;
  userId: string;
  characterId: string;
  content: string;
  occurredAt: string;
  emotionalWeight: number;
  payload: {
    kind: typeof SACRED_SPACE_KIND;
    session_id: string;
    ritual_focus: string;
    character_name: string;
    disclosures: string[];
    reflection: string | null;
    has_reflection: boolean;
    exchange_count: number;
    retention_days: number | null;
    shared_from_event_id?: string;
    shared_from_character_name?: string;
    shared_at?: string;
  };
};

export type SacredSpaceRecordInput = {
  userId: string;
  characterId: string;
  characterName?: string;
  sessionId: string;
  ritualFocus?: string;
  transcript?: SacredSpaceTurn[];
  reflection?: string;
  /** Only a value the user supplied; never derived from the transcript. */
  significance?: number | null;
  retentionDays?: number | null;
  occurredAt?: string;
};

const clean = (s: unknown, max: number) =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The user's own longest turns, in the order they said them. */
export function pickDisclosures(transcript: SacredSpaceTurn[] | undefined): string[] {
  const turns = (transcript ?? [])
    .map((t, i) => ({ i, role: t?.role, text: clean(t?.content, DISCLOSURE_MAX_CHARS) }))
    .filter((t) => t.role === "user" && t.text.length >= DISCLOSURE_MIN_CHARS);
  return turns
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MAX_DISCLOSURES)
    .sort((a, b) => a.i - b.i)
    .map((t) => t.text);
}

export function buildSacredSpaceContent(args: {
  characterName?: string;
  ritualFocus?: string;
  disclosures: string[];
  reflection: string | null;
  exchangeCount: number;
}): string {
  const focus = args.ritualFocus ? ` with a ${args.ritualFocus} focus` : "";
  const parts = [`You and the user shared a private Sacred Space session${focus} (${args.exchangeCount} exchanges).`];
  if (args.disclosures.length) {
    parts.push(`What they said: ${args.disclosures.map((d) => `"${d}"`).join(" / ")}.`);
  } else {
    parts.push("They shared little in words.");
  }
  parts.push(args.reflection ? `Their reflection afterward: "${args.reflection}".` : "They left no written reflection.");
  return parts.join(" ");
}

export function buildSacredSpaceExperience(
  input: SacredSpaceRecordInput,
): Omit<SacredSpaceExperience, "id"> | null {
  const sessionId = clean(input.sessionId, 120);
  if (!input.userId || !input.characterId || !sessionId) return null;
  const transcript = input.transcript ?? [];
  const disclosures = pickDisclosures(transcript);
  const reflection = clean(input.reflection, REFLECTION_MAX_CHARS) || null;
  const exchangeCount = transcript.filter((t) => t?.role === "user").length;
  const ritualFocus = clean(input.ritualFocus, 40);
  const retention = Number(input.retentionDays);
  const significance = Number(input.significance);
  return {
    userId: input.userId,
    characterId: input.characterId,
    occurredAt: input.occurredAt || new Date().toISOString(),
    // Neutral unless the user said how much it mattered.
    emotionalWeight: Number.isFinite(significance) ? Math.min(1, Math.max(0, significance)) : 0.5,
    content: buildSacredSpaceContent({
      characterName: input.characterName,
      ritualFocus,
      disclosures,
      reflection,
      exchangeCount,
    }),
    payload: {
      kind: SACRED_SPACE_KIND,
      session_id: sessionId,
      ritual_focus: ritualFocus,
      character_name: clean(input.characterName, 120),
      disclosures,
      reflection,
      has_reflection: Boolean(reflection),
      exchange_count: exchangeCount,
      retention_days:
        Number.isFinite(retention) && retention > 0 ? Math.min(MAX_RETENTION_DAYS, Math.floor(retention)) : null,
    },
  };
}

export function isExpired(e: Pick<SacredSpaceExperience, "occurredAt" | "payload">, now = Date.now()): boolean {
  const days = e.payload.retention_days;
  if (!days) return false;
  const t = Date.parse(e.occurredAt);
  return Number.isFinite(t) && now > t + days * 86_400_000;
}

/** How an experience reads in the prompt: owned vs. explicitly shared. */
export function experiencePromptText(e: SacredSpaceExperience): string {
  const focus = e.payload.ritual_focus ? ` (${e.payload.ritual_focus} focus)` : "";
  if (e.payload.shared_from_event_id) {
    const from = e.payload.shared_from_character_name || "another companion";
    return `Sacred Space${focus} — the user chose to share this session with you; they were with ${from}, not you. ${e.content}`;
  }
  return `Sacred Space${focus} — you were there. ${e.content}`;
}

export interface SacredSpaceStore {
  /** Inserts unless dedupeKey exists for the user; returns the new id or null. */
  insert(e: Omit<SacredSpaceExperience, "id"> & { dedupeKey: string }): Promise<string | null>;
  /** Unretracted rows for exactly (user, character). */
  list(userId: string, characterId: string, limit: number): Promise<SacredSpaceExperience[]>;
  get(userId: string, eventId: string): Promise<SacredSpaceExperience | null>;
  /** Unretracted rows copied from `eventId`. */
  copiesOf(userId: string, eventId: string): Promise<SacredSpaceExperience[]>;
  retract(userId: string, event: SacredSpaceExperience, reason: string): Promise<void>;
}

export async function recordSacredSpaceExperience(
  store: SacredSpaceStore,
  input: SacredSpaceRecordInput,
): Promise<{ id: string | null; duplicate: boolean } | null> {
  const built = buildSacredSpaceExperience(input);
  if (!built) return null;
  const id = await store.insert({ ...built, dedupeKey: `sacred_space:${built.payload.session_id}` });
  return { id, duplicate: id === null };
}

/** Experiences this character may recall: its own and ones shared to it. */
export async function loadSacredSpaceExperiences(
  store: SacredSpaceStore,
  userId: string,
  characterId: string,
  limit = 6,
  now = Date.now(),
): Promise<SacredSpaceExperience[]> {
  if (!userId || !characterId) return [];
  const rows = await store.list(userId, characterId, limit * 2);
  return rows
    .filter((e) => e.userId === userId && e.characterId === characterId && !isExpired(e, now))
    .slice(0, limit);
}

/** Explicit sharing: one copy per target; the original stays where it is. */
export async function shareSacredSpaceExperience(
  store: SacredSpaceStore,
  args: { userId: string; eventId: string; fromCharacterId: string; toCharacterId: string; at?: string },
): Promise<string | null> {
  const src = await store.get(args.userId, args.eventId);
  if (
    !src ||
    src.userId !== args.userId ||
    src.characterId !== args.fromCharacterId ||
    args.toCharacterId === args.fromCharacterId ||
    !args.toCharacterId
  ) {
    return null;
  }
  return store.insert({
    userId: args.userId,
    characterId: args.toCharacterId,
    content: src.content,
    occurredAt: src.occurredAt,
    emotionalWeight: src.emotionalWeight,
    payload: {
      ...src.payload,
      shared_from_event_id: src.id,
      shared_from_character_name: src.payload.character_name,
      shared_at: args.at || new Date().toISOString(),
    },
    dedupeKey: `sacred_space_share:${src.id}:${args.toCharacterId}`,
  });
}

/** Forget an experience and every copy shared from it. Returns rows retracted. */
export async function forgetSacredSpaceExperience(
  store: SacredSpaceStore,
  args: { userId: string; eventId: string; characterId: string; reason?: string },
): Promise<number> {
  const src = await store.get(args.userId, args.eventId);
  if (!src || src.userId !== args.userId || src.characterId !== args.characterId) return 0;
  const reason = args.reason || "user_forgot";
  const copies = src.payload.shared_from_event_id ? [] : await store.copiesOf(args.userId, src.id);
  for (const e of [src, ...copies]) await store.retract(args.userId, e, reason);
  return 1 + copies.length;
}

/** Stop sharing with one companion without touching the original. */
export async function unshareSacredSpaceExperience(
  store: SacredSpaceStore,
  args: { userId: string; eventId: string; fromCharacterId: string; toCharacterId: string },
): Promise<number> {
  const src = await store.get(args.userId, args.eventId);
  if (!src || src.characterId !== args.fromCharacterId) return 0;
  const copies = (await store.copiesOf(args.userId, src.id)).filter((c) => c.characterId === args.toCharacterId);
  for (const c of copies) await store.retract(args.userId, c, "share_revoked");
  return copies.length;
}

type Row = {
  id: string;
  user_id: string;
  character_id: string;
  content: string;
  occurred_at: string | Date;
  emotional_weight: number;
  payload: SacredSpaceExperience["payload"];
};

const toExperience = (r: Row): SacredSpaceExperience => ({
  id: r.id,
  userId: r.user_id,
  characterId: r.character_id,
  content: r.content,
  occurredAt: new Date(r.occurred_at).toISOString(),
  emotionalWeight: Number(r.emotional_weight),
  payload: r.payload,
});

const LIVE = `e.event_type = $KIND_TYPE AND e.payload ->> 'kind' = $KIND
  AND NOT EXISTS (SELECT 1 FROM memory_events r
                   WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
                     AND r.payload ->> 'target_event_id' = e.id::text)`;
const live = (typeIdx: number, kindIdx: number) =>
  LIVE.replace("$KIND_TYPE", `$${typeIdx}`).replace("$KIND", `$${kindIdx}`);

export const pgSacredSpaceStore: SacredSpaceStore = {
  async insert(e) {
    return appendMemoryEvent(
      {
        userId: e.userId,
        characterId: e.characterId,
        eventType: SACRED_SPACE_EVENT_TYPE,
        content: e.content,
        payload: e.payload,
        emotionalWeight: e.emotionalWeight,
        dedupeKey: e.dedupeKey,
        source: "sacred_space",
        occurredAt: e.occurredAt,
      },
      { embed: true },
    );
  },
  async list(userId, characterId, limit) {
    const { rows } = await getPool().query<Row>(
      `SELECT e.id, e.user_id, e.character_id, e.content, e.occurred_at, e.emotional_weight, e.payload
         FROM memory_events e
        WHERE e.user_id = $1 AND e.character_id = $2 AND ${live(3, 4)}
        ORDER BY e.occurred_at DESC LIMIT $5`,
      [userId, characterId, SACRED_SPACE_EVENT_TYPE, SACRED_SPACE_KIND, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map(toExperience);
  },
  async get(userId, eventId) {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
    const { rows } = await getPool().query<Row>(
      `SELECT e.id, e.user_id, e.character_id, e.content, e.occurred_at, e.emotional_weight, e.payload
         FROM memory_events e
        WHERE e.user_id = $1 AND e.id = $2::uuid AND ${live(3, 4)}`,
      [userId, eventId, SACRED_SPACE_EVENT_TYPE, SACRED_SPACE_KIND],
    );
    return rows[0] ? toExperience(rows[0]) : null;
  },
  async copiesOf(userId, eventId) {
    const { rows } = await getPool().query<Row>(
      `SELECT e.id, e.user_id, e.character_id, e.content, e.occurred_at, e.emotional_weight, e.payload
         FROM memory_events e
        WHERE e.user_id = $1 AND e.payload ->> 'shared_from_event_id' = $2 AND ${live(3, 4)}`,
      [userId, eventId, SACRED_SPACE_EVENT_TYPE, SACRED_SPACE_KIND],
    );
    return rows.map(toExperience);
  },
  async retract(userId, event, reason) {
    await appendMemoryEvent(
      {
        userId,
        characterId: event.characterId,
        eventType: "retraction",
        content: `Forgotten Sacred Space experience ${event.id}`,
        payload: { target_event_id: event.id, reason },
        emotionalWeight: 0,
        dedupeKey: `retract:${event.id}`,
        source: "sacred_space",
      },
      { embed: false },
    );
  },
};
