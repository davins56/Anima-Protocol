/**
 * Compiles CharacterJournal "chronicle" entries from recent chat.
 *
 * The Chronicles page reads `entities.CharacterJournal` and calls
 * `compileDailyChronicles` expecting `{ compiled, updated, skipped }`.
 * Until this module, that invoke only summarised `data.messages` from the
 * request body (usually empty) and never wrote a journal row.
 *
 * Entries are one per (user, character, local calendar day). Re-compiles
 * are incremental: already-chronicled message ids are skipped, and new
 * messages on the same day update the existing row instead of inserting
 * another. No schema change — the cursor lives on the journal JSON
 * (`chronicle_date`, `source_message_ids`, `last_source_at`).
 */
import { and, eq, gte, or, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  db,
  makeId,
  userEntities,
  userProfiles,
} from "@workspace/db";
import { SENSES_PROFILE_KEY } from "../kernel/senses";
import { regionHintsFromProfile } from "../regionalWorldKnowledge";
import { parseJsonLoose } from "../exploreInsights";
import { createChatCompletionWithFailover } from "../llmFailover";
import { logger } from "../logger";
import { notifyUser } from "../storeEvents";
import { visibleAssistantReply } from "../visibleAssistantReply";

export const CHARACTER_JOURNAL = "CharacterJournal";
export const CHARACTER_ENTITY = "Character";

/** Cloudflare cron: every 3 hours, same minute as the hourly drain. */
export const CHRONICLES_CRON = "15 0,3,6,9,12,15,18,21 * * *";

/** Calendar-day fallback when the user has no saved or senses timezone. */
export const DEFAULT_CHRONICLE_TIMEZONE = "America/New_York";

/** Include today and yesterday so a late-evening chat still updates after midnight. */
export const DEFAULT_LOOKBACK_DAYS = 2;
const MAX_USERS_PER_CYCLE = 100;
const MAX_GROUPS_PER_USER = 20;
const MAX_MESSAGES_FOR_PROMPT = 60;
const TONES = new Set([
  "hopeful",
  "melancholic",
  "angry",
  "reflective",
  "anxious",
  "peaceful",
  "confused",
]);

export type ChronicleStats = {
  compiled: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type ChronicleMessage = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  character_id: string;
  character_name?: string;
  created_date: string;
};

export type ChronicleDraft = {
  title: string;
  content: string;
  character_insights: string;
  key_moments: string[];
  emotional_tone: string;
};

export type ChronicleGenerateInput = {
  character_id: string;
  character_name: string;
  chronicle_date: string;
  messages: ChronicleMessage[];
  previous?: {
    title?: string;
    content?: string;
    character_insights?: string;
    key_moments?: string[];
    emotional_tone?: string;
  } | null;
};

export type ChronicleGenerator = (
  input: ChronicleGenerateInput,
) => Promise<ChronicleDraft>;

export type CompileChroniclesOptions = {
  now?: Date;
  timeZone?: string;
  lookbackDays?: number;
  generate?: ChronicleGenerator;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

export function chronicleDateFor(at: Date, timeZone = DEFAULT_CHRONICLE_TIMEZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at);
}

export function startOfChronicleDay(dateKey: string, timeZone = DEFAULT_CHRONICLE_TIMEZONE): Date {
  // Interpret YYYY-MM-DD as midnight in the given zone.
  const probe = new Date(`${dateKey}T12:00:00.000Z`);
  // Walk backward from noon UTC until the zoned calendar date matches, then
  // find the instant the date flipped. A linear search over 24h is enough.
  const target = dateKey;
  // Start 14 hours before UTC noon of that date, covering all zones.
  const t = new Date(probe.getTime() - 14 * 60 * 60 * 1000);
  t.setUTCMinutes(0, 0, 0);
  // Find first instant whose zoned date is target, at minute resolution then refine.
  const end = new Date(probe.getTime() + 14 * 60 * 60 * 1000);
  let found: Date | null = null;
  for (let ms = t.getTime(); ms <= end.getTime(); ms += 60 * 1000) {
    if (chronicleDateFor(new Date(ms), timeZone) === target) {
      found = new Date(ms);
      break;
    }
  }
  return found ?? new Date(`${dateKey}T00:00:00.000Z`);
}

function lookbackStart(now: Date, lookbackDays: number, timeZone: string): Date {
  const today = chronicleDateFor(now, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  // Subtract (lookbackDays - 1) calendar days from today, then take that day's start.
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const past = new Date(utcNoon - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
  const pastKey = `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, "0")}-${String(past.getUTCDate()).padStart(2, "0")}`;
  return startOfChronicleDay(pastKey, timeZone);
}

function messageCreatedAt(data: Record<string, unknown>, fallback: Date): string {
  const raw = data.created_date || data.timestamp || data.updated_date;
  if (typeof raw === "string" && !Number.isNaN(Date.parse(raw))) return raw;
  return fallback.toISOString();
}

function sessionCharacterIds(data: Record<string, unknown>): string[] {
  const ids = [
    asString(data.character_id),
    asString(data.active_character_id),
    ...asStringArray(data.character_ids),
    ...asStringArray(data.group_character_ids),
  ];
  return Array.from(new Set(ids.filter(Boolean)));
}

function charactersForMessage(
  msg: Record<string, unknown>,
  session: Record<string, unknown> | undefined,
): string[] {
  const fromMsg = asString(msg.character_id);
  if (fromMsg) return [fromMsg];
  const sessionIds = session ? sessionCharacterIds(session) : [];
  if (asString(msg.role) === "assistant" && sessionIds.length === 1) return sessionIds;
  if (asString(msg.role) === "assistant" && asString(msg.character_name) && sessionIds.length) {
    return [sessionIds[0]];
  }
  return sessionIds;
}

function normalizeTone(value: unknown): string {
  const tone = asString(value).toLowerCase();
  return TONES.has(tone) ? tone : "reflective";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export function extractiveChronicleDraft(input: ChronicleGenerateInput): ChronicleDraft {
  const lines = input.messages
    .map((m) => {
      const who =
        m.role === "assistant"
          ? m.character_name || input.character_name || "Companion"
          : "You";
      return `${who}: ${asString(m.content)}`;
    })
    .filter((line) => line.split(": ").slice(1).join(": ").trim());
  const moments = lines.slice(-3).map((line) => clip(line, 180));
  const body = lines.length
    ? lines.slice(-12).map((line) => clip(line, 280)).join("\n")
    : "No messages yet.";
  return {
    title: clip(`${input.character_name}'s chronicle`, 80) || "Chronicle",
    content: clip(body, 1800),
    character_insights: "",
    key_moments: moments,
    emotional_tone: "reflective",
  };
}

function coerceDraft(raw: unknown, fallback: ChronicleDraft): ChronicleDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const rec = raw as Record<string, unknown>;
  const title = asString(rec.title) || fallback.title;
  const content = asString(rec.content) || fallback.content;
  if (!title || !content) return fallback;
  return {
    title: clip(title, 120),
    content: clip(content, 4000),
    character_insights: clip(asString(rec.character_insights) || fallback.character_insights, 800),
    key_moments: (Array.isArray(rec.key_moments) ? rec.key_moments : fallback.key_moments)
      .map((m) => clip(String(m ?? ""), 240))
      .filter(Boolean)
      .slice(0, 8),
    emotional_tone: normalizeTone(rec.emotional_tone ?? fallback.emotional_tone),
  };
}

export async function defaultGenerateChronicle(
  input: ChronicleGenerateInput,
): Promise<ChronicleDraft> {
  const fallback = extractiveChronicleDraft(input);
  const history = input.messages
    .slice(-MAX_MESSAGES_FOR_PROMPT)
    .map((m) => {
      const who =
        m.role === "assistant"
          ? m.character_name || input.character_name || "Companion"
          : m.role;
      return `${who}: ${asString(m.content)}`;
    })
    .join("\n");
  const previous = input.previous
    ? `\nExisting entry for this day (revise and extend; do not ignore earlier moments):\nTitle: ${input.previous.title || ""}\n${input.previous.content || ""}\n`
    : "";
  try {
    const result = await createChatCompletionWithFailover({
      tier: "light",
      maxTokens: 700,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "You are a narrative chronicler writing a private diary entry from the companion's point of view. Return ONLY JSON with keys: title, content, character_insights, key_moments (array of short strings), emotional_tone (one of hopeful, melancholic, angry, reflective, anxious, peaceful, confused). Write 2-3 short paragraphs in first person. Do not mention being an AI. Do not invent events that are not in the conversation.",
        },
        {
          role: "user",
          content: `Companion: ${input.character_name}\nDate: ${input.chronicle_date}\n${previous}\nConversation:\n${history || "No messages yet."}`,
        },
      ],
    });
    const visible = visibleAssistantReply(result.content);
    const parsed = parseJsonLoose<Record<string, unknown> | null>(visible, null);
    return coerceDraft(parsed, fallback);
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message, character_id: input.character_id },
      "chronicles: falling back to extractive draft",
    );
    return fallback;
  }
}

function journalDayKey(data: Record<string, unknown>, timeZone: string): string {
  const explicit = asString(data.chronicle_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const created = asString(data.created_date);
  if (created && !Number.isNaN(Date.parse(created))) {
    return chronicleDateFor(new Date(created), timeZone);
  }
  return "";
}

function existingSourceIds(data: Record<string, unknown>): Set<string> {
  return new Set(asStringArray(data.source_message_ids));
}

export function validChronicleTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim();
  if (!zone || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function timezoneFromSavedProfile(data: unknown): string | null {
  return validChronicleTimeZone(regionHintsFromProfile(data)?.timezone);
}

function timezoneFromSenses(data: unknown): string | null {
  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const senses = root[SENSES_PROFILE_KEY];
  const snap =
    senses && typeof senses === "object" && !Array.isArray(senses)
      ? (senses as Record<string, unknown>)
      : {};
  // Use the stored IANA zone even if the senses snapshot is stale — we only
  // need the calendar day, not a live "busy now" reading.
  return validChronicleTimeZone(snap.timezone);
}

/**
 * Saved profile timezone wins, then the rhythm/senses timezone, then
 * America/New_York. Invalid values are skipped.
 */
export function resolveChronicleTimeZone(profileData: unknown): string {
  return (
    timezoneFromSavedProfile(profileData) ||
    timezoneFromSenses(profileData) ||
    DEFAULT_CHRONICLE_TIMEZONE
  );
}

export async function loadChronicleTimeZone(userId: string): Promise<string> {
  if (!userId) return DEFAULT_CHRONICLE_TIMEZONE;
  const [row] = await db
    .select({ data: userProfiles.data })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return resolveChronicleTimeZone(row?.data ?? null);
}

/**
 * Compile chronicle entries for one signed-in Clerk user.
 * Never accepts a client-supplied user id — callers must pass the session id.
 */
export async function compileChroniclesForUser(
  userId: string,
  opts: CompileChroniclesOptions = {},
): Promise<ChronicleStats> {
  const stats: ChronicleStats = { compiled: 0, updated: 0, skipped: 0, failed: 0 };
  if (!userId) return stats;

  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone || (await loadChronicleTimeZone(userId));
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const generate = opts.generate ?? defaultGenerateChronicle;
  const since = lookbackStart(now, lookbackDays, timeZone);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('chronicles'), hashtext(${userId}))`,
    );

    const [sessions, messageRows, journalRows, characters] = await Promise.all([
      tx
        .select({
          entityId: userEntities.entityId,
          data: userEntities.data,
          createdAt: userEntities.createdAt,
        })
        .from(userEntities)
        .where(
          and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_SESSION)),
        ),
      tx
        .select({
          entityId: userEntities.entityId,
          data: userEntities.data,
          createdAt: userEntities.createdAt,
          updatedAt: userEntities.updatedAt,
        })
        .from(userEntities)
        .where(
          and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)),
        ),
      tx
        .select({
          entityId: userEntities.entityId,
          data: userEntities.data,
        })
        .from(userEntities)
        .where(
          and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHARACTER_JOURNAL)),
        ),
      tx
        .select({
          entityId: userEntities.entityId,
          data: userEntities.data,
        })
        .from(userEntities)
        .where(
          and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHARACTER_ENTITY)),
        ),
    ]);

    const sessionById = new Map<string, Record<string, unknown>>();
    for (const row of sessions) {
      sessionById.set(row.entityId, asRecord(row.data));
    }

    const characterName = new Map<string, string>();
    for (const row of characters) {
      const data = asRecord(row.data);
      const name = asString(data.name) || asString(data.title);
      if (name) characterName.set(row.entityId, name);
    }

    type Group = {
      character_id: string;
      chronicle_date: string;
      messages: ChronicleMessage[];
    };
    const groups = new Map<string, Group>();

    for (const row of messageRows) {
      const data = asRecord(row.data);
      const content = asString(data.content);
      if (!content) continue;
      const created = messageCreatedAt(data, row.createdAt ?? now);
      const createdDate = new Date(created);
      if (Number.isNaN(createdDate.getTime()) || createdDate < since) continue;
      const sessionId = asString(data.session_id);
      const session = sessionId ? sessionById.get(sessionId) : undefined;
      const charIds = charactersForMessage(data, session);
      if (charIds.length === 0) continue;
      const msgId = asString(data.id) || row.entityId;
      const role = asString(data.role) || "user";
      const characterLabel = asString(data.character_name);
      const day = chronicleDateFor(createdDate, timeZone);
      for (const characterId of charIds) {
        const key = `${characterId}::${day}`;
        let group = groups.get(key);
        if (!group) {
          group = { character_id: characterId, chronicle_date: day, messages: [] };
          groups.set(key, group);
        }
        if (group.messages.some((m) => m.id === msgId)) continue;
        group.messages.push({
          id: msgId,
          session_id: sessionId,
          role,
          content,
          character_id: characterId,
          character_name: characterLabel || characterName.get(characterId),
          created_date: created,
        });
      }
    }

    const journalsByKey = new Map<string, { entityId: string; data: Record<string, unknown> }>();
    for (const row of journalRows) {
      const data = asRecord(row.data);
      const characterId = asString(data.character_id);
      const day = journalDayKey(data, timeZone);
      if (!characterId || !day) continue;
      const key = `${characterId}::${day}`;
      if (!journalsByKey.has(key)) journalsByKey.set(key, { entityId: row.entityId, data });
    }

    const orderedGroups = Array.from(groups.values())
      .map((group) => {
        group.messages.sort(
          (a, b) => Date.parse(a.created_date) - Date.parse(b.created_date),
        );
        return group;
      })
      .sort((a, b) =>
        a.chronicle_date === b.chronicle_date
          ? a.character_id.localeCompare(b.character_id)
          : a.chronicle_date.localeCompare(b.chronicle_date),
      )
      .slice(0, MAX_GROUPS_PER_USER);

    let wrote = 0;
    for (const group of orderedGroups) {
      const key = `${group.character_id}::${group.chronicle_date}`;
      const existing = journalsByKey.get(key);
      const already = existing ? existingSourceIds(existing.data) : new Set<string>();
      const newIds = group.messages.filter((m) => !already.has(m.id)).map((m) => m.id);
      if (newIds.length === 0) {
        stats.skipped += 1;
        continue;
      }

      const promptMessages =
        group.messages.length > MAX_MESSAGES_FOR_PROMPT
          ? group.messages.slice(-MAX_MESSAGES_FOR_PROMPT)
          : group.messages;
      const name =
        characterName.get(group.character_id) ||
        promptMessages.find((m) => m.character_name)?.character_name ||
        "Companion";

      let draft: ChronicleDraft;
      try {
        draft = await generate({
          character_id: group.character_id,
          character_name: name,
          chronicle_date: group.chronicle_date,
          messages: promptMessages,
          previous: existing
            ? {
                title: asString(existing.data.title),
                content: asString(existing.data.content),
                character_insights: asString(existing.data.character_insights),
                key_moments: asStringArray(existing.data.key_moments),
                emotional_tone: asString(existing.data.emotional_tone),
              }
            : null,
        });
      } catch (err) {
        stats.failed += 1;
        logger.warn(
          { err: (err as Error)?.message, character_id: group.character_id },
          "chronicles: generator failed",
        );
        continue;
      }

      const nowIso = now.toISOString();
      const sourceIds = Array.from(
        new Set([...already, ...group.messages.map((m) => m.id)]),
      );
      const lastSourceAt = group.messages.reduce(
        (latest, m) => (m.created_date > latest ? m.created_date : latest),
        existing ? asString(existing.data.last_source_at) : "",
      );
      const sessionId =
        asString(existing?.data.session_id) ||
        group.messages[group.messages.length - 1]?.session_id ||
        "";
      const entityId = existing?.entityId || makeId();
      const createdDate = asString(existing?.data.created_date) || nowIso;
      const payload = {
        ...(existing?.data ?? {}),
        id: entityId,
        character_id: group.character_id,
        session_id: sessionId,
        title: draft.title,
        content: draft.content,
        character_insights: draft.character_insights,
        key_moments: draft.key_moments,
        emotional_tone: normalizeTone(draft.emotional_tone),
        chronicle_date: group.chronicle_date,
        source_message_ids: sourceIds,
        last_source_at: lastSourceAt || nowIso,
        created_date: createdDate,
        updated_date: nowIso,
      };

      if (existing) {
        await tx
          .update(userEntities)
          .set({ data: payload, updatedAt: now })
          .where(
            and(
              eq(userEntities.userId, userId),
              eq(userEntities.entityName, CHARACTER_JOURNAL),
              eq(userEntities.entityId, entityId),
            ),
          );
        stats.updated += 1;
      } else {
        await tx.insert(userEntities).values({
          userId,
          entityName: CHARACTER_JOURNAL,
          entityId,
          data: payload,
        });
        stats.compiled += 1;
      }
      wrote += 1;
    }

    if (wrote > 0) notifyUser(userId);
    return stats;
  });
}

/**
 * Cron entry: compile for every user with recent ChatMessage activity.
 */
export async function runChroniclesCycle(
  opts: CompileChroniclesOptions & { generate?: ChronicleGenerator } = {},
): Promise<ChronicleStats & { users: number }> {
  const now = opts.now ?? new Date();
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  // One extra UTC day so a far-east or far-west local "yesterday" is still
  // visible when we later split days in each user's own timezone.
  const since = lookbackStart(now, lookbackDays + 1, "UTC");

  const rows = await db
    .selectDistinct({ userId: userEntities.userId })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.entityName, CHAT_MESSAGE),
        or(
          gte(userEntities.updatedAt, since),
          gte(userEntities.createdAt, since),
        ),
      ),
    )
    .limit(MAX_USERS_PER_CYCLE);

  const totals: ChronicleStats & { users: number } = {
    compiled: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    users: rows.length,
  };

  for (const row of rows) {
    try {
      const one = await compileChroniclesForUser(row.userId, {
        ...opts,
        now,
        lookbackDays,
      });
      totals.compiled += one.compiled;
      totals.updated += one.updated;
      totals.skipped += one.skipped;
      totals.failed += one.failed;
    } catch (err) {
      totals.failed += 1;
      logger.warn(
        { err: (err as Error)?.message, userId: row.userId },
        "chronicles: cycle failed for user",
      );
    }
  }
  return totals;
}
