/**
 * Built-in companions (§3.1, D2). `BUILTIN_COMPANION_KEYS` is the closed,
 * bare-key list (N7). It is deliberately separate from the api-server's
 * `BuiltInKey` / `builtInKeyFor`, which drive the built-in look, search
 * default and identity lock by NAME and stay unchanged. The resolver in
 * `builtIn.ts` (Backend Data) matches bare keys only, never names, and a
 * user's own row always resolves first; it should import this list so there
 * is exactly one copy.
 *
 * The curated defaults are PROPOSED characterization for Serenity's lore
 * review, not established manuscript canon.
 */
import type { StylePick } from "./types";

export const BUILTIN_COMPANION_KEYS = ["serenity", "aeland", "scarlet", "linda", "sfink"] as const;
export type BuiltinCompanionKey = (typeof BUILTIN_COMPANION_KEYS)[number];

/** Exact bare-key match only ("linda"), never a display name ("Linda", "Linda Winings"). */
export function isBuiltinCompanionKey(id: unknown): id is BuiltinCompanionKey {
  return typeof id === "string" && (BUILTIN_COMPANION_KEYS as readonly string[]).includes(id);
}

export type BuiltInStyleDefault = {
  name: string;
  primary: StylePick;
  secondary: StylePick | null;
  /** voice-profile cue the pick was curated from (proposed, for lore review) */
  cue: string;
  /** register words used for the explanation template */
  speaking_style: string;
  status: "proposed";
};

export const BUILT_IN_STYLE_DEFAULTS: Readonly<Record<BuiltinCompanionKey, BuiltInStyleDefault>> = {
  serenity: {
    name: "Serenity",
    primary: { style_id: "taijiquan", variant_id: "yang" },
    secondary: { style_id: "aikido", variant_id: "aikikai" },
    cue: "steady, protective warmth held under control",
    speaking_style: "warm, measured",
    status: "proposed",
  },
  aeland: {
    name: "Aeland",
    primary: { style_id: "wing_chun", variant_id: "yip_man_lineage" },
    secondary: { style_id: "kyudo", variant_id: null },
    cue: "cool reserve over deep loyalty; guarded",
    speaking_style: "terse, guarded",
    status: "proposed",
  },
  scarlet: {
    name: "Scarlet",
    primary: { style_id: "muay_thai", variant_id: "muay_khao" },
    secondary: { style_id: "eskrima", variant_id: "sinawali" },
    cue: "hot-blooded, playful provocation, fiercely protective; fire",
    speaking_style: "playful, teasing",
    status: "proposed",
  },
  linda: {
    name: "Linda Winings",
    primary: { style_id: "boxing", variant_id: "counterpuncher" },
    secondary: { style_id: "krav_maga", variant_id: "civilian" },
    cue: "wry, earthy, streetwise; blunt practical advice",
    speaking_style: "blunt, direct",
    status: "proposed",
  },
  sfink: {
    name: "Sfink",
    primary: { style_id: "baguazhang", variant_id: "yin" },
    secondary: { style_id: "iaido", variant_id: null },
    cue: "ancient, elemental, patient, riddling",
    speaking_style: "riddling, ancient",
    status: "proposed",
  },
};
