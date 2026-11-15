/**
 * Narration read model (§5): maps existing battle events to plain-text
 * technique lines. No new sim events, no stateHash change, no model calls.
 * Lines never name an emotion, tone or number (#767); tone only chooses which
 * technique line is used and adds a neutral technique tint.
 */
import { fnv1a } from "./hash";
import { getStyle, getVariant, type MartialLibrary } from "./library";
import { stanceFor, techniqueLines } from "./techniques";
import type { StylePick, Tone } from "./types";

export const NAVI_ID = "navi";

export type NarrationEvent = {
  type: string;
  seq?: number;
  unitId?: string;
  sourceId?: string;
  outcome?: string;
};

const TONE_TINT: Record<Tone, readonly string[]> = {
  composed: ["clean and timed", "on the beat"],
  fierce: ["driving forward", "heavier now"],
  guarded: ["tight cover held", "short and close"],
  shaken: ["off a quick reset", "a step late, still landing"],
  playful: ["with a feint first", "off a quick change of angle"],
};

function choose<T>(items: readonly T[], key: string): T {
  return items[fnv1a(key) % items.length];
}

/** One stance line for an encounter or battle start, e.g. "She settles into a low silat stance." */
export function stanceLine(lib: MartialLibrary, pick: StylePick | null | undefined, who = "She"): string | null {
  const style = getStyle(lib, pick?.style_id);
  if (!style) return null;
  const variant = getVariant(style, pick?.variant_id);
  const label = variant ? `${style.name}, ${variant.name}` : style.name;
  return `${who} settles into ${stanceFor(style.id, style.range)}. ${label}.`;
}

/**
 * A technique line for a navi action, or null when the event isn't one we
 * narrate. `seq` keeps the choice stable per event.
 */
export function narrate(lib: MartialLibrary, event: NarrationEvent, pick: StylePick | null | undefined, tone: Tone = "composed"): string | null {
  const style = getStyle(lib, pick?.style_id);
  if (!style || !event || typeof event.type !== "string") return null;
  const seq = Number.isFinite(event.seq) ? String(event.seq) : "0";
  const lines = techniqueLines(style.id, style.kind);
  const key = `${style.id}|${pick?.variant_id ?? ""}|${seq}|${tone}`;
  switch (event.type) {
    case "chip_used":
    case "hit":
      if ((event.unitId ?? event.sourceId) !== NAVI_ID) return null;
      return `${choose(lines, key)}, ${choose(TONE_TINT[tone] ?? TONE_TINT.composed, `${key}|tint`)}.`;
    case "phase_landed":
      if (event.unitId !== NAVI_ID) return null;
      return `Resets into ${stanceFor(style.id, style.range)}.`;
    case "battle_end":
      return event.outcome === "win" ? `${style.name}: the last exchange lands.` : `${style.name}: breaks off and resets.`;
    default:
      return null;
  }
}
