/**
 * Scene Mind — character-switching director for group / crossover chats.
 *
 * Picks which participant speaks next for a turn. This is separate from the
 * LLM ensemble ("minds drafting") layer: ensemble improves one reply; Scene
 * Mind chooses which companion owns that reply.
 *
 * Selection policy (first match wins):
 *   1. forceCharacterId (orchestrator / UI pin) when it is a participant
 *   2. Addressed speakers in order (name, nickname/alias, @mention, or a
 *      vocative / message starting with their name), whether the user or
 *      another character did the addressing. Remaining addressees speak
 *      on subsequent turns, then the picker returns to random.
 *   3. Optional LLM director (when askDirector is provided and succeeds)
 *   4. Uniform random among eligible participants, never the same character
 *      twice in a row unless they are the only option
 *   5. Optional interrupt (off by default) that swaps to another eligible speaker
 *
 * Core heuristics live in pickNextSpeakers (mirrored on the client).
 */

import {
  pickNextSpeakers,
  type SpeakerParticipant,
} from "./pickNextSpeakers";

export interface SceneMindCharacter extends SpeakerParticipant {
  id: string;
  name: string;
  universe?: string | null;
  personality?: string | null;
  nickname?: string | null;
  aka?: string | null;
  aliases?: string[] | string | null;
}

export interface SceneMindMessage {
  role?: string | null;
  content?: string | null;
  character_id?: string | null;
  characterId?: string | null;
  character_name?: string | null;
  characterName?: string | null;
}

export type SceneMindReason =
  | "forced"
  | "addressed"
  | "director"
  | "random"
  | "least_recent"
  | "interrupt"
  | "fallback";

export interface SceneMindDecision {
  characterId: string;
  characterName: string;
  reason: SceneMindReason;
  interrupted: boolean;
  /** Character the director (or random rule) preferred before interrupt. */
  preferredCharacterId: string | null;
  lastSpeakerId: string | null;
  lastSpeakerName: string | null;
  /** Remaining addressed speakers after the one chosen for this turn. */
  pendingCharacterIds: string[];
}

export interface SelectNextSpeakerParams {
  characters: SceneMindCharacter[];
  recentMessages?: SceneMindMessage[];
  userMessage?: string;
  forceCharacterId?: string | null;
  /** Limit the pool (e.g. intimacy-eligible ids from the client). */
  eligibleCharacterIds?: string[] | null;
  /**
   * Chance (0–1) to pick an out-of-turn interrupter. Default 0 — companions
   * should answer what the user just said, not randomly cut in. Pass an
   * explicit value (e.g. 0.35) to re-enable out-of-turn reactions.
   */
  interruptChance?: number;
  /** Inject RNG for tests. */
  random?: () => number;
  /**
   * Optional LLM director. Receives a prompt and should return a character
   * name (exact). Failures / unknown names fall through to random.
   */
  askDirector?: (prompt: string) => Promise<string | null>;
  /** Skip the LLM director even when askDirector is set. */
  useDirector?: boolean;
  isContinue?: boolean;
}

function normalizeId(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeName(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export { isCharacterAddressed } from "./pickNextSpeakers";

export function findCharacterByName(
  characters: SceneMindCharacter[],
  name: string | null | undefined,
): SceneMindCharacter | null {
  const needle = normalizeName(name).toLowerCase();
  if (!needle) return null;
  return (
    characters.find((c) => normalizeName(c.name).toLowerCase() === needle) ||
    null
  );
}

export function findCharacterById(
  characters: SceneMindCharacter[],
  id: string | null | undefined,
): SceneMindCharacter | null {
  const needle = normalizeId(id);
  if (!needle) return null;
  return characters.find((c) => normalizeId(c.id) === needle) || null;
}

function speakerIdFromMessage(
  msg: SceneMindMessage,
  characters: SceneMindCharacter[],
): string | null {
  const byId = normalizeId(msg.character_id ?? msg.characterId);
  if (byId && characters.some((c) => normalizeId(c.id) === byId)) return byId;
  const byName = findCharacterByName(
    characters,
    msg.character_name ?? msg.characterName,
  );
  return byName ? normalizeId(byName.id) : null;
}

function speakerNameFromMessage(
  msg: SceneMindMessage,
  characters: SceneMindCharacter[],
): string | null {
  const id = speakerIdFromMessage(msg, characters);
  if (id) {
    const match = findCharacterById(characters, id);
    if (match) return normalizeName(match.name);
  }
  const raw = normalizeName(msg.character_name ?? msg.characterName);
  return raw || null;
}

/** Recent assistant speakers newest-last, excluding narrator/system labels. */
export function recentAssistantSpeakers(
  messages: SceneMindMessage[],
  characters: SceneMindCharacter[],
  limit = 6,
): { id: string | null; name: string | null }[] {
  const ignored = new Set([
    "narrator",
    "__typing__",
    "__thinking__",
    "orchestrator",
  ]);
  const out: { id: string | null; name: string | null }[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const name = speakerNameFromMessage(msg, characters);
    if (!name || ignored.has(name.toLowerCase())) continue;
    out.unshift({
      id: speakerIdFromMessage(msg, characters),
      name,
    });
  }
  return out;
}

function resolveEligiblePool(
  characters: SceneMindCharacter[],
  eligibleCharacterIds?: string[] | null,
): SceneMindCharacter[] {
  if (!eligibleCharacterIds?.length) return characters;
  const allowed = new Set(eligibleCharacterIds.map((id) => normalizeId(id)));
  const filtered = characters.filter((c) => allowed.has(normalizeId(c.id)));
  return filtered.length > 0 ? filtered : characters;
}

export function buildDirectorPrompt(params: {
  characters: SceneMindCharacter[];
  recentMessages: SceneMindMessage[];
  lastSpeakerName: string | null;
  userMessage?: string;
  isContinue?: boolean;
}): string {
  const charSummaries = params.characters
    .map(
      (c) =>
        `- ${c.name}${c.universe ? ` (${c.universe})` : ""}: ${(c.personality || "").slice(0, 120)}`,
    )
    .join("\n");

  const recentConvoSnippet = params.recentMessages
    .slice(-6)
    .map((m) => {
      const speaker =
        m.role === "user"
          ? "User"
          : String(m.character_name || m.characterName || "Character");
      return `${speaker}: ${String(m.content || "").slice(0, 120)}`;
    })
    .join("\n");

  const continueNote = params.isContinue
    ? "\n- The user asked to Continue — advance the scene with whoever should take the next beat"
    : "";

  return `You are the Scene Mind for a multi-character chat — a narrative director that picks ONE companion to speak next.

Characters:
${charSummaries}

Recent conversation:
${recentConvoSnippet || "(empty)"}

Latest user message: ${String(params.userMessage || "").slice(0, 240) || "(continue)"}
Last speaker: ${params.lastSpeakerName || "none"}

Rules:
- Choose whoever has the strongest in-character reason to react RIGHT NOW
- The same character can speak again if it makes narrative sense
- Consider who might be provoked, excited, curious, threatened, or emotionally moved
- Pick the character who would most authentically respond
- Reply with ONLY the character's exact name — nothing else${continueNote}`;
}

function pickInterrupter(
  pool: SceneMindCharacter[],
  preferred: SceneMindCharacter,
  recentMessages: SceneMindMessage[],
  recentSpeakerNames: Set<string>,
): SceneMindCharacter | null {
  const interruptPool = pool.filter(
    (c) => normalizeId(c.id) !== normalizeId(preferred.id),
 );
  if (interruptPool.length === 0) return null;

  const recentMentioned = recentMessages
    .slice(-10)
    .map((m) => normalizeName(m.character_name ?? m.characterName).toLowerCase())
    .filter(Boolean);

  const preferredMentioned = interruptPool.filter((c) =>
    recentMentioned.includes(normalizeName(c.name).toLowerCase()),
  );
  if (preferredMentioned[0]) return preferredMentioned[0];

  const lowerRecent = new Set(
    [...recentSpeakerNames].map((n) => n.toLowerCase()),
  );
  return (
    interruptPool.find(
      (c) => !lowerRecent.has(normalizeName(c.name).toLowerCase()),
    ) ||
    interruptPool[0] ||
    null
  );
}

/**
 * Select the next speaker for a group turn.
 * Pure when askDirector is omitted; async so an optional director can be awaited.
 */
export async function selectNextSpeaker(
  params: SelectNextSpeakerParams,
): Promise<SceneMindDecision | null> {
  const characters = (params.characters || []).filter(
    (c) => normalizeId(c.id) && normalizeName(c.name),
  );
  if (characters.length === 0) return null;

  const recentMessages = params.recentMessages || [];
  const random = params.random ?? Math.random;
  const interruptChance =
    typeof params.interruptChance === "number"
      ? Math.min(1, Math.max(0, params.interruptChance))
      : 0;

  const speakers = recentAssistantSpeakers(recentMessages, characters);
  const last = speakers[speakers.length - 1] || null;
  const recentSpeakerNames = new Set(
    speakers.map((s) => s.name).filter(Boolean) as string[],
  );

  const userMessage = String(params.userMessage || "");
  const heuristic = pickNextSpeakers({
    participants: characters,
    lastSpeakerId: last?.id ?? null,
    latestMessage: userMessage,
    recentMessages,
    forceCharacterId: params.forceCharacterId,
    eligibleCharacterIds: params.eligibleCharacterIds,
    rng: random,
  });

  const lastSpeakerId = heuristic.lastSpeakerId ?? last?.id ?? null;
  const lastSpeakerName =
    (lastSpeakerId && findCharacterById(characters, lastSpeakerId)?.name) ||
    last?.name ||
    null;

  const decision = (
    chosen: SceneMindCharacter,
    reason: SceneMindReason,
    extras: {
      interrupted?: boolean;
      preferredCharacterId?: string | null;
      pendingCharacterIds?: string[];
    } = {},
  ): SceneMindDecision => ({
    characterId: chosen.id,
    characterName: chosen.name,
    reason,
    interrupted: Boolean(extras.interrupted),
    preferredCharacterId: extras.preferredCharacterId ?? chosen.id,
    lastSpeakerId,
    lastSpeakerName,
    pendingCharacterIds: extras.pendingCharacterIds ?? [],
  });

  if (!heuristic.next) return null;

  if (heuristic.reason === "forced" || heuristic.reason === "addressed") {
    return decision(heuristic.next, heuristic.reason, {
      pendingCharacterIds: heuristic.speakers.slice(1).map((c) => c.id),
    });
  }

  const pool = resolveEligiblePool(characters, params.eligibleCharacterIds);

  // Optional LLM director — only when no one was addressed and the caller
  // opted in. Failures fall through to the random heuristic.
  let preferred: SceneMindCharacter | null = heuristic.next;
  let reason: SceneMindReason = heuristic.reason;
  const shouldAskDirector =
    params.useDirector !== false &&
    typeof params.askDirector === "function" &&
    pool.length >= 2;

  if (shouldAskDirector) {
    try {
      const prompt = buildDirectorPrompt({
        characters: pool,
        recentMessages,
        lastSpeakerName,
        userMessage,
        isContinue: params.isContinue,
      });
      const raw = await params.askDirector!(prompt);
      const directed = findCharacterByName(pool, raw);
      if (directed) {
        preferred = directed;
        reason = "director";
      }
    } catch {
      // fall through to random
    }
  }

  if (!preferred) return null;

  // Interrupt / out-of-turn reaction — off by default so the companion
  // answers the user's actual message instead of a random side character cutting in.
  const allowInterrupt =
    !params.isContinue && pool.length >= 2 && random() < interruptChance;

  if (allowInterrupt) {
    const interrupter = pickInterrupter(
      pool,
      preferred,
      recentMessages,
      recentSpeakerNames,
    );
    if (interrupter) {
      return decision(interrupter, "interrupt", {
        interrupted: true,
        preferredCharacterId: preferred.id,
      });
    }
  }

  return decision(preferred, reason);
}
