/**
 * Profile shape helpers (§3). The server owns `martial_arts`; these pure
 * helpers build, validate on read, and resolve battle modifiers so the client
 * and the server agree. Free text from storage is never trusted: an invalid
 * explanation is regenerated from templates.
 */
import { applyTone, clampMods, deriveBattle, NEUTRAL_MODS } from "./battle";
import { explain, EXPLANATION_MAX } from "./explain";
import { getStyle, getVariant, type MartialLibrary } from "./library";
import { chooseStyle, type Choice } from "./select";
import { AXES, type Axis, type BattleMods, type MartialProfile, type PersonalityInputs, type ProfileSource, type StylePick, type Tone } from "./types";

export type PickError = "unknown_style" | "unknown_variant" | "same_style";

function nonNegInt(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : 0;
}

/** Flat results (the app tsconfig is non-strict, so union narrowing on `ok` is unreliable). */
export type PickResult = { ok: boolean; pick: StylePick | null; error: PickError | null };
export type OverrideResult = { ok: boolean; primary: StylePick | null; secondary: StylePick | null; error: PickError | null };

/** Validate an id pick against the library. Variant may be null. */
export function validatePick(lib: MartialLibrary, raw: unknown): PickResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const style = getStyle(lib, r.style_id);
  if (!style) return { ok: false, pick: null, error: "unknown_style" };
  if (r.variant_id === undefined || r.variant_id === null) return { ok: true, pick: { style_id: style.id, variant_id: null }, error: null };
  const variant = getVariant(style, r.variant_id);
  if (!variant) return { ok: false, pick: null, error: "unknown_variant" };
  return { ok: true, pick: { style_id: style.id, variant_id: variant.id }, error: null };
}

/** Validate an override body `{primary, secondary?}` (§6.3). */
export function validateOverride(lib: MartialLibrary, primary: unknown, secondary: unknown): OverrideResult {
  const fail = (error: PickError): OverrideResult => ({ ok: false, primary: null, secondary: null, error });
  const p = validatePick(lib, primary);
  if (!p.ok || !p.pick) return fail(p.error ?? "unknown_style");
  if (secondary === undefined || secondary === null) return { ok: true, primary: p.pick, secondary: null, error: null };
  const s = validatePick(lib, secondary);
  if (!s.ok || !s.pick) return fail(s.error ?? "unknown_style");
  if (s.pick.style_id === p.pick.style_id) return fail("same_style");
  return { ok: true, primary: p.pick, secondary: s.pick, error: null };
}

export function buildProfile(args: {
  lib: MartialLibrary;
  choice: Pick<Choice, "primary" | "secondary" | "reason_axes" | "inputs_hash" | "roll">;
  source: ProfileSource;
  rev: number;
  speakingStyle?: unknown;
  now: string;
}): MartialProfile {
  const { lib, choice } = args;
  return {
    version: 1,
    library_version: lib.version,
    rev: nonNegInt(args.rev),
    primary: choice.primary,
    secondary: choice.secondary,
    source: args.source,
    roll: nonNegInt(choice.roll),
    reason_axes: choice.reason_axes,
    explanation: explain({ lib, primary: choice.primary, secondary: choice.secondary, reasonAxes: choice.reason_axes, speakingStyle: args.speakingStyle }),
    inputs_hash: choice.inputs_hash,
    chosen_at: args.now,
  };
}

/** Convenience: auto/re-roll profile straight from inputs. */
export function autoProfile(args: { lib: MartialLibrary; inputs: PersonalityInputs; characterId: string; roll?: number; rev: number; now: string }): MartialProfile {
  const choice = chooseStyle({ inputs: args.inputs, characterId: args.characterId, lib: args.lib, roll: args.roll });
  return buildProfile({ lib: args.lib, choice, source: (args.roll ?? 0) > 0 ? "reroll" : "auto", rev: args.rev, speakingStyle: args.inputs.speaking_style, now: args.now });
}

/**
 * Validation on read (§3): unknown style/variant → null ("no profile", she
 * picks again). Missing or overlong explanations are regenerated.
 */
export function readProfile(lib: MartialLibrary, raw: unknown, speakingStyle?: unknown): MartialProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const primaryRes = validatePick(lib, r.primary);
  const primary = primaryRes.pick;
  if (!primary) return null;
  let secondary: StylePick | null = null;
  if (r.secondary !== null && r.secondary !== undefined) {
    const s = validatePick(lib, r.secondary);
    if (!s.pick || s.pick.style_id === primary.style_id) return null;
    secondary = s.pick;
  }
  const reason_axes = Array.isArray(r.reason_axes) ? (r.reason_axes.filter((a) => (AXES as readonly unknown[]).includes(a)).slice(0, 3) as Axis[]) : [];
  const source: ProfileSource = r.source === "reroll" || r.source === "override" ? r.source : "auto";
  const explanationOk = typeof r.explanation === "string" && r.explanation.length > 0 && r.explanation.length <= EXPLANATION_MAX && !/[<>]/.test(r.explanation);
  return {
    version: 1,
    library_version: typeof r.library_version === "string" ? r.library_version : lib.version,
    rev: nonNegInt(r.rev),
    primary,
    secondary,
    source,
    roll: nonNegInt(r.roll),
    reason_axes,
    explanation: explanationOk
      ? (r.explanation as string)
      : explain({ lib, primary, secondary, reasonAxes: reason_axes, speakingStyle }),
    inputs_hash: typeof r.inputs_hash === "string" ? r.inputs_hash : "",
    chosen_at: typeof r.chosen_at === "string" ? r.chosen_at : "",
  };
}

/**
 * Battle modifiers for a pick plus tone, clamped to ±15% combined. Unknown ids,
 * malformed or NaN input give the defined neutral result (Serenity's note).
 */
export function battleModsFor(lib: MartialLibrary, pick: unknown, tone?: Tone | null): BattleMods {
  const style = getStyle(lib, validatePick(lib, pick).pick?.style_id);
  if (!style) return clampMods(NEUTRAL_MODS);
  return applyTone(deriveBattle(style), tone ?? "composed");
}
