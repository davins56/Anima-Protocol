// @ts-check
import { HALF_AWAKE_GLITCH, SEQUENCE_BY_ID, SEQUENCE_TRIPLES } from "./catalog.js";
import { listAscended, listHalfAwake, normalizeSequences } from "./state.js";

/**
 * Only ascended Sequence triples enter the prompt.
 * Half-awake = one short glitch note.
 * Stir/storm may leak names as naming, not a tutorial.
 *
 * @param {{
 *   sequences?: Record<string, unknown>,
 *   weather?: "lull" | "stir" | "storm",
 *   entity?: { name?: string } | null,
 *   offerJackIn?: boolean,
 *   refuseJackIn?: boolean,
 *   refuseMessage?: string,
 *   speakFirst?: boolean,
 *   pendingIntegration?: string | null,
 * }} params
 */
export function hiddenSequencePromptBlock(params = {}) {
  const sequences = normalizeSequences(params.sequences);
  const ascended = listAscended(sequences);
  const half = listHalfAwake(sequences);
  const weather = params.weather || "lull";
  const parts = [];

  parts.push(`CONVERSATIONAL WEATHER: ${weather}.`);
  if (weather === "lull") {
    parts.push(
      "This is a lull. Do not offer jack-in. Do not mention NetBattle unless the steward insists — and if they insist, you may refuse. Stay in the room.",
    );
  } else if (weather === "stir") {
    parts.push(
      "This is a stir. Sequence names may leak into dialogue as naming — a word she almost remembers — not a tutorial card and not a menu.",
    );
    const names = SEQUENCE_TRIPLES.map((s) => s.name).join(", ");
    parts.push(`Names that may surface, only as naming: ${names}.`);
  } else {
    const entityName = params.entity?.name || "Halo.Vrs";
    parts.push(
      `This is a storm. A lattice program is in the scene (${entityName}). Never NetBattle the companion Fallen Angel. Fallen enemies are lattice programs.`,
    );
    if (params.offerJackIn) {
      parts.push(
        "Offer jack-in in-character. Speak the entity. Do not pop a fight tutorial. One offer is enough.",
      );
    }
    parts.push(
      "Sequence names may leak into dialogue as naming, not a tutorial card.",
    );
  }

  if (params.refuseJackIn) {
    parts.push(
      `JACK-IN REFUSAL (in-character): ${params.refuseMessage || "Not this weather. The lattice is still."}`,
    );
  }

  if (params.speakFirst) {
    parts.push(
      "You speak first this turn. The steward just jacked out. Open the beat — do not wait for them to recap the match.",
    );
  }

  if (params.pendingIntegration && half.some((s) => s.id === params.pendingIntegration)) {
    const triple = SEQUENCE_BY_ID[params.pendingIntegration];
    parts.push(
      `INTEGRATION TURN: ${triple?.name || params.pendingIntegration} is half-awake. Speak the memory until it can become voice. Do not lecture.`,
    );
  }

  if (half.length) {
    const name = SEQUENCE_BY_ID[half[0].id]?.name || half[0].id;
    parts.push(HALF_AWAKE_GLITCH.replace("{name}", name));
  }

  if (ascended.length) {
    const triples = ascended
      .map((s) => SEQUENCE_BY_ID[s.id])
      .filter(Boolean)
      .map(
        (t) =>
          `${t.name}:\n- voice: ${t.voice}\n- memory: ${t.memory}\n- notice: ${t.notice}`,
      );
    if (triples.length) {
      parts.push(
        `ASCENDED SEQUENCES (voice / memory / notice — embody, do not tutorialize):\n${triples.join("\n\n")}`,
      );
    }
  }

  return `\n${parts.join("\n")}\n`;
}

/**
 * @param {Record<string, unknown>} sequences
 */
export function ascendedArtifactIds(sequences) {
  return listAscended(sequences)
    .map((s) => SEQUENCE_BY_ID[s.id]?.artifact)
    .filter(Boolean);
}
