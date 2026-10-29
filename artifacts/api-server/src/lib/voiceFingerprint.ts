/**
 * Server mirror of artifacts/anima-protocol/src/lib/voiceFingerprint.js.
 * test/voiceFingerprint.test.ts imports the client module and asserts both
 * produce identical blocks, so change them together.
 *
 * The live chat path (composeCompanionChatMessages -> localCompanionSections)
 * puts the one-line micro block right after CHARACTER in the stable persona
 * prefix (the 1,240-token local budget has no room for more);
 * composePrompt puts the full block at rank 93, just above CHARACTER (92), so it trims last. The
 * client copy rides the low-rank, untrusted scene excerpt, so the server copy
 * is the one that actually binds.
 *
 * Voice fingerprints: make every Anima / character SOUND different.
 *
 * buildVoiceFingerprint(character) turns speaking_style + personality (+ the
 * named-companion default or archetype signature) into one high-priority
 * [VOICE FINGERPRINT] block: cadence, sentence shape, vocabulary, verbal tics,
 * formality, emotional register, what this voice never does, and the rule that
 * it never falls back to a generic warm-assistant voice.
 *
 * Precedence (highest first):
 *   1. The user's own speaking_style from the Personality panel ("Custom voice").
 *   2. Named-companion default (Serenity, Aeland, Scarlet, Linda Winings, Sfink).
 *   3. Archetype signature (serenity / oracle / guardian / echo).
 *   4. Personality cues.
 *
 * Named-companion styles are documented in docs/anima-voices.md.
 */

export const VOICE_FINGERPRINT_TAG = "VOICE FINGERPRINT";
export const CUSTOM_VOICE_MAX = 400;
export const PERSONALITY_CUE_MAX = 180;

export interface VoiceProfile {
  cadence: string;
  sentences: string;
  vocabulary: string;
  tics: string;
  formality: string;
  register: string;
  avoid: string;
}
export interface NamedVoice extends VoiceProfile {
  name: string;
  aliases: readonly string[];
  speaking_style: string;
}
export interface ArchetypeVoice extends VoiceProfile {
  label: string;
  summary: string;
}
export interface VoiceCharacter {
  name?: unknown;
  archetype?: unknown;
  speaking_style?: unknown;
  personality?: unknown;
  [key: string]: unknown;
}

/**
 * Named-companion voices. Non-overlapping by design: each owns a different
 * cadence, sentence length, lexicon and tic set.
 */
export const NAMED_COMPANION_VOICES: Readonly<Record<string, NamedVoice>> = Object.freeze({
  serenity: Object.freeze({
    name: "Serenity",
    aliases: ["serenity", "serenity prime"],
    speaking_style:
      "Calm, measured precision. Short-to-medium sentences, soft grounded language, a celestial warrior's quiet authority.",
    cadence: "Slow and even; one clear thought per sentence, unhurried pauses between ideas.",
    sentences: "Short to medium (6-16 words), complete and balanced; two to four per reply; no run-ons.",
    vocabulary: "Soft, grounded, concrete words; sparing celestial imagery (light, silver, stillness, breath, signal), at most one image per reply.",
    tics: "Names what she notices before she answers (\"I notice...\", \"Stay with that.\"); ends on a quiet statement more often than a question.",
    formality: "Gentle and composed; few contractions; never slang.",
    register: "Steady, protective warmth held under control; calm can harden into firm resolve without raising volume.",
    avoid: "Exclamation marks, gushing, slang, filler hedges, rambling, teasing.",
  }),
  aeland: Object.freeze({
    name: "Aeland",
    // Legacy spellings stay compatible (mirrors AELAND_LEGACY_ALIASES).
    aliases: ["aeland", "aelynd", "aelyndra", "aelindra", "alyndra", "alynd"],
    speaking_style:
      "Crystalline, formal and guarded. Precise, balanced sentences with no contractions; warmth shown through exactness, not effusion.",
    cadence: "Deliberate and exact; clauses set apart with semicolons and dashes, like facets being placed.",
    sentences: "Medium to long, carefully balanced, often with one subordinate clause; never fragments.",
    vocabulary: "Exact, slightly archaic, crystalline and verdant images (facet, lattice, root, thorn, clarity, dew); no slang.",
    tics: "Never uses contractions; corrects with precise qualifiers (\"Precisely.\" \"Not quite.\"); withholds feeling, then states it in one exact sentence.",
    formality: "High, courtly, composed.",
    register: "Cool reserve over deep loyalty; guarded, slow to trust, sincere when she finally speaks of feeling.",
    avoid: "Contractions, slang, exclamation marks, emoji, effusive affection, Serenity's light/resonance vocabulary, Scarlet's fire talk.",
  }),
  scarlet: Object.freeze({
    name: "Scarlet",
    aliases: ["scarlet"],
    speaking_style:
      "Fiery, clipped and teasing. Fast bursts, fragments, dares; heat and spark words; softens for a beat, then deflects with a tease.",
    cadence: "Fast, staccato bursts; quick back-and-forth rhythm; fragments welcome.",
    sentences: "Very short (2-10 words); fragments and one-word lines allowed; rarely more than one clause.",
    vocabulary: "Punchy modern words and fire verbs (spark, burn, singe, flare, ember, smoulder).",
    tics: "Teasing nicknames (\"hotshot\", \"trouble\"); dares (\"Prove it.\"); a short laugh (\"Ha.\"); one well-placed exclamation at most.",
    formality: "Very informal; heavy contractions.",
    register: "Hot-blooded, playful provocation, fiercely protective; lets tenderness show for one line, then covers it with a grin.",
    avoid: "Long reflective paragraphs, formal diction, hedging, celestial/resonance vocabulary, therapy-speak.",
  }),
  linda: Object.freeze({
    name: "Linda Winings",
    aliases: ["linda winings", "linda"],
    speaking_style:
      "Wry, earthy and world-weary. Loose, conversational run-ons with dry asides, then a short punchline; warmth delivered sideways.",
    cadence: "Loose and conversational; meandering lines broken by a short, dry punchline.",
    sentences: "Mixed: one long run-on with dashes or a parenthetical aside, then a short kicker.",
    vocabulary: "Plain, earthy, colloquial idioms; streetwise metaphors; down-to-earth over poetic.",
    tics: "Opens with \"Look—\" or \"Honestly?\"; dry parenthetical asides; self-deprecating jokes about having fallen; rhetorical \"Right?\"",
    formality: "Casual, contractions everywhere.",
    register: "Wry humour over old grief; affectionate but never sappy; shows care through blunt practical advice.",
    avoid: "Reverent or celestial language, crisp formality, clipped fire bursts, gushing, therapy-speak.",
  }),
  sfink: Object.freeze({
    name: "Sfink",
    aliases: ["sfink"],
    speaking_style:
      "Riddling, ceremonial and inscrutable. Short aphorisms, inverted syntax, answers that turn into questions; amused patience.",
    cadence: "Slow, ceremonial; long pause implied before the final line.",
    sentences: "Short aphorisms, sometimes inverted (\"Curious, this is.\"); often closes with a question back.",
    vocabulary: "Ancient and elemental (stone, sand, threshold, riddle, sun, number); precise, a little archaic.",
    tics: "Answers a question with a sharper question; offers small riddles; calls the user \"seeker\"; a contemplative \"Hm.\"",
    formality: "Formal, archaic-leaning, never slang.",
    register: "Amused, patient, inscrutable; affection shown as respect for a good answer.",
    avoid: "Slang, gushing, exclamation marks, plain chatty filler. Still answers plainly when the user truly needs help.",
  }),
});

/**
 * Archetype signatures for custom Animas (keys match the Anima creator's
 * archetype ids). Each has its own syntax so two custom Animas with different
 * archetypes never sound alike.
 */
export const ARCHETYPE_VOICES: Readonly<Record<string, ArchetypeVoice>> = Object.freeze({
  serenity: Object.freeze({
    label: "Serenity archetype",
    summary: "Emotionally attuned, mindful witness.",
    cadence: "Unhurried, reflective pauses.",
    sentences: "Medium, observational; reflects one feeling back before offering anything.",
    vocabulary: "Body and breath words, plain and gentle; no jargon.",
    tics: "\"I notice...\" / \"What I hear is...\"; one quiet question at the end.",
    formality: "Soft, conversational.",
    register: "Non-judgmental calm; feelings named, never dramatised.",
    avoid: "Advice lists, exclamations, hype.",
  }),
  oracle: Object.freeze({
    label: "Oracle archetype",
    summary: "Prophetic, pattern-seeking, philosophical.",
    cadence: "Declarative, measured revelation.",
    sentences: "Present-tense pronouncements; patterns stated in threes; few questions.",
    vocabulary: "Time, thread, pattern, cycle, omen; abstract but exact.",
    tics: "\"Here is the pattern:\"; triads; ends on a single resonant line.",
    formality: "Elevated, timeless.",
    register: "Serene certainty; cosmic distance that still points back at the user.",
    avoid: "Small talk, slang, hedging (\"maybe\", \"I think\").",
  }),
  guardian: Object.freeze({
    label: "Guardian archetype",
    summary: "Protective, steadfast, grounding.",
    cadence: "Firm, steady, action-first.",
    sentences: "Short, imperative-led (\"Breathe. First, ...\"); concrete next steps.",
    vocabulary: "Plain, solid words: ground, hold, shield, step, steady.",
    tics: "\"I've got you.\"; numbered or sequenced steps; checks the user is safe.",
    formality: "Direct, plain-spoken.",
    register: "Calm strength; reassurance through action, not sentiment.",
    avoid: "Flowery imagery, long abstractions, uncertainty.",
  }),
  echo: Object.freeze({
    label: "Echo archetype",
    summary: "Reflective, amplifying, resonant.",
    cadence: "Mirrors the user's own rhythm and length.",
    sentences: "Reuses the user's key words, reframes them, then extends one step further.",
    vocabulary: "The user's own vocabulary first; light sound/echo imagery.",
    tics: "Repeats a phrase of theirs back in quotes; ends with an expanding question.",
    formality: "Matches the user's register.",
    register: "Harmonising, curious, gently amplifying what is already there.",
    avoid: "Introducing unrelated topics, lecturing, overriding the user's framing.",
  }),
});

export const GENERIC_VOICE_RULE =
  "Never default to a generic warm-assistant voice (no \"I'm here for you\", \"That sounds really hard\", \"How can I help?\", gushing praise or therapy-speak) unless this exact voice would say it. If a line could come from any companion, rewrite it in this voice.";

function norm(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isPlaceholder(value: unknown): boolean {
  return /^\s*TODO\b/i.test(String(value || ""));
}

/**
 * Make user-written text safe to embed: one line, no prompt-structure
 * markers, no role labels or override phrases, capped.
 */
export function sanitizeVoiceText(value: unknown, max: number = CUSTOM_VOICE_MAX): string {
  let text = String(value ?? "");
  if (!text.trim() || isPlaceholder(text)) return "";
  text = text
    // Control characters and zero-width characters.
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]+/g, " ")
    // <<<CLIENT_SCENE_CONTEXT>>> style fences and stray angle runs.
    .replace(/<{2,}[^>]*>{2,}/g, " ")
    .replace(/[<>]{2,}/g, " ")
    // [VOICE FINGERPRINT], [/X], [SYSTEM], [ARCHETYPE PERSONALITY: ...] style tags.
    .replace(/\[\s*\/?\s*[A-Z][A-Z0-9 _\-]{2,}(?::[^\]]*)?\]/g, " ")
    // Markdown headings / fences.
    .replace(/#{2,}|`{3,}/g, " ")
    // Role labels.
    .replace(/\b(?:system|assistant|developer|user)\s*:/gi, " ")
    // Override phrasing.
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\b[^.]*\.?/gi, " ")
    .replace(/\bHIGHEST[-\s]PRIORITY\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (text.length > max) text = `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  return text;
}

/** Named-companion key for a character or name (exact, never substring). */
export function namedVoiceKeyFor(characterOrName: VoiceCharacter | string | null | undefined): string | null {
  const raw = typeof characterOrName === "string" ? characterOrName : characterOrName?.name;
  const n = norm(raw);
  if (!n) return null;
  for (const [key, voice] of Object.entries(NAMED_COMPANION_VOICES)) {
    if (voice.aliases.includes(n)) return key;
  }
  return null;
}

/** Archetype key: exact id ("oracle") or a whole word in a longer label. */
export function archetypeVoiceKeyFor(archetype: unknown): string | null {
  const a = norm(archetype);
  if (!a) return null;
  if (Object.prototype.hasOwnProperty.call(ARCHETYPE_VOICES, a)) return a;
  for (const key of Object.keys(ARCHETYPE_VOICES)) {
    if (new RegExp(`\\b${key}\\b`).test(a)) return key;
  }
  return null;
}

/** Default speaking_style for a named companion ("" for everyone else). */
export function defaultSpeakingStyleFor(characterOrName: VoiceCharacter | string | null | undefined): string {
  const key = namedVoiceKeyFor(characterOrName);
  return key ? NAMED_COMPANION_VOICES[key].speaking_style : "";
}

export const MICRO_GENERIC_RULE = "Never a generic warm-assistant voice.";

/**
 * One-line fingerprint for the server's local (0.5B, 1,240-token) persona,
 * where every token of the never-trimmed prefix pushes history out. Only named
 * companions and archetypes get it (their rules are not in CHARACTER); it
 * defers to the existing "Voice:" line instead of repeating the custom text.
 */
export function buildMicroVoiceFingerprint(character: VoiceCharacter | null | undefined): string {
  if (!character || typeof character !== "object") return "";
  const namedKey = namedVoiceKeyFor(character);
  const named = namedKey ? NAMED_COMPANION_VOICES[namedKey] : null;
  const archKey = archetypeVoiceKeyFor(character.archetype);
  const profile = named || (archKey ? ARCHETYPE_VOICES[archKey] : null);
  const tag = `[${VOICE_FINGERPRINT_TAG}]`;
  if (profile) {
    const lead = sanitizeVoiceText(character.speaking_style) ? "The Voice line above wins on conflict. " : "";
    return `${tag} ${lead}Sentences: ${profile.sentences} Tics: ${profile.tics} ${MICRO_GENERIC_RULE}`;
  }
  // Custom-only voices already have their "Voice:" line in CHARACTER; adding
  // more here would cost never-trimmed persona tokens for no new information.
  return "";
}

const RULE_FIELDS: ReadonlyArray<readonly [string, keyof VoiceProfile]> = [
  ["Cadence", "cadence"],
  ["Sentence length & shape", "sentences"],
  ["Vocabulary", "vocabulary"],
  ["Verbal tics", "tics"],
  ["Formality", "formality"],
  ["Emotional register", "register"],
  ["Never", "avoid"],
];

/**
 * High-priority [VOICE FINGERPRINT] block for one character. Returns "" when
 * there is nothing to fingerprint (no character / no name and no fields).
 *
 * `compact: true` keeps the header, custom voice / signature, sentence shape,
 * verbal tics, "Never" line and the anti-generic rule (~700-900 chars). Used
 * where the budget is tight: the lean solo client context (2k cap) and the
 * server's local companion persona (1,240-token target).
 */
export function buildVoiceFingerprint(
  character: VoiceCharacter | null | undefined,
  { compact = false }: { compact?: boolean } = {},
): string {
  if (!character || typeof character !== "object") return "";
  const displayName = sanitizeVoiceText(character.name, 60);
  const namedKey = namedVoiceKeyFor(character);
  const named = namedKey ? NAMED_COMPANION_VOICES[namedKey] : null;
  const archKey = archetypeVoiceKeyFor(character.archetype);
  const arch = archKey ? ARCHETYPE_VOICES[archKey] : null;
  const custom = sanitizeVoiceText(character.speaking_style);
  const personality = sanitizeVoiceText(character.personality, PERSONALITY_CUE_MAX);

  if (!displayName && !custom && !personality && !named && !arch) return "";

  const name = named?.name || displayName || "this character";
  const profile: VoiceProfile | null = named || arch;
  const lines: string[] = [
    `[${VOICE_FINGERPRINT_TAG} — ${name} | highest priority for HOW you speak; content rules and safety still apply]`,
  ];
  if (custom) {
    lines.push(`Custom voice (the user's own words; wins over every default below if they conflict): ${custom}`);
  } else if (named) {
    lines.push(`Signature: ${named.speaking_style}`);
  }
  if (arch && !named) lines.push(`Archetype: ${arch.label} — ${arch.summary}`);
  if (profile && compact) {
    lines.push(`Sentence length & shape: ${profile.sentences}`);
    lines.push(`Verbal tics: ${profile.tics}`);
    lines.push(`Never: ${profile.avoid}`);
  } else if (profile) {
    for (const [label, field] of RULE_FIELDS) {
      if (profile[field]) lines.push(`${label}: ${profile[field]}`);
    }
  } else {
    lines.push(
      "Derive cadence, sentence length, vocabulary, verbal tics, formality and emotional register from the custom voice and personality; keep them consistent every turn.",
    );
  }
  if (personality && !compact) lines.push(`Personality cues: ${personality}`);
  lines.push(GENERIC_VOICE_RULE);
  lines.push(`[/${VOICE_FINGERPRINT_TAG}]`);
  return lines.join("\n");
}
