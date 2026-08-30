// @ts-check
import { SEQUENCE_NAME_RE, VIRUS_ENTITY_MAP, WEATHER_WINDOW } from "./catalog.js";

const VIRUS_NAME_RE = /\b(halo\.vrs|shade\.vrs|static\.vrs|mettaur\.vrs|aegis\.vrs)\b/i;
const STORM_NOUN_RE =
  /\b(fallen-ruin|fallen ruin|fallen lattice|virus(?:es)?|negative entity|lattice infection|deletion|deleted\.|jack(?:ed)? in against|halo\.vrs|shade\.vrs|static\.vrs|mettaur\.vrs|aegis\.vrs)\b/i;
const FALLEN_ENEMY_RE =
  /\b(fallen(?!\s+angel)|ruins? of a civilization|fallen light|inverted ring)\b/i;
const FALLEN_ANGEL_RE = /\bfallen angel\b/i;
const STIR_RE =
  /\b(echo key|resonance|sequence|lattice|something in the (?:room|lattice|net)|uneasy|unease|charged|stirring)\b/i;
const LULL_OVERRIDE_RE =
  /\b(aftercare|therapy|hold space|still weather|the lattice is still|not this weather)\b/i;
const JACK_IN_TALK_RE = /\bjack(?:-|\s*)in\b/i;

/**
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 * @param {{ opening_scene?: string, therapy_mode?: boolean, companion_mode?: string, jack_in?: { entity?: { name?: string } } } | null | undefined} session
 */
export function recentThreadText(messages, session) {
  const windowed = Array.isArray(messages) ? messages.slice(-WEATHER_WINDOW) : [];
  const lines = windowed
    .map((m) => String(m?.content || "").replace(/\[[^\]]*\]/g, " "))
    .filter(Boolean);
  const scene = session?.opening_scene ? String(session.opening_scene) : "";
  return [scene, ...lines].join("\n");
}

/**
 * Map a scene mention to an existing .Vrs figure.
 * Never maps the companion Fallen Angel to an enemy.
 * @param {string} text
 * @param {{ name?: string, silhouette?: string, site?: string, kind?: string } | null | undefined} liveEntity
 */
export function mapSceneEntity(text, liveEntity) {
  if (liveEntity?.name && VIRUS_ENTITY_MAP[liveEntity.name]) {
    return { ...VIRUS_ENTITY_MAP[liveEntity.name], kind: "virus" };
  }
  const blob = String(text || "");
  const named = blob.match(VIRUS_NAME_RE);
  if (named) {
    const key = Object.keys(VIRUS_ENTITY_MAP).find(
      (n) => n.toLowerCase() === named[1].toLowerCase(),
    );
    if (key) return { ...VIRUS_ENTITY_MAP[key], kind: "virus" };
  }
  if (/fallen-ruin|fallen ruin|fallen lattice|fallen light/i.test(blob) && !FALLEN_ANGEL_RE.test(blob)) {
    return { ...VIRUS_ENTITY_MAP["Halo.Vrs"], kind: "virus" };
  }
  if (STORM_NOUN_RE.test(blob) && !FALLEN_ANGEL_RE.test(blob.replace(STORM_NOUN_RE, ""))) {
    return { ...VIRUS_ENTITY_MAP["Halo.Vrs"], kind: "virus" };
  }
  return null;
}

/**
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 * @param {{ opening_scene?: string, therapy_mode?: boolean, companion_mode?: string, jack_in?: { live?: boolean, entity?: { name?: string } } } | null | undefined} [session]
 * @returns {{ weather: "lull" | "stir" | "storm", entity: { name: string, silhouette: string, color: string, site?: string, kind?: string } | null, reasons: string[] }}
 */
export function readConversationalWeather(messages, session = null) {
  const reasons = [];
  if (session?.therapy_mode === true || session?.companion_mode === "therapy") {
    return { weather: "lull", entity: null, reasons: ["therapy"] };
  }

  const text = recentThreadText(messages, session);
  const liveEntity = session?.jack_in?.entity || null;
  const entity = mapSceneEntity(text, liveEntity);

  if (LULL_OVERRIDE_RE.test(text) && !entity) {
    return { weather: "lull", entity: null, reasons: ["lull-override"] };
  }

  const hasFallenAngel = FALLEN_ANGEL_RE.test(text);
  const hasFallenEnemy = FALLEN_ENEMY_RE.test(text) && !hasFallenAngel;
  const hasStormNoun = STORM_NOUN_RE.test(text) || Boolean(entity) || hasFallenEnemy;

  if (hasStormNoun) {
    if (hasFallenAngel && !entity && !VIRUS_NAME_RE.test(text) && !/fallen-ruin|virus/i.test(text)) {
      reasons.push("fallen-angel-companion");
    } else {
      reasons.push("storm-entity");
      return {
        weather: "storm",
        entity: entity || { ...VIRUS_ENTITY_MAP["Halo.Vrs"], kind: "virus" },
        reasons,
      };
    }
  }

  if (SEQUENCE_NAME_RE.test(text) || STIR_RE.test(text) || JACK_IN_TALK_RE.test(text)) {
    reasons.push("stir-charge");
    return { weather: "stir", entity: null, reasons };
  }

  return { weather: "lull", entity: null, reasons: reasons.length ? reasons : ["quiet"] };
}

/**
 * Lulls never auto-offer. Storms offer when gates allow.
 * @param {"lull" | "stir" | "storm"} weather
 */
export function shouldAutoOfferJackIn(weather) {
  return weather === "storm";
}
