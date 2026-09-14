/**
 * Source adapters: Anima Settings backups and ChatML JSON → TrainingExample[].
 *
 * The Settings → Export file is the format Dàvīn already has
 * (`anima-backup-*.json`). Drop it in `scripts/llm/data/raw/` or pass it to
 * `pnpm llm:ingest -- --from <file>` — do not commit real logs.
 */

import type { CharacterCard, ChatTurn, TrainingExample } from "./types";
import {
  DEFAULT_TRAIN_CHARACTERS,
  characterNameFromSystem,
  matchesAnyCharacter,
  namesMatch,
  normalizeCharacterKey,
} from "./characters";
import { splitExampleByCharacters } from "./split";

export interface SourceImportOptions {
  /** Restrict / split to these companion names. */
  characterNames?: string[];
  /** Keep every companion in an Anima backup (ignore the Serenity/Fallen Angel default). */
  allCharacters?: boolean;
  defaultCharacterName?: string;
  tags?: string[];
  source?: string;
  minTurns?: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
}

function asIdList(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : str(asObject(item).id)))
    .map((id) => id.trim())
    .filter(Boolean);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Settings → Export payload (`{ version, exported_at, entities, profile }`). */
export function isAnimaBackup(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entities = (value as Record<string, unknown>).entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) return false;
  const e = entities as Record<string, unknown>;
  return Array.isArray(e.ChatSession) || Array.isArray(e.ChatMessage);
}

export function isChatMlShape(
  value: unknown,
): value is { messages: Array<{ role: string; content: string; name?: string }>; system?: string } {
  if (!value || typeof value !== "object") return false;
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every((m) => {
    if (!m || typeof m !== "object") return false;
    const row = m as Record<string, unknown>;
    return typeof row.role === "string" && typeof row.content === "string";
  });
}

function characterCardFromEntity(data: Record<string, unknown>): CharacterCard {
  return {
    name: str(data.name) || "Companion",
    universe: data.universe ? str(data.universe) : undefined,
    personality: data.personality ? str(data.personality) : undefined,
    backstory: data.backstory ? str(data.backstory) : undefined,
    speakingStyle: data.speaking_style
      ? str(data.speaking_style)
      : data.speakingStyle
        ? str(data.speakingStyle)
        : undefined,
    voice: data.voice ? str(data.voice) : undefined,
    systemPrompt: data.system_prompt
      ? str(data.system_prompt)
      : data.systemPrompt
        ? str(data.systemPrompt)
        : undefined,
    archetype: data.archetype ? str(data.archetype) : undefined,
  };
}

function memoryLinesForCharacter(
  memories: Record<string, unknown>[],
  characterId: string | undefined,
): string[] {
  if (!characterId) return [];
  const lines: string[] = [];
  for (const mem of memories) {
    if (str(mem.character_id) !== characterId) continue;
    const fact = str(mem.fact || mem.content || mem.text || mem.summary).trim();
    if (fact) lines.push(fact);
  }
  return lines.slice(0, 24);
}

function sortMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...messages].sort((a, b) => {
    const seqA = Number(a.seq ?? a.index ?? NaN);
    const seqB = Number(b.seq ?? b.index ?? NaN);
    if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) return seqA - seqB;
    return str(a.created_date || a.timestamp || a.createdAt).localeCompare(
      str(b.created_date || b.timestamp || b.createdAt),
    );
  });
}

function messageToTurn(msg: Record<string, unknown>): ChatTurn | null {
  const roleRaw = str(msg.role).toLowerCase();
  const content = str(msg.content).trim();
  if (!content) return null;
  if (roleRaw === "system") return { role: "system", content };
  if (roleRaw === "user" || roleRaw === "human") return { role: "user", content };
  if (roleRaw === "assistant" || roleRaw === "gpt" || roleRaw === "ai" || roleRaw === "model") {
    const name = str(msg.character_name || msg.name) || undefined;
    return { role: "assistant", content, name };
  }
  return null;
}

function indexBySession(messages: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const msg of messages) {
    const sid = str(msg.session_id || msg.sessionId);
    if (!sid) continue;
    const list = map.get(sid) || [];
    list.push(msg);
    map.set(sid, list);
  }
  return map;
}

/**
 * Convert a Settings backup into one TrainingExample per (session × character).
 * Group scenes are split so each companion is trained only on their own voice;
 * other speakers are folded into context (same as transcript `--character`).
 */
export function fromAnimaBackup(
  backup: unknown,
  opts: SourceImportOptions = {},
): TrainingExample[] {
  if (!isAnimaBackup(backup)) return [];
  const entities = asObject((backup as Record<string, unknown>).entities);
  const sessions = asArray(entities.ChatSession);
  const messageRows = asArray(entities.ChatMessage);
  const characters = [...asArray(entities.Character), ...asArray(entities.Anima)];
  const memories = asArray(entities.CharacterMemory);
  const source = opts.source || "import:anima-backup";
  const minTurns = opts.minTurns ?? 2;

  const wanted =
    opts.allCharacters
      ? undefined
      : opts.characterNames?.length
        ? opts.characterNames
        : [...DEFAULT_TRAIN_CHARACTERS];

  const cardsById = new Map<string, CharacterCard>();
  const cardsByName: CharacterCard[] = [];
  for (const row of characters) {
    const card = characterCardFromEntity(row);
    const id = str(row.id);
    if (id) cardsById.set(id, card);
    cardsByName.push(card);
  }

  const messagesBySession = indexBySession(messageRows);
  const examples: TrainingExample[] = [];

  for (const session of sessions) {
    const sessionId = str(session.id);
    if (!sessionId) continue;

    const inline = Array.isArray(session.messages) ? asArray(session.messages) : [];
    const fromRows = messagesBySession.get(sessionId) || [];
    const combined = sortMessages(fromRows.length ? fromRows : inline);
    const conversation = combined.map(messageToTurn).filter((t): t is ChatTurn => t !== null);
    if (conversation.filter((t) => t.role !== "system").length < minTurns) continue;

    const sessionCharacterIds = [
      ...new Set([...asIdList(session.character_ids), ...asIdList(session.character_id)]),
    ];

    const primaryId = sessionCharacterIds[0];
    const primaryCard =
      (primaryId ? cardsById.get(primaryId) : undefined) ||
      cardsByName.find((c) => namesMatch(c.name, str(conversation.find((t) => t.name)?.name))) ||
      { name: conversation.find((t) => t.name)?.name || "Companion" };

    const speakerNames = [
      ...new Set(
        conversation
          .filter((t) => t.role === "assistant" && t.name)
          .map((t) => t.name as string),
      ),
    ];

    const targetNames = wanted
      ? speakerNames.filter((n) => matchesAnyCharacter(n, wanted))
      : speakerNames.length
        ? speakerNames
        : [primaryCard.name];

    // Solo session whose assistant turns have no character_name: keep if the
    // session's primary character is in the wanted set (or no filter).
    if (!speakerNames.length) {
      if (wanted && !matchesAnyCharacter(primaryCard.name, wanted)) continue;
      targetNames.length = 0;
      targetNames.push(primaryCard.name);
    }

    if (!targetNames.length) continue;

    const base: TrainingExample = {
      id: `session-${sessionId}`,
      source,
      character: primaryCard,
      scenario: {
        id: sessionId,
        label: str(session.title) || undefined,
        mode: str(session.mode) || undefined,
        notes: session.is_crossover ? "crossover" : undefined,
      },
      memory: memoryLinesForCharacter(memories, primaryId),
      conversation,
      tags: [
        str(session.mode) || "solo",
        session.is_crossover ? "crossover" : "solo",
        ...(opts.tags || []),
      ].filter(Boolean),
      instruction:
        "Respond as the companion with multi-turn consistency, emotional continuity, and memory-aware depth.",
    };

    const split = splitExampleByCharacters(base, targetNames);
    for (const example of split) {
      const card =
        cardsByName.find((c) => namesMatch(c.name, example.character.name)) || example.character;
      const matchedId = [...cardsById.entries()].find(([, c]) => namesMatch(c.name, card.name))?.[0];
      const mem = memoryLinesForCharacter(memories, matchedId);
      examples.push({
        ...example,
        character: { ...card, name: example.character.name },
        memory: mem.length ? mem : example.memory,
      });
    }
  }

  // Orphan ChatMessage rows (no ChatSession) — rare, but Settings exports can
  // theoretically dump messages without the parent if a session row was deleted.
  if (!sessions.length && messageRows.length) {
    const bySession = indexBySession(messageRows);
    for (const [sessionId, rows] of bySession) {
      const conversation = sortMessages(rows)
        .map(messageToTurn)
        .filter((t): t is ChatTurn => t !== null);
      if (conversation.filter((t) => t.role !== "system").length < minTurns) continue;
      const speaker =
        conversation.find((t) => t.role === "assistant" && t.name)?.name ||
        opts.defaultCharacterName ||
        "Companion";
      if (wanted && !matchesAnyCharacter(speaker, wanted)) continue;
      const base: TrainingExample = {
        id: `session-${sessionId}`,
        source,
        character: { name: speaker },
        conversation,
        tags: opts.tags,
      };
      examples.push(...splitExampleByCharacters(base, wanted || [speaker]));
    }
  }

  return examples;
}

export function fromChatMl(
  data: { messages: Array<{ role: string; content: string; name?: string }>; system?: string },
  id: string,
  source: string,
  defaultCharacterName: string | undefined,
): TrainingExample {
  const conversation: ChatTurn[] = [];
  if (data.system?.trim()) conversation.push({ role: "system", content: data.system.trim() });
  for (const turn of data.messages) {
    const roleRaw = turn.role.toLowerCase();
    const role =
      roleRaw === "system"
        ? "system"
        : roleRaw === "user" || roleRaw === "human"
          ? "user"
          : "assistant";
    conversation.push({
      role,
      content: turn.content,
      name: role === "assistant" ? turn.name || defaultCharacterName : undefined,
    });
  }
  const systemFromTurns = data.messages.find((m) => m.role.toLowerCase() === "system")?.content;
  const characterName =
    defaultCharacterName ||
    conversation.find((t) => t.role === "assistant" && t.name)?.name ||
    characterNameFromSystem(data.system || systemFromTurns) ||
    "Companion";
  return { id, source, character: { name: characterName }, conversation };
}

/** Stable filename slug for a staged raw JSONL (`imported-serenity.jsonl`). */
export function characterSlug(name: string): string {
  const key = normalizeCharacterKey(name);
  if (key === "fallenangel") return "fallen-angel";
  if (key === "serenity") return "serenity";
  return key || "companion";
}
