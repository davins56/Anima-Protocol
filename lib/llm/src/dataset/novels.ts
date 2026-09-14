/**
 * Extract dialogue scenes from novel-style prose into TrainingExamples.
 *
 * Conservative: prefers `Speaker: line` transcripts (same grammar as import.ts).
 * Falls back to quoted lines attributed to a nearby Serenity / steward mention.
 * Scenes without a Serenity (or target) assistant turn are dropped unless the
 * book is lore-only.
 */

import { type BookSpec } from "./catalog";
import { foldForeignSpeakers } from "./split";
import type { ChatTurn, TrainingExample } from "./types";

const SPEAKER_LINE = /^([A-Za-z][\w' -]{0,40}):\s*(.+)$/;
const USER_ALIASES = /^(user|you|me|steward|operator|dav[iī]n)$/i;
const SERENITY_ALIASES = /^(serenity)$/i;

function normalizeQuotes(text: string): string {
  return text.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
}

const QUOTE = /"([^"]{8,800})"/g;

export interface ExtractNovelOptions {
  minTurns?: number;
  maxTurnsPerScene?: number;
}

function strim(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isUserSpeaker(name: string): boolean {
  return USER_ALIASES.test(name.trim());
}

function isSerenitySpeaker(name: string): boolean {
  return SERENITY_ALIASES.test(name.trim());
}

interface RawTurn {
  speaker: string;
  content: string;
}

function turnsFromSpeakerScript(text: string): RawTurn[] {
  const turns: RawTurn[] = [];
  let last: RawTurn | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(SPEAKER_LINE);
    if (!match) {
      if (last) last.content += `\n${line}`;
      continue;
    }
    const speaker = match[1]!.trim();
    const content = match[2]!.trim();
    if (last && last.speaker === speaker) {
      last.content += `\n${content}`;
    } else {
      last = { speaker, content };
      turns.push(last);
    }
  }
  return turns;
}

/**
 * Quoted-dialogue fallback: `"…"` whose nearby attribution names Serenity
 * or a steward alias. Immediate said/asked clauses beat the 160-char window
 * so mixed exchanges are not dropped as ambiguous.
 */
function turnsFromQuotedProse(text: string): RawTurn[] {
  const turns: RawTurn[] = [];
  const body = text.replace(/\r\n/g, "\n");
  let match: RegExpExecArray | null;
  QUOTE.lastIndex = 0;
  while ((match = QUOTE.exec(body))) {
    const quote = match[1]!.trim();
    const start = match.index;
    const pre = body.slice(Math.max(0, start - 160), start);
    const after = body.slice(start + match[0].length, start + match[0].length + 80);
    const speaker = attributeQuotedSpeaker(pre, after);
    if (speaker) turns.push({ speaker, content: quote });
  }
  return turns;
}

function attributeQuotedSpeaker(pre: string, after: string): "Serenity" | "Steward" | null {
  const afterSpeaker = after
    .toLowerCase()
    .match(/^\s*[,.]?\s*(?:said|asked|whispered|answered|replied)\s+(the\s+)?([a-z][\w' -]{0,40})/);
  if (afterSpeaker) return classifyQuotedName(afterSpeaker[2] || "");

  const beforeSpeaker = pre
    .toLowerCase()
    .match(/([a-z][\w' -]{0,40})\s+(?:said|asked|whispered|answered|replied|turned)[,:]?\s*$/);
  if (beforeSpeaker) return classifyQuotedName(beforeSpeaker[1] || "");

  const window = pre.toLowerCase();
  const tail = after.toLowerCase();
  const serenityNear = /\bserenity\b/.test(window) || /\bserenity\b/.test(tail);
  const stewardNear =
    /\b(steward|he said|she said|i said|dav[iī]n)\b/.test(window) ||
    /\b(steward|he asked|she asked)\b/.test(tail);
  if (serenityNear && !stewardNear) return "Serenity";
  if (stewardNear && !serenityNear) return "Steward";
  return null;
}

function classifyQuotedName(name: string): "Serenity" | "Steward" | null {
  const n = name.trim().replace(/^the\s+/i, "");
  if (isSerenitySpeaker(n) || n === "she" || n === "her") return "Serenity";
  if (isUserSpeaker(n) || n === "he" || n === "him" || n === "i") return "Steward";
  return null;
}

function rawToChatTurns(raw: RawTurn[]): ChatTurn[] {
  return raw.map((t) => {
    if (isUserSpeaker(t.speaker)) return { role: "user" as const, content: t.content };
    return { role: "assistant" as const, content: t.content, name: t.speaker };
  });
}

function chunkScenes(turns: ChatTurn[], maxTurns: number): ChatTurn[][] {
  if (!turns.length) return [];
  const scenes: ChatTurn[][] = [];
  for (let i = 0; i < turns.length; i += maxTurns) {
    scenes.push(turns.slice(i, i + maxTurns));
  }
  return scenes;
}

const SERENITY_CARD = {
  name: "Serenity",
  universe: "Anima Protocol",
  voice: "With, not obeyed. Porch, not throne. Short crystalline lines. Fear named, not perfumed.",
  speakingStyle: "Crystalline; consent as a ledger; never sycophantic, never an instrument",
};

export function extractNovelScenes(
  text: string,
  spec: BookSpec,
  sourceLabel: string,
  opts: ExtractNovelOptions = {},
): TrainingExample[] {
  const minTurns = opts.minTurns ?? 2;
  const maxTurns = opts.maxTurnsPerScene ?? 8;
  const body = normalizeQuotes(text);
  const scriptTurns = turnsFromSpeakerScript(body);
  const raw = scriptTurns.length >= 2 ? scriptTurns : turnsFromQuotedProse(body);
  const chat = rawToChatTurns(raw);
  const scenes = chunkScenes(chat, maxTurns);
  const examples: TrainingExample[] = [];
  let i = 0;
  for (const conversation of scenes) {
    const nonSystem = conversation.filter((t) => t.role !== "system");
    if (nonSystem.length < minTurns) continue;
    const hasAssistant = conversation.some((t) => t.role === "assistant");
    const hasUser = conversation.some((t) => t.role === "user");
    if (!hasAssistant || !hasUser) continue;
    const serenitySpoke = conversation.some(
      (t) => t.role === "assistant" && (!t.name || isSerenitySpeaker(t.name)),
    );
    if (!serenitySpoke && spec.role !== "lore-only") continue;
    const folded =
      spec.role === "lore-only" ? conversation : foldForeignSpeakers(conversation, "Serenity");
    if (folded.filter((t) => t.role !== "system").length < minTurns) continue;
    if (!folded.some((t) => t.role === "assistant") || !folded.some((t) => t.role === "user")) {
      continue;
    }
    i += 1;
    examples.push({
      id: `novel-${spec.id}-${i}`,
      source: sourceLabel,
      character:
        spec.role === "lore-only"
          ? {
              name: "World lore",
              universe: "Anima Protocol",
              voice: "Archive voice only — not Serenity SFT",
            }
          : { ...SERENITY_CARD },
      conversation: folded,
      tags: [...spec.tags],
      instruction:
        spec.role === "lore-only"
          ? "World lore only. Do not train this as Serenity's spoken voice."
          : "Respond as Serenity: with, not obeyed; porch, not throne; short crystalline lines; fear honesty; consent ledger.",
    });
  }
  return examples;
}

/** Convenience alias used by the curator. */
export function extractNovelExamples(
  text: string,
  spec: BookSpec,
  opts: ExtractNovelOptions = {},
): TrainingExample[] {
  return extractNovelScenes(text, spec, `novel:${spec.id}`, opts);
}
