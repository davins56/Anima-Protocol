// @ts-check
/**
 * Front-end half of #765 (ANIMA_EMOTIONS): turn the server's sanitized
 * affect snapshot into quiet, non-label cues.
 *
 * Rules (Serenity review on #765, items 8 and 9; Q5, Q6):
 * - Only allowlisted fields are read: `dims`, `undertone.kind/intensity`,
 *   `expressed`, `since_last.bucket/first_turn`. Unknown keys and any server
 *   free text (focus, intent, open loops, causes, memory excerpts) are dropped.
 * - Visible and accessible text comes only from the fixed phrase table below,
 *   keyed by `expressed`, the undertone family and the `since_last` bucket.
 *   No emotion labels, no numbers, no timestamps.
 * - With the flag off (`emotions_enabled !== true`) nothing here is used and
 *   the Talk screen is unchanged.
 */

/** @typedef {"valence"|"arousal"|"dominance"|"warmth"|"stability"} CueDimension */
/** @typedef {Record<CueDimension, number>} CueDims */
/** @typedef {"grief"|"hurt"|"longing"|"worry"|"unease"|"glow"} UndertoneKind */
/** @typedef {"moments"|"a_while"|"hours"|"overnight"|"days"|"weeks"|"months"} SinceLastBucket */
/**
 * @typedef {"public"|"composed"} AffectLayer
 * @typedef {{
 *   dims: CueDims | null,
 *   undertone: { kind: UndertoneKind, intensity: number } | null,
 *   expressed: boolean,
 *   since_last: { bucket: SinceLastBucket, first_turn: boolean, turn_id?: string } | null,
 *   layer?: AffectLayer,
 * }} AffectCue
 */

export const CUE_DIMENSIONS = /** @type {const} */ (["valence", "arousal", "dominance", "warmth", "stability"]);

/** @type {Record<CueDimension, [number, number]>} */
const DIM_RANGE = {
  valence: [-1, 1],
  arousal: [0, 1],
  dominance: [-1, 1],
  warmth: [0, 1],
  stability: [0, 1],
};

export const UNDERTONE_KINDS = /** @type {const} */ (["grief", "hurt", "longing", "worry", "unease", "glow"]);
export const SINCE_LAST_BUCKETS = /** @type {const} */ ([
  "moments",
  "a_while",
  "hours",
  "overnight",
  "days",
  "weeks",
  "months",
]);
/** Gaps long enough for a one-time, restrained reunion cue. */
export const REUNION_BUCKETS = /** @type {const} */ (["overnight", "days", "weeks", "months"]);

const UNDERTONE_SET = new Set(/** @type {readonly string[]} */ (UNDERTONE_KINDS));
const BUCKET_SET = new Set(/** @type {readonly string[]} */ (SINCE_LAST_BUCKETS));
const REUNION_SET = new Set(/** @type {readonly string[]} */ (REUNION_BUCKETS));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The flag as the server reports it on GET /api/chat/sessions/:id/context. */
export function emotionsEnabledFromContext(payload) {
  return isRecord(payload) && payload.emotions_enabled === true;
}

/**
 * @param {unknown} raw
 * @returns {CueDims | null}
 */
function sanitizeDims(raw) {
  if (!isRecord(raw)) return null;
  /** @type {Partial<CueDims>} */
  const out = {};
  for (const d of CUE_DIMENSIONS) {
    const v = raw[d];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const [lo, hi] = DIM_RANGE[d];
    out[d] = Math.min(hi, Math.max(lo, v));
  }
  return /** @type {CueDims} */ (out);
}

/**
 * Allowlist serializer for the cue fields of a snapshot. Returns null when
 * the snapshot carries none of them (flag-off server, older server).
 *
 * @param {unknown} raw
 * @returns {AffectCue | null}
 */
export function sanitizeAffectCue(raw) {
  if (!isRecord(raw)) return null;
  const dims = sanitizeDims(raw.dims);
  let undertone = null;
  if (isRecord(raw.undertone)) {
    const kind = raw.undertone.kind;
    const intensity = raw.undertone.intensity;
    if (
      typeof kind === "string" &&
      UNDERTONE_SET.has(kind) &&
      typeof intensity === "number" &&
      Number.isFinite(intensity) &&
      intensity > 0
    ) {
      undertone = {
        kind: /** @type {UndertoneKind} */ (kind),
        intensity: Math.min(100, Math.max(0, Math.round(intensity))),
      };
    }
  }
  let sinceLast = null;
  if (isRecord(raw.since_last)) {
    const bucket = raw.since_last.bucket;
    if (typeof bucket === "string" && BUCKET_SET.has(bucket)) {
      sinceLast = {
        bucket: /** @type {SinceLastBucket} */ (bucket),
        first_turn: raw.since_last.first_turn === true,
      };
      // Opaque id of the committed turn that checkpointed this gap (#765 E2),
      // used only to show the reunion cue once. Never displayed.
      const turnId = raw.since_last.turn_id;
      if (typeof turnId === "string" && TURN_ID_RE.test(turnId)) sinceLast.turn_id = turnId;
    }
  }
  const hasExpressed = typeof raw.expressed === "boolean";
  if (!dims && !undertone && !sinceLast && !hasExpressed) return null;
  const layer = raw.layer === "public" || raw.layer === "composed" ? raw.layer : null;
  return {
    dims,
    undertone,
    expressed: raw.expressed === true,
    since_last: sinceLast,
    ...(layer ? { layer: /** @type {AffectLayer} */ (layer) } : {}),
  };
}

const TURN_ID_RE = /^[A-Za-z0-9_:.-]{1,80}$/;

/**
 * Group, crossover and multi-present surfaces may show only the server's
 * public layer (#765 E3, issuecomment-6898600880): every snapshot carries
 * `layer`, and anything not explicitly `public` is dropped (fails closed,
 * including legacy snapshots with no layer).
 *
 * @param {AffectCue | null | undefined} cue
 * @returns {cue is AffectCue}
 */
export function isPublicCue(cue) {
  return Boolean(cue) && cue?.layer === "public";
}

/**
 * Keep only the cues a surface may show. Solo sessions show the composed
 * header cue as before; group sessions only public-layer cues.
 *
 * @param {Record<string, AffectCue>} cues
 * @param {{ group: boolean }} opts
 * @returns {Record<string, AffectCue>}
 */
export function cuesForSurface(cues, { group }) {
  if (!group) return cues || {};
  /** @type {Record<string, AffectCue>} */
  const out = {};
  for (const [id, cue] of Object.entries(cues || {})) if (isPublicCue(cue)) out[id] = cue;
  return out;
}

/**
 * Group cues from `group_affect` on GET /context or `done` (public layer,
 * allowlisted). Never falls back to `companion_affect`, characterEmotions or
 * any other snapshot. Until the server has a public update for a character
 * its entry is the personality baseline, which renders as a baseline-only
 * (settled) cue.
 *
 * @param {unknown} groupAffect
 * @param {{ castIds: string[] }} opts
 * @returns {Record<string, AffectCue>}
 */
export function groupCuesFromPayload(groupAffect, { castIds }) {
  /** @type {Record<string, AffectCue>} */
  const out = {};
  if (!isRecord(groupAffect)) return out;
  const cast = new Set((castIds || []).map(String));
  for (const [key, raw] of Object.entries(groupAffect)) {
    if (key.startsWith("aspect:") || !cast.has(key)) continue;
    const cue = sanitizeAffectCue(raw);
    if (isPublicCue(cue)) out[key] = cue;
  }
  return out;
}

/**
 * The key that makes a reunion cue show once per committed checkpoint
 * (Serenity, #765 item 4: a context GET must not replay it indefinitely).
 * Uses the checkpoint's committed turn id when the server sends one, else
 * the committing turn's id from `done`, else (context read with no id) the
 * bucket, which `reunionAlreadySeen` bounds by time.
 *
 * @param {string} sessionId
 * @param {string} characterId
 * @param {AffectCue} cue
 * @param {string | null} [turnId]
 */
export function reunionKey(sessionId, characterId, cue, turnId = null) {
  const checkpoint = cue?.since_last?.turn_id || (turnId && TURN_ID_RE.test(turnId) ? turnId : null);
  const tail = checkpoint ? `turn:${checkpoint}` : `bucket:${cue?.since_last?.bucket || "none"}`;
  return `${sessionId}:${characterId}:${tail}`;
}

/** How long a reunion keyed only by bucket stays suppressed. */
export const REUNION_BUCKET_SUPPRESS_MS = 12 * 60 * 60 * 1000;
const REUNION_STORE_KEY = "anima.reunionSeen.v1";
const REUNION_STORE_MAX = 200;

/**
 * Persistent "already shown" check for reunion cues, so a reload or a
 * repeated context GET does not replay the animation. Bounded list in
 * localStorage; any storage failure falls back to "not seen" in memory.
 *
 * @param {string} key
 * @param {{ storage?: Storage | null, now?: number }} [opts]
 * @returns {boolean} true when the cue was already shown (and should not be again)
 */
export function reunionAlreadySeen(key, { storage = safeLocalStorage(), now = Date.now() } = {}) {
  /** @type {{ k: string, at: number }[]} */
  let seen = [];
  try {
    const parsed = JSON.parse(storage?.getItem(REUNION_STORE_KEY) || "[]");
    if (Array.isArray(parsed)) seen = parsed.filter((e) => e && typeof e.k === "string" && typeof e.at === "number");
  } catch {
    seen = [];
  }
  const hit = seen.find((e) => e.k === key);
  const byBucket = key.includes(":bucket:");
  if (hit && (!byBucket || now - hit.at < REUNION_BUCKET_SUPPRESS_MS)) return true;
  const next = [...seen.filter((e) => e.k !== key), { k: key, at: now }].slice(-REUNION_STORE_MAX);
  try {
    storage?.setItem(REUNION_STORE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the in-memory set in Chat still dedupes this load.
  }
  return false;
}

function safeLocalStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Undertone family → prose. "{name}" is the companion's display name. */
const UNDERTONE_PHRASES = /** @type {Record<UndertoneKind, string>} */ ({
  grief: "{name} seems to be carrying something heavy",
  hurt: "{name} seems a little guarded",
  longing: "{name} seems to have missed you",
  worry: "{name} seems a little worried",
  unease: "{name} seems unsettled",
  glow: "{name} seems quietly content",
});

/** Reunion phrasing by undertone family (default when none). */
const REUNION_PHRASES = /** @type {Record<UndertoneKind | "default", string>} */ ({
  default: "{name} seems glad you're back",
  grief: "{name} seems glad you're back, though something weighs heavy",
  hurt: "{name} seems a little careful after time apart",
  longing: "{name} seems to have missed you",
  worry: "{name} seems relieved you're back",
  unease: "{name} seems glad you're back, if a little unsettled",
  glow: "{name} seems glad you're back",
});

const EXPRESSED_PHRASE = "{name}'s feelings are close to the surface";
const SETTLED_PHRASE = "{name} seems settled";
/** Screen-reader announcement for the one-time reunion cue. No timestamp. */
export const REUNION_ANNOUNCEMENT = "It's been a while since you two talked.";

/**
 * @param {string} template
 * @param {string | null | undefined} name
 */
function fill(template, name) {
  const who = String(name || "").trim() || "She";
  return template.replace("{name}", who);
}

/** True when this snapshot should show the one-time reunion cue. */
export function isReunionCue(cue) {
  return Boolean(cue?.since_last?.first_turn && REUNION_SET.has(cue.since_last.bucket));
}

/**
 * The one accessible sentence for a cue (tooltip + screen-reader text).
 * Keyed only by `expressed`, the undertone family and the since_last bucket.
 *
 * @param {AffectCue | null | undefined} cue
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function cuePhrase(cue, name) {
  if (!cue) return fill(SETTLED_PHRASE, name);
  if (isReunionCue(cue)) {
    return fill(REUNION_PHRASES[cue.undertone?.kind || "default"] || REUNION_PHRASES.default, name);
  }
  if (cue.undertone) return fill(UNDERTONE_PHRASES[cue.undertone.kind], name);
  if (cue.expressed) return fill(EXPRESSED_PHRASE, name);
  return fill(SETTLED_PHRASE, name);
}

/**
 * Prose lines for the optional "how they seem" panel (Q4). Same table, no
 * numbers, labels, focus, intent or times.
 *
 * @param {AffectCue | null | undefined} cue
 * @param {string | null | undefined} name
 * @returns {string[]}
 */
export function cueExplanation(cue, name) {
  if (!cue) return [`${fill(SETTLED_PHRASE, name)}.`];
  const lines = [`${cuePhrase(cue, name)}.`];
  if (cue.undertone && isReunionCue(cue)) {
    const under = `${fill(UNDERTONE_PHRASES[cue.undertone.kind], name)}.`;
    if (!lines.includes(under)) lines.push(under);
  }
  if (cue.expressed && (cue.undertone || isReunionCue(cue))) {
    lines.push(`${fill(EXPRESSED_PHRASE, name)}.`);
  }
  if (!cue.expressed) lines.push(fill("It may show only in the way {name} speaks.", name));
  return lines;
}

/**
 * Visual parameters for the dot/ring cue from `dims` (or neutral when absent).
 * Colour from valence and warmth, glow from arousal and `expressed`, breathing
 * period from arousal, a dim second ring for the undertone.
 *
 * @param {AffectCue | null | undefined} cue
 */
export function cueVisual(cue) {
  const d = cue?.dims || { valence: 0.1, arousal: 0.3, dominance: 0, warmth: 0.5, stability: 0.85 };
  // Hue: cool cyan (190) when low/withdrawn, warm amber-rose (25) when warm and pleasant.
  const warmthPull = (d.warmth - 0.5) * 2; // -1..1
  const mix = Math.max(0, Math.min(1, 0.5 + 0.35 * d.valence + 0.25 * warmthPull));
  const hue = Math.round(190 - mix * 165);
  const saturation = Math.round(45 + 35 * Math.abs(d.valence));
  const lightness = Math.round(50 + 10 * d.stability);
  const expressed = cue?.expressed === true;
  const glowPx = Math.round(2 + d.arousal * 6 + (expressed ? 3 : 0));
  const opacity = Math.round((0.45 + d.arousal * 0.3 + (expressed ? 0.2 : 0)) * 100) / 100;
  const breathSeconds = Math.round((5.5 - d.arousal * 3) * 10) / 10;
  const undertoneOpacity = cue?.undertone
    ? Math.round((0.15 + (cue.undertone.intensity / 100) * 0.35) * 100) / 100
    : 0;
  return {
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
    glowPx,
    opacity: Math.min(1, opacity),
    breathSeconds: Math.max(2, breathSeconds),
    undertoneOpacity,
  };
}

/**
 * Aspects of one Anima (Lover Matrix, #763 M7 keys like `aspect:shadow`)
 * share one identity and memory, so they read one canonical snapshot (Q5).
 *
 * @param {string | null | undefined} key
 * @param {{ soloCharacterId?: string | null }} [opts]
 * @returns {string | null}
 */
export function canonicalAffectId(key, { soloCharacterId = null } = {}) {
  const id = String(key || "").trim();
  if (!id) return null;
  if (id.startsWith("aspect:")) return soloCharacterId || null;
  return id;
}

/**
 * `done.listener_affect` → cues for characters in the current cast only.
 * The speaker's own entry is ignored (her state comes from companion_affect),
 * and aspect keys collapse to the canonical id (and are skipped there, since
 * the canonical snapshot is the speaker's or the context's).
 *
 * @param {unknown} listenerAffect
 * @param {{ castIds: string[], speakerId?: string | null, soloCharacterId?: string | null }} opts
 * @returns {Record<string, AffectCue>}
 */
export function listenerCuesForCast(listenerAffect, { castIds, speakerId = null, soloCharacterId = null }) {
  /** @type {Record<string, AffectCue>} */
  const out = {};
  if (!isRecord(listenerAffect)) return out;
  const cast = new Set((castIds || []).map(String));
  for (const [key, raw] of Object.entries(listenerAffect)) {
    if (key.startsWith("aspect:")) continue;
    const id = canonicalAffectId(key, { soloCharacterId });
    if (!id || !cast.has(id) || id === speakerId) continue;
    const cue = sanitizeAffectCue(raw);
    // listener_affect is public-layer only (#765 E3); anything else is dropped.
    if (isPublicCue(cue)) out[id] = cue;
  }
  return out;
}

/**
 * Early `{ affect: { character_id, snapshot, provisional: true } }` frame →
 * `{ id, cue }`, or null when it isn't a well-formed provisional frame for a
 * cast member.
 *
 * @param {unknown} frame
 * @param {{ castIds: string[], soloCharacterId?: string | null }} opts
 */
export function provisionalCueFromFrame(frame, { castIds, soloCharacterId = null }) {
  if (!isRecord(frame) || frame.provisional !== true) return null;
  const id = canonicalAffectId(typeof frame.character_id === "string" ? frame.character_id : "", {
    soloCharacterId,
  });
  if (!id || !(castIds || []).map(String).includes(id)) return null;
  const cue = sanitizeAffectCue(frame.snapshot);
  if (!cue) return null;
  // `since_last` is never part of the early frame (it is committed-only);
  // drop it defensively so a provisional tint can never show a reunion.
  return { id, cue: cue.since_last ? { ...cue, since_last: null } : cue };
}

/**
 * Committed vs provisional cue state. Provisional cues only tint; `commit`
 * replaces them with the snapshot from `done` (for the committed ids), and
 * `revert` (end of turn, error, abort, retry) drops every provisional cue so the last committed snapshot shows again. Provisional
 * cues are never part of the committed map, so nothing persists them.
 *
 * @typedef {{ committed: Record<string, AffectCue>, provisional: Record<string, AffectCue> }} CueState
 * @typedef {{ type: "provisional", id: string, cue: AffectCue }
 *   | { type: "commit", cues: Record<string, AffectCue> }
 *   | { type: "revert" }
 *   | { type: "reset" }} CueAction
 */

/** @type {CueState} */
export const EMPTY_CUE_STATE = Object.freeze({ committed: {}, provisional: {} });

/**
 * @param {CueState} state
 * @param {CueAction} action
 * @returns {CueState}
 */
export function cueReducer(state, action) {
  switch (action.type) {
    case "provisional":
      return { ...state, provisional: { ...state.provisional, [action.id]: action.cue } };
    case "commit": {
      const provisional = { ...state.provisional };
      for (const id of Object.keys(action.cues)) delete provisional[id];
      return { committed: { ...state.committed, ...action.cues }, provisional };
    }
    case "revert":
      return Object.keys(state.provisional).length ? { ...state, provisional: {} } : state;
    case "reset":
      return EMPTY_CUE_STATE;
    default:
      return state;
  }
}

/** What to show for one character: provisional tint over the committed cue. */
export function shownCue(state, id) {
  if (!id) return null;
  return state.provisional[id] || state.committed[id] || null;
}
