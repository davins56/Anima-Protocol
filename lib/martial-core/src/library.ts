/**
 * Effective library = seed ∪ user (§2.1, D1: extend, never replace).
 *
 * - User style ids are namespaced `u_<slug>`, so they can never shadow a seed id.
 * - A user variant can be added to a seed style: `{ style_id: "wing_chun", variant: { id: "u_<slug>", … } }`.
 * - Malformed user input is rejected by `validateUserStyle` (no throw, returns errors).
 * - Battle knobs for user styles are derived from kind/range/axes and clamped
 *   exactly like seed styles (battle.ts), so they are never free-form.
 */
import { SEED_LIBRARY_VERSION, SEED_STYLES } from "./library.seed";
import { AXES, type AxisVector, type MartialStyle, type MartialVariant, type StyleKind, type StyleRange } from "./types";

export const USER_ID_PREFIX = "u_";
export const USER_STYLE_CAP = 100;
export const USER_VARIANT_CAP = 8;
export const SUMMARY_MAX = 160;
const ID_RE = /^[a-z][a-z0-9_]{0,47}$/;
const USER_ID_RE = /^u_[a-z0-9][a-z0-9_]{0,45}$/;
const KINDS: StyleKind[] = ["striking", "grappling", "hybrid", "weapon"];
const RANGES: StyleRange[] = ["close", "mid", "long", "clinch", "ground", "weapon"];

export type MartialLibrary = {
  version: string;
  styles: readonly MartialStyle[];
  byId: ReadonlyMap<string, MartialStyle>;
};

/** Plain text only: no markup, no control characters, trimmed and capped. */
export function plainText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

function axisVector(raw: unknown, allowNegative = false): AxisVector | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = {} as AxisVector;
  for (const k of Object.keys(r)) if (!(AXES as readonly string[]).includes(k)) return null;
  for (const axis of AXES) {
    const v = r[axis] ?? 0;
    if (typeof v !== "number" || !Number.isInteger(v)) return null;
    if (v > 3 || v < (allowNegative ? -3 : 0)) return null;
    out[axis] = v;
  }
  return out;
}

/** Flat result (the app tsconfig is non-strict, so union narrowing on `ok` is unreliable). */
export type UserStyleResult = { ok: boolean; style: MartialStyle | null; errors: string[] };

/** Validate one user-supplied style. Ids must be `u_*`; knobs are never accepted from input. */
export function validateUserStyle(raw: unknown): UserStyleResult {
  const errors: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!USER_ID_RE.test(id)) errors.push("id must be u_<slug>");
  const name = plainText(r.name, 60);
  if (!name) errors.push("name is required");
  const summary = plainText(r.summary, SUMMARY_MAX + 1);
  if (!summary) errors.push("summary is required");
  if (summary.length > SUMMARY_MAX) errors.push(`summary must be ≤ ${SUMMARY_MAX} chars`);
  const kind = KINDS.includes(r.kind as StyleKind) ? (r.kind as StyleKind) : null;
  if (!kind) errors.push("unknown kind");
  const range = RANGES.includes(r.range as StyleRange) ? (r.range as StyleRange) : null;
  if (!range) errors.push("unknown range");
  const axes = axisVector(r.axes);
  if (!axes) errors.push("axes must be integers 0–3 on the ten known axes");
  const rawVariants = Array.isArray(r.variants) ? r.variants : [];
  if (rawVariants.length > USER_VARIANT_CAP) errors.push(`at most ${USER_VARIANT_CAP} variants`);
  const variants: MartialVariant[] = [];
  for (const v of rawVariants.slice(0, USER_VARIANT_CAP)) {
    const res = validateUserVariant(v);
    if (res.ok && res.variant) variants.push(res.variant);
    else errors.push(...res.errors.map((e) => `variant: ${e}`));
  }
  if (new Set(variants.map((v) => v.id)).size !== variants.length) errors.push("duplicate variant id");
  if (errors.length || !kind || !range || !axes) return { ok: false, style: null, errors };
  const sources = Array.isArray(r.sources)
    ? r.sources.filter((u): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u)).slice(0, 5)
    : [];
  return {
    ok: true,
    style: { id, source: "user", name, family: plainText(r.family, 40) || "user", kind, range, summary, axes, variants, sources },
    errors: [],
  };
}

export type UserVariantResult = { ok: boolean; variant: MartialVariant | null; errors: string[] };

export function validateUserVariant(raw: unknown): UserVariantResult {
  const errors: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!USER_ID_RE.test(id)) errors.push("id must be u_<slug>");
  const name = plainText(r.name, 60);
  if (!name) errors.push("name is required");
  const description = plainText(r.description, SUMMARY_MAX);
  const tilt = axisVector(r.tilt ?? {}, true);
  if (!tilt) errors.push("tilt must be integers −3..3 on the ten known axes");
  if (errors.length || !tilt) return { ok: false, variant: null, errors };
  const sparse: Partial<AxisVector> = {};
  for (const axis of AXES) if (tilt[axis]) sparse[axis] = tilt[axis];
  return { ok: true, variant: { id, source: "user", name, description, tilt: sparse }, errors: [] };
}

export type UserLibraryInput = {
  styles?: unknown[];
  /** user variants added to existing (seed or user) styles */
  variants?: Array<{ style_id: string; variant: unknown }>;
  /** bumped whenever the user list changes */
  revision?: number;
};

/**
 * Merge user styles into the seed catalog. Invalid entries are skipped and
 * reported, never thrown. A user entry can never overwrite a seed id.
 */
export function buildLibrary(user?: UserLibraryInput | null): MartialLibrary & { rejected: string[] } {
  const byId = new Map<string, MartialStyle>();
  for (const s of SEED_STYLES) byId.set(s.id, { ...s, variants: [...s.variants] });
  const rejected: string[] = [];
  let userCount = 0;
  for (const raw of (user?.styles ?? []).slice(0, USER_STYLE_CAP)) {
    const res = validateUserStyle(raw);
    const style = res.style;
    if (!res.ok || !style) {
      rejected.push(`${String((raw as { id?: unknown })?.id ?? "?")}: ${res.errors.join(", ")}`);
      continue;
    }
    if (byId.has(style.id)) {
      rejected.push(`${style.id}: duplicate id`);
      continue;
    }
    byId.set(style.id, style);
    userCount++;
  }
  for (const entry of user?.variants ?? []) {
    const style = byId.get(entry?.style_id);
    const res = validateUserVariant(entry?.variant);
    const variant = res.variant;
    if (!style || !res.ok || !variant) {
      rejected.push(`${entry?.style_id ?? "?"} variant: ${style ? res.errors.join(", ") : "unknown style"}`);
      continue;
    }
    if (style.variants.some((v) => v.id === variant.id) || style.variants.length >= USER_VARIANT_CAP + 8) {
      rejected.push(`${style.id}/${variant.id}: duplicate or too many variants`);
      continue;
    }
    style.variants.push(variant);
    userCount++;
  }
  const version = userCount ? `${SEED_LIBRARY_VERSION}+user@${Math.max(1, Math.floor(user?.revision ?? 1))}` : SEED_LIBRARY_VERSION;
  return { version, styles: [...byId.values()], byId, rejected };
}

export const SEED_LIBRARY: MartialLibrary = (() => {
  const { version, styles, byId } = buildLibrary(null);
  return { version, styles, byId };
})();

export function getStyle(lib: MartialLibrary, styleId: unknown): MartialStyle | null {
  return typeof styleId === "string" ? lib.byId.get(styleId) ?? null : null;
}

export function getVariant(style: MartialStyle | null, variantId: unknown): MartialVariant | null {
  if (!style || typeof variantId !== "string") return null;
  return style.variants.find((v) => v.id === variantId) ?? null;
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && (ID_RE.test(id) || USER_ID_RE.test(id));
}

/** Style + optional variant display label, e.g. "Muay Thai (Muay Khao)". */
export function pickLabel(lib: MartialLibrary, pick: { style_id: string; variant_id?: string | null } | null | undefined): string {
  const style = getStyle(lib, pick?.style_id);
  if (!style) return "";
  const variant = getVariant(style, pick?.variant_id);
  return variant ? `${style.name} (${variant.name})` : style.name;
}
