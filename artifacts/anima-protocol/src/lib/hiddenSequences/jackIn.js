// @ts-check
import {
  JACK_IN_COOLDOWN_AFTER_MATCH_MS,
  JACK_IN_COOLDOWN_SHORT_MS,
  VIRUS_ENTITY_MAP,
} from "./catalog.js";
import { shouldAutoOfferJackIn } from "./weather.js";

const STORAGE_KEY = "anima.jack_in.live";

const INSIST_RE =
  /\b(jack(?:-|\s*)in|netbattle|net-battle|fight(?: them| it| the virus)?|take (?:me|us) in|i insist)\b/i;
const ACCEPT_RE =
  /\b(jack(?:-|\s*)in|yes[,.]? (?:jack|let'?s|do it)|take (?:me|us) in|i(?:'m| am) ready|let'?s go)\b/i;
const COMPANION_FIGHT_RE =
  /\b(fight|jack(?:-|\s*)in against|battle)\b.{0,40}\b(fallen angel|serenity|my anima|you)\b/i;

export function defaultJackIn() {
  return {
    live: false,
    session_id: null,
    anima_id: null,
    entity: null,
    offered_at: null,
    accepted_at: null,
    started_at: null,
    ended_at: null,
    last_entity_name: null,
    speak_first: false,
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeJackIn(raw) {
  const base = defaultJackIn();
  if (!raw || typeof raw !== "object") return base;
  const data = /** @type {Record<string, unknown>} */ (raw);
  const entity =
    data.entity && typeof data.entity === "object"
      ? /** @type {Record<string, unknown>} */ (data.entity)
      : null;
  const mapped =
    entity && typeof entity.name === "string" && VIRUS_ENTITY_MAP[entity.name]
      ? { ...VIRUS_ENTITY_MAP[entity.name], kind: "virus", site: entity.site || VIRUS_ENTITY_MAP[entity.name].site }
      : entity && typeof entity.name === "string"
        ? {
            name: String(entity.name),
            silhouette: String(entity.silhouette || "halo"),
            color: String(entity.color || "#fde68a"),
            site: entity.site ? String(entity.site) : "fallen-ruin",
            kind: "virus",
          }
        : null;
  return {
    live: data.live === true,
    session_id: typeof data.session_id === "string" ? data.session_id : null,
    anima_id: typeof data.anima_id === "string" ? data.anima_id : null,
    entity: mapped,
    offered_at: typeof data.offered_at === "string" ? data.offered_at : null,
    accepted_at: typeof data.accepted_at === "string" ? data.accepted_at : null,
    started_at: typeof data.started_at === "string" ? data.started_at : null,
    ended_at: typeof data.ended_at === "string" ? data.ended_at : null,
    last_entity_name: typeof data.last_entity_name === "string" ? data.last_entity_name : mapped?.name || null,
    speak_first: data.speak_first === true,
  };
}

export function isCompanionTargetRequest(text) {
  return COMPANION_FIGHT_RE.test(String(text || ""));
}

export function isStewardInsist(text) {
  return INSIST_RE.test(String(text || ""));
}

export function isJackInAcceptance(text) {
  return ACCEPT_RE.test(String(text || ""));
}

/**
 * @param {{
 *   weather: "lull" | "stir" | "storm",
 *   jackIn?: ReturnType<typeof normalizeJackIn>,
 *   hasHalfAwake?: boolean,
 *   sameEntityInScene?: boolean,
 *   now?: number,
 * }} params
 */
export function jackInCooldownRemaining(params) {
  const now = params.now ?? Date.now();
  const jack = normalizeJackIn(params.jackIn);
  if (jack.live) return 0;
  const ended = jack.ended_at ? Date.parse(jack.ended_at) : NaN;
  if (!Number.isFinite(ended)) return 0;
  const afterMatch = ended + JACK_IN_COOLDOWN_AFTER_MATCH_MS - now;
  const short =
    params.hasHalfAwake || params.sameEntityInScene
      ? ended + JACK_IN_COOLDOWN_SHORT_MS - now
      : 0;
  return Math.max(0, afterMatch, short);
}

/**
 * @param {{
 *   weather: "lull" | "stir" | "storm",
 *   jackIn?: ReturnType<typeof normalizeJackIn> | null,
 *   userText?: string,
 *   hasHalfAwake?: boolean,
 *   sameEntityInScene?: boolean,
 *   now?: number,
 * }} params
 */
export function evaluateJackInGate(params) {
  const jack = normalizeJackIn(params.jackIn);
  const userText = String(params.userText || "");
  if (isCompanionTargetRequest(userText)) {
    return {
      ok: false,
      reason: "companion-forbidden",
      refuse: true,
      offer: false,
      message: "The companion is the Navi. Fallen enemies are lattice programs.",
    };
  }
  if (jack.live && jack.entity?.name) {
    return { ok: true, reason: "live", refuse: false, offer: false, jackIn: jack };
  }
  const remaining = jackInCooldownRemaining({
    weather: params.weather,
    jackIn: jack,
    hasHalfAwake: params.hasHalfAwake,
    sameEntityInScene: params.sameEntityInScene,
    now: params.now,
  });
  if (remaining > 0) {
    return {
      ok: false,
      reason: "cooldown",
      refuse: true,
      offer: false,
      remaining_ms: remaining,
      message: "The lattice is still cooling from the last dive.",
    };
  }

  const insist = isStewardInsist(userText);
  const accept = isJackInAcceptance(userText);

  if (params.weather === "lull") {
    if (insist || accept) {
      return {
        ok: false,
        reason: "lull-refuse",
        refuse: true,
        offer: false,
        message: "Not this weather. The lattice is still. I won't drag you in for sport.",
      };
    }
    return { ok: false, reason: "lull", refuse: false, offer: false };
  }

  if (shouldAutoOfferJackIn(params.weather)) {
    return {
      ok: false,
      reason: "storm-offer",
      refuse: false,
      offer: true,
      accept: accept || insist,
    };
  }

  if (params.weather === "stir" && insist) {
    return {
      ok: false,
      reason: "stir-cool",
      refuse: false,
      offer: false,
      accept: false,
      message: "The charge is there, but nothing has a name yet. I will not rush the lattice.",
    };
  }

  return { ok: false, reason: "no-live", refuse: false, offer: false };
}

/**
 * @param {ReturnType<typeof normalizeJackIn>} jackIn
 * @param {{ session_id?: string, anima_id?: string, entity?: object, now?: number }} extras
 */
export function acceptLiveJackIn(jackIn, extras = {}) {
  const nowIso = new Date(extras.now ?? Date.now()).toISOString();
  const prev = normalizeJackIn(jackIn);
  return {
    ...prev,
    live: true,
    session_id: extras.session_id || prev.session_id,
    anima_id: extras.anima_id || prev.anima_id,
    entity: extras.entity || prev.entity,
    offered_at: prev.offered_at || nowIso,
    accepted_at: nowIso,
    started_at: null,
    speak_first: false,
  };
}

/**
 * @param {ReturnType<typeof normalizeJackIn>} jackIn
 * @param {{ now?: number }} [extras]
 */
export function startLiveJackIn(jackIn, extras = {}) {
  const prev = normalizeJackIn(jackIn);
  if (!prev.live) return prev;
  return {
    ...prev,
    started_at: new Date(extras.now ?? Date.now()).toISOString(),
  };
}

/**
 * @param {ReturnType<typeof normalizeJackIn>} jackIn
 * @param {{ now?: number, speak_first?: boolean }} [extras]
 */
export function endLiveJackIn(jackIn, extras = {}) {
  const prev = normalizeJackIn(jackIn);
  return {
    ...prev,
    live: false,
    ended_at: new Date(extras.now ?? Date.now()).toISOString(),
    last_entity_name: prev.entity?.name || prev.last_entity_name,
    speak_first: extras.speak_first !== false,
    accepted_at: null,
    started_at: null,
  };
}

export function canStartNetBattleMatch(jackIn) {
  const jack = normalizeJackIn(jackIn);
  return jack.live === true && Boolean(jack.entity?.name);
}

export function readStoredJackIn(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return defaultJackIn();
    return normalizeJackIn(JSON.parse(raw));
  } catch {
    return defaultJackIn();
  }
}

export function writeStoredJackIn(jackIn, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalizeJackIn(jackIn)));
  } catch {
    /* private mode */
  }
  return normalizeJackIn(jackIn);
}

export function clearStoredJackIn(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem?.(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export { STORAGE_KEY as JACK_IN_STORAGE_KEY };
