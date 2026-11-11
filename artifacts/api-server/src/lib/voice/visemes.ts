/**
 * Word timings (+ IPA from Kokoro's misaki G2P, when available) → VRM viseme
 * cues on the stream timeline. Pure; see docs/voice-local.md §Visemes.
 *
 * Kokoro-FastAPI documents word-level timestamps, not phoneme-level ones, so
 * each word's phonemes are spread across the word (vowels count double).
 * That is an approximation of where each mouth shape falls, not an alignment.
 */
import type { Viseme, VisemeCue, WordTiming } from "./localContract";

type Unit = { viseme: Viseme; weight: number; span: number };

const VOWEL_SPAN = 2;
const CONSONANT_SPAN = 1;

/** misaki writes diphthongs as single capitals (e.g. "kˈOkəɹO" for Kokoro). */
const IPA: Record<string, { viseme: Viseme; weight: number; vowel: boolean }> = {
  // aa
  a: { viseme: "aa", weight: 1, vowel: true },
  "ɑ": { viseme: "aa", weight: 1, vowel: true },
  "æ": { viseme: "aa", weight: 0.9, vowel: true },
  "ʌ": { viseme: "aa", weight: 0.8, vowel: true },
  "ɐ": { viseme: "aa", weight: 0.7, vowel: true },
  "ə": { viseme: "aa", weight: 0.5, vowel: true },
  "ᵊ": { viseme: "aa", weight: 0.4, vowel: true },
  I: { viseme: "aa", weight: 1, vowel: true }, // aɪ
  W: { viseme: "aa", weight: 1, vowel: true }, // aʊ
  // ih
  i: { viseme: "ih", weight: 0.9, vowel: true },
  "ɪ": { viseme: "ih", weight: 0.8, vowel: true },
  "ɨ": { viseme: "ih", weight: 0.7, vowel: true },
  // ee
  e: { viseme: "ee", weight: 0.9, vowel: true },
  "ɛ": { viseme: "ee", weight: 0.9, vowel: true },
  "ɜ": { viseme: "ee", weight: 0.7, vowel: true },
  "ɚ": { viseme: "ee", weight: 0.6, vowel: true },
  A: { viseme: "ee", weight: 1, vowel: true }, // eɪ
  // ou
  u: { viseme: "ou", weight: 1, vowel: true },
  "ʊ": { viseme: "ou", weight: 0.8, vowel: true },
  "ɯ": { viseme: "ou", weight: 0.7, vowel: true },
  // oh
  o: { viseme: "oh", weight: 1, vowel: true },
  "ɔ": { viseme: "oh", weight: 1, vowel: true },
  "ɒ": { viseme: "oh", weight: 0.9, vowel: true },
  O: { viseme: "oh", weight: 1, vowel: true }, // oʊ
  Q: { viseme: "oh", weight: 1, vowel: true }, // əʊ
  Y: { viseme: "oh", weight: 1, vowel: true }, // ɔɪ
  // consonants with a distinct lip shape
  p: { viseme: "sil", weight: 0, vowel: false },
  b: { viseme: "sil", weight: 0, vowel: false },
  m: { viseme: "sil", weight: 0, vowel: false },
  f: { viseme: "ih", weight: 0.25, vowel: false },
  v: { viseme: "ih", weight: 0.25, vowel: false },
  w: { viseme: "ou", weight: 0.6, vowel: false },
  "ɹ": { viseme: "ou", weight: 0.4, vowel: false },
  r: { viseme: "ou", weight: 0.4, vowel: false },
  j: { viseme: "ih", weight: 0.4, vowel: false },
};
/** Every other letter-like consonant: slightly open, teeth showing. */
const OTHER_CONSONANT = { viseme: "ih" as Viseme, weight: 0.3, vowel: false };
const IGNORED = /[\sˈˌːˑ.,!?;:'"“”‘’()\-–—…]/u;

const GRAPHEME: Record<string, { viseme: Viseme; weight: number; vowel: boolean }> = {
  a: IPA.a,
  e: IPA.e,
  i: IPA.i,
  y: { viseme: "ih", weight: 0.7, vowel: true },
  o: IPA.o,
  u: IPA.u,
  w: IPA.w,
  b: IPA.b,
  m: IPA.m,
  p: IPA.p,
  f: IPA.f,
  v: IPA.v,
  r: IPA.r,
};

function toUnits(chars: string[], table: typeof IPA, letterOnly: boolean): Unit[] {
  const out: Unit[] = [];
  for (const ch of chars) {
    if (IGNORED.test(ch)) continue;
    const hit = table[ch];
    if (hit) {
      out.push({ viseme: hit.viseme, weight: hit.weight, span: hit.vowel ? VOWEL_SPAN : CONSONANT_SPAN });
      continue;
    }
    if (letterOnly ? /\p{L}/u.test(ch) : /[\p{L}\u0250-\u02AF]/u.test(ch)) {
      out.push({ viseme: OTHER_CONSONANT.viseme, weight: OTHER_CONSONANT.weight, span: CONSONANT_SPAN });
    }
  }
  return out;
}

/** IPA (misaki/espeak) → units. */
export function ipaUnits(ipa: string): Unit[] {
  return toUnits([...String(ipa || "")], IPA, false);
}

/** Spelling fallback when no IPA is available for a word. */
export function graphemeUnits(word: string): Unit[] {
  return toUnits([...String(word || "").toLowerCase()], GRAPHEME, true);
}

/** Word gaps longer than this get an explicit `sil` cue (agreed with 3D Visual). */
export const GAP_SIL_MS = 80;

/**
 * Cues for a run of words. `ipaPerWord[i]` (optional) is word i's IPA.
 * Output is sorted, non-overlapping, integer ms, and every cue has
 * startMs < endMs. Adjacent cues with the same viseme are merged.
 */
export function wordsToVisemeCues(
  words: readonly WordTiming[],
  ipaPerWord?: readonly (string | null | undefined)[] | null,
  floorMs = 0,
): VisemeCue[] {
  const cues: VisemeCue[] = [];
  let cursor = Math.max(0, Math.round(floorMs));
  const push = (viseme: Viseme, start: number, end: number, weight: number) => {
    const s = Math.max(cursor, Math.round(start));
    const e = Math.round(end);
    if (e <= s) return;
    const prev = cues[cues.length - 1];
    if (prev && prev.viseme === viseme && prev.endMs === s) {
      prev.endMs = e;
      if (viseme !== "sil") {
        const w = round2(Math.max(prev.weight ?? 1, weight));
        if (w === 1) delete prev.weight;
        else prev.weight = w;
      }
    } else {
      const cue: VisemeCue = { viseme, startMs: s, endMs: e };
      // weight is optional and defaults to 1; omit it for sil and full-weight cues.
      if (viseme !== "sil" && round2(weight) !== 1) cue.weight = round2(weight);
      cues.push(cue);
    }
    cursor = e;
  };
  words.forEach((w, i) => {
    const start = Number(w.startMs);
    const end = Number(w.endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (start - cursor >= GAP_SIL_MS) push("sil", cursor, start, 0);
    const ipa = ipaPerWord?.[i];
    let units = ipa ? ipaUnits(ipa) : [];
    if (!units.length) units = graphemeUnits(w.word);
    if (!units.length) return;
    const total = units.reduce((n, u) => n + u.span, 0);
    let t = Math.max(start, cursor);
    const dur = end - t;
    if (dur <= 0) return;
    units.forEach((u, k) => {
      const next = k === units.length - 1 ? end : t + (dur * u.span) / total;
      push(u.viseme, t, next, u.weight);
      t = next;
    });
  });
  return cues;
}

/**
 * Close the mouth from the last cue to the end of the audio window (chunk or
 * sentence end). Returns null when there is nothing to close.
 */
export function tailSilence(lastEndMs: number, windowEndMs: number): VisemeCue | null {
  const s = Math.round(lastEndMs);
  const e = Math.round(windowEndMs);
  return e > s ? { viseme: "sil", startMs: s, endMs: e } : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Words the listener actually heard: a word counts once its midpoint has
 * played. Used for the stop response's `heardText`.
 */
export function heardTextFor(words: readonly WordTiming[], heardMs: number): string {
  const ms = Number(heardMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return words
    .filter((w) => w.startMs + (w.endMs - w.startMs) / 2 <= ms)
    .map((w) => w.word)
    .join(" ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .trim();
}

/** Align an IPA string (space-separated words) to timed words. Null when counts differ. */
export function alignIpaToWords(ipa: string, words: readonly WordTiming[]): string[] | null {
  const ipaWords = String(ipa || "")
    .split(/\s+/)
    .map((s) => s.replace(/^[^\p{L}\u0250-\u02AFˈˌ]+|[^\p{L}\u0250-\u02AFː]+$/gu, ""))
    .filter(Boolean);
  const spoken = words.filter((w) => /[\p{L}\p{N}]/u.test(w.word));
  if (!ipaWords.length || ipaWords.length !== spoken.length) return null;
  let k = 0;
  return words.map((w) => (/[\p{L}\p{N}]/u.test(w.word) ? ipaWords[k++] : ""));
}
