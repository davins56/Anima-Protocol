/**
 * In-character explanation (§4.7): template text in her register, no model
 * call, plain text, ≤ 280 chars, never an emotion word, tone or number.
 */
import { words } from "./lexicon";
import { getStyle, getVariant, type MartialLibrary } from "./library";
import type { Axis, StyleKind, StylePick } from "./types";

export const EXPLANATION_MAX = 280;
export const REGISTERS = ["formal", "terse", "playful", "warm", "poetic", "plain"] as const;
export type Register = (typeof REGISTERS)[number];

const REGISTER_WORDS: Record<Exclude<Register, "plain">, readonly string[]> = {
  terse: ["terse", "blunt", "curt", "short", "laconic", "direct", "clipped", "brief", "economical"],
  formal: ["formal", "eloquent", "measured", "polite", "proper", "articulate", "courtly", "precise"],
  playful: ["playful", "teasing", "cheeky", "mischievous", "witty", "sarcastic", "wry", "flirty", "jokey"],
  warm: ["warm", "gentle", "kind", "soft", "tender", "caring", "soothing", "nurturing"],
  poetic: ["poetic", "lyrical", "riddling", "cryptic", "mystical", "dreamy", "ancient", "elemental", "archaic"],
};

/** Register from her speaking_style words; first match in a fixed order wins ties. */
export function registerFor(speakingStyle: unknown): Register {
  const w = words(typeof speakingStyle === "string" ? speakingStyle : "");
  let best: Register = "plain";
  let bestHits = 0;
  for (const reg of ["terse", "formal", "playful", "warm", "poetic"] as const) {
    const hits = w.filter((x) => REGISTER_WORDS[reg].includes(x)).length;
    if (hits > bestHits) {
      best = reg;
      bestHits = hits;
    }
  }
  return best;
}

export const WHY: Readonly<Record<Axis, string>> = {
  aggression: "it goes forward and keeps going",
  patience: "it waits for the opening instead of forcing one",
  precision: "no wasted motion",
  flow: "it moves around whatever comes at it",
  control: "I'd rather end a fight than win it ugly",
  cunning: "it wins on angles and misdirection",
  grit: "it's built to take a hit and answer",
  tradition: "it carries a long lineage",
  pragmatism: "it does what works, nothing decorative",
  rhythm: "it has a pulse I can fight to",
};

const SECONDARY_LEAD: Record<StyleKind, string> = {
  grappling: "if it goes to the ground",
  weapon: "if there's a stick or blade in reach",
  striking: "if there's room to hit",
  hybrid: "if the rules run out",
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function explain(args: {
  lib: MartialLibrary;
  primary: StylePick;
  secondary: StylePick | null;
  reasonAxes: readonly Axis[];
  speakingStyle?: unknown;
}): string {
  const style = getStyle(args.lib, args.primary.style_id);
  if (!style) return "";
  const variant = getVariant(style, args.primary.variant_id);
  const name = variant ? `${style.name}, ${variant.name}` : style.name;
  const axes = args.reasonAxes.length ? args.reasonAxes : (["pragmatism"] as Axis[]);
  const why1 = WHY[axes[0]];
  const why2 = axes[1] ? WHY[axes[1]] : "";
  const sec = args.secondary ? getStyle(args.lib, args.secondary.style_id) : null;
  const lead = sec ? SECONDARY_LEAD[sec.kind] : "";
  let text: string;
  switch (registerFor(args.speakingStyle)) {
    case "terse":
      text = `${name}. ${cap(why1)}.${sec ? ` If it gets messy, ${sec.name}.` : ""}`;
      break;
    case "formal":
      text = `I favour ${name}: ${why1}${why2 ? `, and ${why2}` : ""}.${sec ? ` Should it come to that, ${lead}, ${sec.name}.` : ""}`;
      break;
    case "playful":
      text = `${name}, obviously. ${cap(why1)}${why2 ? `, and ${why2}` : ""}.${sec ? ` Backup plan, ${lead}: ${sec.name}.` : ""}`;
      break;
    case "warm":
      text = `I'd choose ${name}. ${cap(why1)}${why2 ? `, and ${why2}` : ""}.${sec ? ` And ${lead}, ${sec.name} too.` : ""}`;
      break;
    case "poetic":
      text = `${name}: ${why1}${why2 ? `; ${why2}` : ""}.${sec ? ` Beneath it, ${lead}, ${sec.name}.` : ""}`;
      break;
    default:
      text = `My style is ${name}. ${cap(why1)}${why2 ? `, and ${why2}` : ""}.${sec ? ` ${cap(lead)}, ${sec.name}.` : ""}`;
  }
  return text.length > EXPLANATION_MAX ? `${text.slice(0, EXPLANATION_MAX - 1).trimEnd()}…` : text;
}
