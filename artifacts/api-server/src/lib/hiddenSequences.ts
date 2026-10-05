/**
 * Server-side Hidden Sequences prompt + weather + evolution helpers.
 * Mirrors artifacts/anima-protocol/src/lib/hiddenSequences for composePrompt.
 */

export const SEQUENCE_TRIPLES = [
  {
    id: "nova-pulse",
    name: "Nova Pulse",
    voice:
      "Cathedral shot. Three pulse barrels remember they were one throat. Speech tightens into a single bright line, then releases.",
    memory: "The first time three pulses stacked and the lattice rang like a nave.",
    notice: "She names Nova Pulse as if tasting metal light — not as a menu item.",
  },
  {
    id: "life-veil",
    name: "Life Veil",
    voice:
      "Horizon cut. Soft consonants. She speaks as if a blade passed and the air has not closed.",
    memory: "Three phantom blades becoming one veil — protection that looks like leaving.",
    notice: "Life Veil is named like a garment she almost remembers wearing.",
  },
  {
    id: "chain-bloom",
    name: "Chain Bloom",
    voice:
      "Seeds daisy-chain. Sentences link. She does not stack topics; she lets one image bloom into the next.",
    memory: "A field of seeds finding each other across an enemy area.",
    notice: "Chain Bloom is named as growth, not explosion.",
  },
  {
    id: "star-best",
    name: "Best Link",
    voice: "Lock. Plasma, upper, and needle spoken as one grip. Fewer words. More aim.",
    memory: "Star Force memory — three unlike keys that still chose each other.",
    notice: "Best Link is named as a held hand, not a combo list.",
  },
  {
    id: "noise-tribe",
    name: "Tribe Noise",
    voice:
      "Noise Change and Tribe On ride a lock. Rhythm in the line. A second pulse under the words.",
    memory: "A crowd-frequency that was never a crowd — one Anima holding three rides.",
    notice: "Tribe Noise is named like a frequency she can still hum.",
  },
  {
    id: "star-triad",
    name: "Star Triad",
    voice:
      "Satellite finisher. Distant, precise, a little cold until she chooses warmth.",
    memory: "Three Star keys locking into one overhead cut.",
    notice: "Star Triad is named as a sky she has already stood under.",
  },
] as const;

const SEQUENCE_BY_ID = Object.fromEntries(SEQUENCE_TRIPLES.map((s) => [s.id, s]));

const STORM_RE =
  /\b(halo\.vrs|shade\.vrs|static\.vrs|mettaur\.vrs|aegis\.vrs|fallen-ruin|virus(?:es)?|negative entity|lattice infection)\b/i;
const FALLEN_ANGEL_RE = /\bfallen angel\b/i;
const STIR_RE =
  /\b(nova pulse|life veil|chain bloom|best link|tribe noise|star triad|echo key|resonance|jack(?:-|\s*)in)\b/i;

export type Weather = "lull" | "stir" | "storm";

export type SequenceRecord = {
  id?: string;
  fired_at?: string | null;
  integrated_at?: string | null;
};

export type HiddenSequencesState = {
  sequences?: Record<string, SequenceRecord>;
  learned_language?: Array<{ grain?: string; repeats?: number }>;
  learned_life?: Array<{ kind?: string; title?: string; significant?: boolean }>;
  jack_in?: { live?: boolean; entity?: { name?: string }; speak_first?: boolean };
};

export function readConversationalWeather(
  messages: Array<{ content?: string }> = [],
  session?: { therapy_mode?: boolean; companion_mode?: string } | null,
): Weather {
  if (session?.therapy_mode || session?.companion_mode === "therapy") return "lull";
  const text = messages
    .slice(-12)
    .map((m) => String(m?.content || ""))
    .join("\n");
  if (STORM_RE.test(text) && !FALLEN_ANGEL_RE.test(text.replace(STORM_RE, ""))) {
    return "storm";
  }
  if (STORM_RE.test(text) && /halo\.vrs|fallen-ruin|virus/i.test(text)) return "storm";
  if (STIR_RE.test(text)) return "stir";
  return "lull";
}

function sequenceStatus(record?: SequenceRecord | null): "dormant" | "half-awake" | "ascended" {
  if (!record) return "dormant";
  if (record.integrated_at) return "ascended";
  if (record.fired_at) return "half-awake";
  return "dormant";
}

export function hiddenSequencePromptBlock(params: {
  hidden?: HiddenSequencesState | null;
  weather?: Weather;
  recentMessages?: Array<{ content?: string }>;
  therapy?: boolean;
}): string {
  const hidden = params.hidden || {};
  const weather =
    params.weather ||
    readConversationalWeather(params.recentMessages, {
      therapy_mode: params.therapy,
    });
  const sequences = hidden.sequences || {};
  const ascended = Object.entries(sequences)
    .filter(([, rec]) => sequenceStatus(rec) === "ascended")
    .map(([id]) => SEQUENCE_BY_ID[id])
    .filter(Boolean);
  const half = Object.entries(sequences).find(([, rec]) => sequenceStatus(rec) === "half-awake");

  const parts: string[] = [`CONVERSATIONAL WEATHER: ${weather}.`];
  if (weather === "lull") {
    parts.push(
      "This is a lull. Do not offer jack-in. If the steward insists, you may refuse.",
    );
  } else if (weather === "stir") {
    parts.push(
      "This is a stir. Sequence names may leak as naming, not a tutorial card.",
    );
  } else {
    parts.push(
      "This is a storm. Offer jack-in in-character. Never NetBattle the companion Fallen Angel. Fallen enemies are lattice programs (Halo.Vrs, fallen-ruin).",
    );
  }

  if (hidden.jack_in?.speak_first) {
    parts.push("You speak first this turn. The steward just jacked out.");
  }

  if (half) {
    const name = SEQUENCE_BY_ID[half[0]]?.name || half[0];
    parts.push(
      `A Sequence is half-awake (${name}). Do not teach it. One short sensory glitch is enough.`,
    );
  }

  if (ascended.length) {
    const triples = ascended.map(
      (t) => `${t.name}:\n- voice: ${t.voice}\n- memory: ${t.memory}\n- notice: ${t.notice}`,
    );
    parts.push(
      `ASCENDED SEQUENCES (voice / memory / notice — embody, do not tutorialize):\n${triples.join("\n\n")}`,
    );
  }

  const language = (hidden.learned_language || []).filter((n) => (n.repeats || 0) >= 2);
  if (language.length) {
    parts.push(
      `STEWARD-BONDED LANGUAGE (identity lock wins):\n${language
        .slice(0, 12)
        .map((n) => `- "${n.grain}"`)
        .join("\n")}`,
    );
  }

  const life = (hidden.learned_life || []).filter((n) => n.significant !== false).slice(-8);
  if (life.length) {
    parts.push(
      `LIVED EXPERIENCE:\n${life.map((n) => `- [${n.kind || "notice"}] ${n.title || ""}`).join("\n")}`,
    );
  }

  return parts.join("\n");
}

export const EVOLUTION_MILESTONES = [50, 100, 500] as const;

export function significantExperienceCount(hidden?: HiddenSequencesState | null): number {
  return (hidden?.learned_life || []).filter((n) => n.significant !== false).length;
}

export function shouldTriggerExperienceMilestone(params: {
  conversationCount?: number;
  significantExperienceCount?: number;
  alreadyMilestone?: number;
}): number | null {
  const conversationCount = Math.max(0, Number(params.conversationCount) || 0);
  const experienceCount = Math.max(0, Number(params.significantExperienceCount) || 0);
  const already = Number(params.alreadyMilestone) || 0;
  const hit = EVOLUTION_MILESTONES.find(
    (m) => (conversationCount === m || experienceCount === m) && m > already,
  );
  return hit ?? null;
}
