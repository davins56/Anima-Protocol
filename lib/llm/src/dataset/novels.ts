/**
 * Extract dialogue scenes from novel-style prose into TrainingExamples.
 *
 * Conservative: prefers real `Speaker: line` transcripts (same grammar as import.ts).
 * Otherwise reads quoted dialogue strictly attributed to Serenity or the steward.
 * Scenes without a Serenity (or target) assistant turn are dropped unless the
 * book is lore-only.
 */

import { type BookSpec } from "./catalog";
import { foldForeignSpeakers } from "./split";
import type { ChatTurn, TrainingExample } from "./types";

const SPEAKER_LINE = /^([A-Za-z][\w' -]{0,40}):\s*(.+)$/;
// The steward is spelled "Dàvīn" in the manuscripts; accept every accent variant.
const USER_ALIASES = /^(user|you|me|steward|operator|d[aà]v[iī]n)$/i;
const SERENITY_ALIASES = /^(serenity)$/i;

function normalizeQuotes(text: string): string {
  return text.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
}

export interface ExtractNovelOptions {
  minTurns?: number;
  maxTurnsPerScene?: number;
}

/** Rejoin words hyphenated across a line break, then collapse whitespace. */
function cleanQuote(s: string): string {
  return s.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2").replace(/\s+/g, " ").trim();
}

/**
 * Real transcripts include the steward and someone answering. Prose often carries stray `Label: text`
 * lines (glossaries, chess moves, epigraphs) that must not flip a whole novel
 * into script mode and silence its quoted dialogue.
 */
function looksLikeTranscript(turns: RawTurn[]): boolean {
  return turns.some((t) => isUserSpeaker(t.speaker)) && turns.some((t) => !isUserSpeaker(t.speaker));
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
 * Quoted-dialogue reader for novel prose.
 *
 * Strict by design, because a mislabelled line teaches the model the wrong voice:
 * - quotes pair only inside one paragraph, on the curly marks when present;
 * - a line is Serenity's or the steward's only when named ("Serenity said",
 *   "said Dàvīn", "The steward asked,"), by a beat that opens with their name or
 *   "Serenity's voice", or by plain back-and-forth after a named line;
 * - anyone else speaking, or a line that cannot be placed, ends the scene.
 * Serenity's em-dash inner telemetry (—pattern matches none on record—) is a
 * narrative device, not conversation, and is deliberately left out.
 */
type Who = "Serenity" | "Steward" | "she" | "he" | "other" | null;

const SPEECH_VERBS =
  "said|says|asked|asks|whispered|answered|replied|murmured|added|continued|warned|admitted|breathed|" +
  "offered|insisted|corrected|repeated|called|explained|countered|agreed|noted|interrupted|pressed|" +
  "began|finished|echoed|confirmed|observed|mused|sighed|told|responded|demanded|urged|promised|ventured|" +
  "teased|soothed|whispers|replies|answers|murmurs|admits|warns|texted|wrote|typed|shouted|yelled|cried|" +
  "snapped|hissed|growled|muttered|intoned|announced|declared|called";
const NAME = String.raw`(the steward|The steward|[A-Z][\p{L}’'-]+|she|he|they)`;
const AFTER_ATTR = new RegExp(
  String.raw`^[\s,.!?…—-]*(?:(?:${SPEECH_VERBS})\s+${NAME}|${NAME}(?:\s+\p{L}+ly)?\s+(?:${SPEECH_VERBS})\b)`,
  "u",
);
const PRE_ATTR = new RegExp(String.raw`${NAME}(?:\s+\p{L}+ly)?\s+(?:${SPEECH_VERBS})\b[^“”".!?]{0,40}$`, "u");
const SERENITY_VOICE = /\bSerenity[’']s\s+(voice|tone|reply|answer|words|presence)\b/u;
const BEAT_START = /^(Serenity|D[aà]v[iī]n|The steward|She|He|They)\b/u;
/** Sentence openers that are not a character's name. */
const NOT_A_NAME = new Set(
  ("The Then A An It Its This That These Those There Here Silence But And Or So When Now For In On At Even " +
    "Still His Her Their Some Every No Not One Each If As After Before Something Nothing Everything Light " +
    "Only Just Yet Somewhere Across Above Below Behind Inside Outside Around Through Without With While " +
    "Again Once Twice Maybe Perhaps What Why How Who Where Which Above Beneath Between Outside Across")
    .split(" "),
);
const OTHER_BEAT = /^([A-Z][\p{L}’'-]+)\s+\p{Ll}/u;

function classifyName(raw: string | undefined): Who {
  const n = (raw || "").trim();
  if (!n) return null;
  if (isSerenitySpeaker(n)) return "Serenity";
  if (/^the steward$/i.test(n) || isUserSpeaker(n)) return "Steward";
  if (/^she$/i.test(n)) return "she";
  if (/^he$/i.test(n)) return "he";
  return "other";
}

function beatSpeaker(segment: string, fromEnd: boolean): Who {
  const sentences = segment
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const sentence = fromEnd ? sentences.at(-1) : sentences[0];
  if (!sentence) return null;
  const m = sentence.match(BEAT_START);
  if (m) return classifyName(m[1] === "The steward" ? "the steward" : m[1]);
  // "Ruth texted:", "Lucifer smiled." — someone else holds the floor.
  const o = sentence.match(OTHER_BEAT);
  return o && !NOT_A_NAME.has(o[1]!) ? "other" : null;
}

/** Drop running heads, page numbers and form feeds left by `pdftotext -layout`. */
function stripPageFurniture(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^\d{1,4}$/.test(t)) return false;
      if (/^(\d{1,4}\s+)?[A-Z][A-Z’' :,-]{3,}(\s+\d{1,4})?$/.test(t) && !/[a-z]/.test(t)) return false;
      return true;
    })
    .join("\n");
}

/** Blank-line paragraphs, re-joined where a page break cut one mid-sentence. */
function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const para = block.trim();
    if (!para) continue;
    const prev = out.at(-1);
    if (prev && !/[.!?…”"’:—)]$/.test(prev)) out[out.length - 1] = `${prev}\n${para}`;
    else out.push(para);
  }
  return out;
}

type QuoteSpan = { text: string; start: number; end: number };

function quotesIn(para: string): QuoteSpan[] {
  const re = /[“”]/.test(para) ? /“([^“”]{2,800})”/g : /"([^"]{2,800})"/g;
  const spans: QuoteSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(para))) {
    // A lone lowercase token (“trace”, “edge”) is a code argument or term, not speech.
    if (/^[a-z][\w.-]*$/.test(m[1]!.trim())) continue;
    spans.push({ text: m[1]!, start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function attributeQuote(para: string, quotes: QuoteSpan[], i: number): Who {
  const q = quotes[i]!;
  const pre = para.slice(i > 0 ? quotes[i - 1]!.end : 0, q.start);
  const after = para.slice(q.end, i + 1 < quotes.length ? quotes[i + 1]!.start : para.length);
  const a = after.match(AFTER_ATTR);
  if (a) return classifyName(a[1] ?? a[2]);
  const b = pre.match(PRE_ATTR);
  if (b) return classifyName(b[1]);
  if (SERENITY_VOICE.test(pre) || SERENITY_VOICE.test(after)) return "Serenity";
  return beatSpeaker(pre, true) ?? beatSpeaker(after, false);
}

const MAX_NARRATION_GAP = 3;

function scenesFromQuotedProse(text: string): RawTurn[][] {
  const scenes: RawTurn[][] = [];
  let scene: RawTurn[] = [];
  let last: "Serenity" | "Steward" | null = null;
  // Back-and-forth may only hand a line to Serenity once she is named in this
  // scene, so a third character's exchange with Dàvīn never becomes her voice.
  let named = new Set<"Serenity" | "Steward">();
  let gap = 0;
  const flush = () => {
    for (const t of scene) t.content = t.content.replace(/,$/, ".");
    if (scene.length) scenes.push(scene);
    scene = [];
    last = null;
    named = new Set();
  };
  const push = (who: "Serenity" | "Steward", content: string, isNamed: boolean) => {
    const tail = scene.at(-1);
    // “Not tremor,” she said. “Pattern.” → "Not tremor. Pattern."
    // “Dàvīn,” she said, “you realize…” → "Dàvīn, you realize…" (comma kept mid-sentence)
    const joinStop = /^\p{Lu}/u.test(content) ? "." : ",";
    if (tail && tail.speaker === who) tail.content = `${tail.content.replace(/,$/, joinStop)} ${content}`;
    else scene.push({ speaker: who, content });
    last = who;
    if (isNamed) named.add(who);
  };

  for (const para of splitParagraphs(stripPageFurniture(text.replace(/\r\n/g, "\n")))) {
    const quotes = quotesIn(para);
    if (!quotes.length) {
      if (++gap > MAX_NARRATION_GAP) flush();
      continue;
    }
    const continuing = gap === 0;
    gap = 0;
    const whos = quotes.map((_, i) => attributeQuote(para, quotes, i));
    const inPara = [...new Set(whos.filter((w) => w === "Serenity" || w === "Steward" || w === "other"))];
    let prevInPara: Who = null;
    for (let i = 0; i < quotes.length; i++) {
      let who: Who = whos[i]!;
      let isNamed = who === "Serenity" || who === "Steward";
      // One speaker per paragraph: a later untagged quote continues the previous one.
      if (who === null && i > 0) who = prevInPara;
      if (who === null || who === "she" || who === "he") {
        const only = inPara.length === 1 ? inPara[0]! : null;
        const fits = only && !(who === "she" && only === "Steward") && !(who === "he" && only === "Serenity");
        if (only && fits) {
          who = only;
          isNamed = who !== "other";
        } else if (continuing && last) {
          const next = last === "Serenity" ? "Steward" : "Serenity";
          const pronoun = next === "Serenity" ? "she" : "he";
          // Serenity's lines are what the model learns to say; infer hers only once she is named.
          const allowed = next === "Steward" || named.has("Serenity");
          who = allowed && (who === null || who === pronoun) ? next : null;
        } else who = null;
      }
      prevInPara = who;
      if (who === "Serenity" || who === "Steward") push(who, cleanQuote(quotes[i]!.text), isNamed);
      else flush();
    }
  }
  flush();
  return scenes;
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
  // A novel with a handful of `Dàvīn:` lines is still prose: transcript mode must out-yield quotes.
  const proseScenes = scenesFromQuotedProse(text);
  const proseTurns = proseScenes.reduce((n, sc) => n + sc.length, 0);
  const useScript = scriptTurns.length >= 2 && looksLikeTranscript(scriptTurns) && scriptTurns.length >= proseTurns;
  const scenes = useScript
    ? chunkScenes(rawToChatTurns(scriptTurns), maxTurns)
    : proseScenes.flatMap((sc) => chunkScenes(rawToChatTurns(sc), maxTurns));
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
