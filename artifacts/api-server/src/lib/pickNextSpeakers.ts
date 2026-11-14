/**
 * Intelligently-random group turn-taking.
 *
 * Policy:
 *   1. A forced / pinned participant speaks if they are in the group.
 *   2. If the latest message addresses one or more participants (name,
 *      nickname/alias, @mention, or a clear vocative / message starting
 *      with their name), those characters reply in the order they were
 *      addressed. Characters who have already spoken since that message
 *      are skipped. This applies whether the user or another character
 *      did the addressing.
 *   3. Otherwise pick uniformly at random, never the same character twice
 *      in a row unless they are the only option.
 *
 * Matching is word-boundary, case-insensitive, and diacritic-tolerant, so
 * a name inside a longer word does not trigger. Inject `rng` in tests.
 *
 * Twin implementation: `artifacts/anima-protocol/src/lib/pickNextSpeakers.js`.
 */

export interface SpeakerParticipant {
  id: string;
  name: string;
  nickname?: string | null;
  aka?: string | null;
  aliases?: string[] | string | null;
}

export interface SpeakerMessage {
  role?: string | null;
  content?: string | null;
  character_id?: string | null;
  characterId?: string | null;
  character_name?: string | null;
  characterName?: string | null;
  is_streaming?: boolean | null;
}

export type PickNextSpeakersReason = "forced" | "addressed" | "random" | "fallback";

export interface PickNextSpeakersParams {
  participants?: SpeakerParticipant[];
  lastSpeakerId?: string | null;
  latestMessage?: string | SpeakerMessage | null;
  recentMessages?: SpeakerMessage[];
  forceCharacterId?: string | null;
  eligibleCharacterIds?: string[] | null;
  rng?: () => number;
}

export interface PickNextSpeakersResult<T extends SpeakerParticipant = SpeakerParticipant> {
  speakers: T[];
  next: T | null;
  reason: PickNextSpeakersReason;
  lastSpeakerId: string | null;
}

export function foldText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201B\u2032`]/g, "'")
    .toLowerCase();
}

function normalizeId(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeName(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isWordChar(ch: string): boolean {
  if (!ch) return false;
  return /[\p{L}\p{N}_]/u.test(ch);
}

function asList(value: unknown): unknown[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  return [value];
}

/** Official name plus nickname/alias fields and a multi-word first name. */
export function collectAddressTerms(participant: SpeakerParticipant | null | undefined): string[] {
  if (!participant) return [];
  const official = normalizeName(participant.name);
  const raw = [
    official,
    normalizeName(participant.nickname),
    normalizeName(participant.aka),
    ...asList(participant.aliases).map((item) => normalizeName(item)),
  ];
  const parts = official.split(/\s+/).filter(Boolean);
  if (parts.length > 1) raw.push(parts[0]);

  const byFold = new Map<string, string>();
  for (const term of raw) {
    if (!term) continue;
    const folded = foldText(term);
    if (!folded) continue;
    const isOfficial = foldText(official) === folded;
    if (folded.length < 2 && !isOfficial) continue;
    const prev = byFold.get(folded);
    if (!prev || term.length > prev.length) byFold.set(folded, term);
  }
  return [...byFold.values()];
}

function findTermHits(foldedHaystack: string, foldedTerm: string): { index: number; atMention: boolean }[] {
  if (!foldedTerm || !foldedHaystack) return [];
  const hits: { index: number; atMention: boolean }[] = [];
  let from = 0;
  while (from <= foldedHaystack.length - foldedTerm.length) {
    const index = foldedHaystack.indexOf(foldedTerm, from);
    if (index < 0) break;
    const before = index === 0 ? "" : foldedHaystack[index - 1];
    const afterIndex = index + foldedTerm.length;
    const after = afterIndex >= foldedHaystack.length ? "" : foldedHaystack[afterIndex];
    if (!isWordChar(before) && !isWordChar(after)) {
      hits.push({ index, atMention: before === "@" });
    }
    from = index + 1;
  }
  return hits;
}

/**
 * True when `message` clearly addresses this character by name, nickname,
 * alias, or @mention. The second argument may be a name string or a
 * participant object (`{ name, nickname, aliases, aka }`).
 */
export function isCharacterAddressed(
  message: string,
  characterNameOrParticipant: string | SpeakerParticipant | null | undefined,
  extraAliases?: string[] | string | null,
): boolean {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  const participant: SpeakerParticipant =
    characterNameOrParticipant && typeof characterNameOrParticipant === "object"
      ? {
          ...characterNameOrParticipant,
          aliases: [
            ...asList(characterNameOrParticipant.aliases),
            ...asList(extraAliases),
          ] as string[],
        }
      : {
          id: "",
          name: String(characterNameOrParticipant ?? ""),
          aliases: extraAliases,
        };
  return findAddressedSpeakers(text, [participant]).length === 1;
}

/**
 * Participants addressed in `message`, in the order they were first
 * addressed. Ambiguous tokens that equally match two characters are skipped.
 */
export function findAddressedSpeakers<T extends SpeakerParticipant>(
  message: string,
  participants: T[] | null | undefined,
): T[] {
  const text = String(message ?? "");
  if (!text.trim()) return [];
  const pool = (participants || []).filter((c) => c && normalizeName(c.name));
  if (!pool.length) return [];

  const folded = foldText(text);
  const hits: { index: number; length: number; id: string; character: T }[] = [];
  for (const character of pool) {
    for (const term of collectAddressTerms(character)) {
      const foldedTerm = foldText(term);
      for (const hit of findTermHits(folded, foldedTerm)) {
        hits.push({
          index: hit.index,
          length: foldedTerm.length,
          id: normalizeId(character.id) || foldText(character.name),
          character,
        });
      }
    }
  }
  if (!hits.length) return [];

  hits.sort((a, b) => a.index - b.index || b.length - a.length);

  const reserved = new Map<number, { length: number; ids: Set<string> }>();
  for (const hit of hits) {
    const current = reserved.get(hit.index);
    if (!current) {
      reserved.set(hit.index, { length: hit.length, ids: new Set([hit.id]) });
      continue;
    }
    if (hit.length === current.length) current.ids.add(hit.id);
  }

  const usedIds = new Set<string>();
  const ordered: T[] = [];
  for (const hit of hits) {
    if (usedIds.has(hit.id)) continue;
    const slot = reserved.get(hit.index);
    if (!slot || slot.length !== hit.length || slot.ids.size !== 1) continue;
    usedIds.add(hit.id);
    ordered.push(hit.character);
  }
  return ordered;
}

function isIgnorableSpeakerName(name: unknown): boolean {
  const lower = normalizeName(name).toLowerCase();
  return (
    lower === "narrator" ||
    lower === "__typing__" ||
    lower === "__thinking__" ||
    lower === "orchestrator"
  );
}

function messageSpeakerId(
  message: SpeakerMessage | null | undefined,
  participants: SpeakerParticipant[],
): string | null {
  if (!message) return null;
  const byId = normalizeId(message.character_id ?? message.characterId);
  if (byId && participants.some((c) => normalizeId(c.id) === byId)) return byId;
  const needle = foldText(message.character_name ?? message.characterName);
  if (!needle) return null;
  const match = participants.find((c) => foldText(c.name) === needle);
  return match ? normalizeId(match.id) : null;
}

function isRealConversationMessage(message: SpeakerMessage | null | undefined): boolean {
  if (!message) return false;
  if (message.is_streaming) return false;
  const role = String(message.role || "").toLowerCase();
  if (role === "system") return false;
  const name = message.character_name ?? message.characterName;
  if (isIgnorableSpeakerName(name)) return false;
  return role === "user" || role === "assistant" || !role;
}

function resolveEligiblePool<T extends SpeakerParticipant>(
  participants: T[],
  eligibleCharacterIds?: string[] | null,
): T[] {
  if (!eligibleCharacterIds?.length) return participants;
  const allowed = new Set(eligibleCharacterIds.map((id) => normalizeId(id)));
  const filtered = participants.filter((c) => allowed.has(normalizeId(c.id)));
  return filtered.length > 0 ? filtered : participants;
}

function appendLatestMessage(
  recentMessages: SpeakerMessage[] | null | undefined,
  latestMessage: string | SpeakerMessage | null | undefined,
): SpeakerMessage[] {
  const recent = Array.isArray(recentMessages) ? [...recentMessages] : [];
  if (latestMessage == null || latestMessage === "") return recent;
  const extra: SpeakerMessage =
    typeof latestMessage === "object"
      ? latestMessage
      : { role: "user", content: String(latestMessage) };
  const text = String(extra.content ?? "").trim();
  if (!text) return recent;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    if (!isRealConversationMessage(message)) continue;
    if (String(message?.content ?? "").trim() === text) return recent;
    break;
  }
  return [...recent, extra];
}

function remainingAddressedFrom<T extends SpeakerParticipant>(
  messages: SpeakerMessage[],
  participants: T[],
  pool: T[],
): T[] {
  let stimulusIndex = -1;
  let stimulus: { queue: T[]; authorId: string | null } | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRealConversationMessage(message)) continue;
    const addressed = findAddressedSpeakers(String(message.content ?? ""), pool);
    const authorId = messageSpeakerId(message, participants);
    const queue = addressed.filter((c) => normalizeId(c.id) !== authorId);
    if (!queue.length) {
      if (stimulusIndex < 0) {
        const role = String(message.role || "").toLowerCase();
        if (role === "user") return [];
      }
      continue;
    }
    stimulusIndex = i;
    stimulus = { queue, authorId };
    break;
  }
  if (!stimulus) return [];

  const spoken = new Set<string>();
  for (let i = stimulusIndex + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (!isRealConversationMessage(message)) continue;
    if (String(message.role || "").toLowerCase() !== "assistant") continue;
    const id = messageSpeakerId(message, participants);
    if (id) spoken.add(id);
  }
  return stimulus.queue.filter((c) => !spoken.has(normalizeId(c.id)));
}

function lastAssistantSpeakerId(
  messages: SpeakerMessage[],
  participants: SpeakerParticipant[],
  explicitId: string | null | undefined,
): string | null {
  const explicit = normalizeId(explicitId);
  if (explicit) return explicit;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRealConversationMessage(message)) continue;
    if (String(message.role || "").toLowerCase() !== "assistant") continue;
    const id = messageSpeakerId(message, participants);
    if (id) return id;
  }
  return null;
}

function pickRandomCharacter<T extends SpeakerParticipant>(
  pool: T[],
  lastSpeakerId: string | null,
  rng: () => number,
): T | null {
  if (!pool.length) return null;
  const last = normalizeId(lastSpeakerId);
  const candidates = last ? pool.filter((c) => normalizeId(c.id) !== last) : pool;
  const usable = candidates.length ? candidates : pool;
  const roll = typeof rng === "function" ? rng() : Math.random();
  const clamped = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;
  const index = Math.min(usable.length - 1, Math.floor(clamped * usable.length));
  return usable[index] || usable[0] || null;
}

/**
 * Pick the next group speaker (and any remaining addressed speakers).
 */
export function pickNextSpeakers<T extends SpeakerParticipant>(
  params: PickNextSpeakersParams & { participants?: T[] } = {},
): PickNextSpeakersResult<T> {
  const all = (params.participants || []).filter(
    (c): c is T => Boolean(c && normalizeId(c.id) && normalizeName(c.name)),
  );
  if (!all.length) {
    return {
      speakers: [],
      next: null,
      reason: "fallback",
      lastSpeakerId: normalizeId(params.lastSpeakerId) || null,
    };
  }

  const messages = appendLatestMessage(params.recentMessages, params.latestMessage);
  const lastId = lastAssistantSpeakerId(messages, all, params.lastSpeakerId);

  const forcedId = normalizeId(params.forceCharacterId);
  if (forcedId) {
    const forced = all.find((c) => normalizeId(c.id) === forcedId);
    if (forced) {
      return {
        speakers: [forced],
        next: forced,
        reason: "forced",
        lastSpeakerId: lastId,
      };
    }
  }

  const pool = resolveEligiblePool(all, params.eligibleCharacterIds);
  const addressed = remainingAddressedFrom(messages, all, pool);
  if (addressed.length) {
    return {
      speakers: addressed,
      next: addressed[0]!,
      reason: "addressed",
      lastSpeakerId: lastId,
    };
  }

  const rng = params.rng ?? Math.random;
  const chosen = pickRandomCharacter(pool, lastId, rng);
  if (!chosen) {
    return { speakers: [], next: null, reason: "fallback", lastSpeakerId: lastId };
  }
  return {
    speakers: [chosen],
    next: chosen,
    reason: "random",
    lastSpeakerId: lastId,
  };
}
