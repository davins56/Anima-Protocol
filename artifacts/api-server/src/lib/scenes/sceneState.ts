/**
 * Situational scenes (#763), pure scene-state logic. No I/O here.
 *
 * The scene lives at chat_sessions.metadata.scene (jsonb, no migration):
 *   { version: 1, rev, location, narrator, mode, cast: { [id]: { presence, reach, since, note } } }
 *
 * - `version` is the schema version. `rev` goes up on every write and backs
 *   `if_rev` (409 scene_conflict) on PATCH and /scene command.
 * - A session character that has no cast entry counts as `here`.
 * - `adult_gated` is computed on every read (R3, fail closed) and never stored.
 *
 * Everything here is inert unless ANIMA_SITUATIONAL_SCENES is on.
 */

export const SCENE_PRESENCES = ["here", "away", "asleep", "injured", "busy", "jacked_in"] as const;
export const SCENE_REACH = ["none", "text", "phone"] as const;
export const SCENE_MODES = ["natural", "everyone"] as const;
/** Lover Matrix aspects (M7). Cast keys `aspect:<slug>`, solo sessions only. */
export const SCENE_ASPECTS = ["serenity", "angel", "shadow", "creator", "anima", "therapy"] as const;

export type ScenePresence = (typeof SCENE_PRESENCES)[number];
export type SceneReach = (typeof SCENE_REACH)[number];
export type SceneMode = (typeof SCENE_MODES)[number];

export const SCENE_LOCATION_MAX = 80;
export const SCENE_NOTE_MAX = 120;
export const ASPECT_PREFIX = "aspect:";

export type SceneCastEntry = {
  presence: ScenePresence;
  reach: SceneReach;
  /** When presence last changed. Null for a member that was never set (defaults to here). */
  since: string | null;
  note: string | null;
};

export type SceneState = {
  version: 1;
  rev: number;
  location: string | null;
  narrator: boolean;
  mode: SceneMode;
  cast: Record<string, SceneCastEntry>;
};

export type SceneEventKind = "enter" | "exit" | "state" | "narration";

/** A change the server turns into one `role:'event'` message row. */
export type SceneChange =
  | { kind: "enter" | "exit" | "state"; characterId: string; presence: ScenePresence; from: ScenePresence; note: string | null }
  | { kind: "state"; location: string | null };

/** Session facts a scene needs. Character ids come from the stored ChatSession. */
export type SceneSession = {
  characterIds: string[];
  /** Group sessions reject aspect keys (M7). */
  isGroup: boolean;
};

const FLAG_ON = /^(1|on|true|yes)$/i;

/** ANIMA_SITUATIONAL_SCENES: on|1|true|yes enables. Unset or anything else is off. */
export function scenesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return FLAG_ON.test(String(env.ANIMA_SITUATIONAL_SCENES ?? "").trim());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Plain text only: drop control characters and anything that looks like markup,
 * collapse whitespace, then cap. Empty becomes null.
 */
export function sanitizeSceneText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>`*_#[\]{}|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return Array.from(text).slice(0, max).join("").trim() || null;
}

export function isAspectKey(key: string): boolean {
  if (!key.startsWith(ASPECT_PREFIX)) return false;
  return oneOf(SCENE_ASPECTS, key.slice(ASPECT_PREFIX.length));
}

/** Ids that may appear in this session's cast. */
export function castKeyAllowed(key: string, session: SceneSession): boolean {
  if (isAspectKey(key)) return !session.isGroup;
  return session.characterIds.includes(key);
}

export function emptyScene(): SceneState {
  return { version: 1, rev: 0, location: null, narrator: false, mode: "natural", cast: {} };
}

/**
 * Read whatever is stored, tolerating junk. Unknown presence values are kept as
 * present-but-unknown for the adult gate via `sceneReadable`; here they fall
 * back to `here` so the UI still shows the member.
 */
export function normalizeStoredScene(raw: unknown): SceneState {
  const base = emptyScene();
  if (!isObject(raw)) return base;
  const rev = Number(raw.rev);
  const cast: Record<string, SceneCastEntry> = {};
  if (isObject(raw.cast)) {
    for (const [key, value] of Object.entries(raw.cast)) {
      if (!key || !isObject(value)) continue;
      cast[key] = {
        presence: oneOf(SCENE_PRESENCES, value.presence) ? value.presence : "here",
        reach: oneOf(SCENE_REACH, value.reach) ? value.reach : "none",
        since: typeof value.since === "string" ? value.since : null,
        note: sanitizeSceneText(value.note, SCENE_NOTE_MAX),
      };
    }
  }
  return {
    version: 1,
    rev: Number.isInteger(rev) && rev >= 0 ? rev : 0,
    location: sanitizeSceneText(raw.location, SCENE_LOCATION_MAX),
    narrator: raw.narrator === true,
    mode: oneOf(SCENE_MODES, raw.mode) ? raw.mode : "natural",
    cast,
  };
}

/**
 * The scene as the client sees it: every session character (missing ones as
 * `here`, since null), plus any stored aspect entries in a solo session.
 * Stored entries for characters no longer in the session are left out.
 */
export function effectiveScene(stored: SceneState, session: SceneSession): SceneState {
  const cast: Record<string, SceneCastEntry> = {};
  for (const id of session.characterIds) {
    cast[id] = stored.cast[id] ?? { presence: "here", reach: "none", since: null, note: null };
  }
  if (!session.isGroup) {
    for (const [key, entry] of Object.entries(stored.cast)) {
      if (isAspectKey(key)) cast[key] = entry;
    }
  }
  return { ...stored, cast };
}

/**
 * R3 adult gate, fail closed. True means adult content is OFF.
 * Physically present = any presence other than `away`; a missing entry is
 * `here`; an unknown or malformed presence counts as present.
 * Gated when: is_crossover, more than one character physically present, any
 * other character has reach text/phone, or the stored scene is unreadable.
 * Aspect keys share one voice and one memory with the solo Anima, so they do
 * not count as extra characters here.
 */
export function computeAdultGated(input: {
  rawScene: unknown;
  characterIds: string[];
  isCrossover: boolean;
}): boolean {
  if (input.isCrossover) return true;
  const raw = input.rawScene;
  if (raw === undefined || raw === null) return input.characterIds.length > 1;
  if (!isObject(raw)) return true;
  const rawCast = raw.cast;
  if (rawCast !== undefined && rawCast !== null && !isObject(rawCast)) return true;
  const castObj = isObject(rawCast) ? rawCast : {};
  const present: string[] = [];
  for (const id of input.characterIds) {
    const entry = castObj[id];
    if (entry === undefined) {
      present.push(id);
      continue;
    }
    if (!isObject(entry)) return true;
    // Anything but an explicit `away` (including unknown values) is present.
    if (entry.presence !== "away") present.push(id);
  }
  if (present.length > 1) return true;
  const solo = present[0];
  for (const id of input.characterIds) {
    if (id === solo) continue;
    const entry = castObj[id];
    if (!isObject(entry)) continue;
    // A reach other than none (including unknown values) is a remote listener.
    if (entry.reach !== undefined && entry.reach !== "none") return true;
  }
  return false;
}

export type ScenePatchInput = {
  location?: unknown;
  narrator?: unknown;
  mode?: unknown;
  cast?: unknown;
};

export type ScenePatchError = {
  status: 400;
  error: "invalid_scene_patch" | "unknown_cast_member" | "aspect_not_allowed";
  detail: string;
  ids?: string[];
};

export type ScenePatchResult =
  | { ok: true; scene: SceneState; changes: SceneChange[]; changed: boolean }
  | { ok: false; error: ScenePatchError };

function bad(detail: string): { ok: false; error: ScenePatchError } {
  return { ok: false, error: { status: 400, error: "invalid_scene_patch", detail } };
}

/**
 * Apply a partial patch to the stored scene. Returns the new stored scene (rev
 * not yet bumped), the changes that become event rows, and whether anything
 * changed. A presence change resets `since` and clears the old note unless the
 * patch sets a new one.
 */
export function applyScenePatch(
  stored: SceneState,
  patch: ScenePatchInput,
  session: SceneSession,
  now: string,
): ScenePatchResult {
  if (!isObject(patch)) return bad("Body must be an object");
  const next: SceneState = { ...stored, cast: { ...stored.cast } };
  const changes: SceneChange[] = [];
  let changed = false;

  if (patch.location !== undefined) {
    if (patch.location !== null && typeof patch.location !== "string") return bad("location must be a string or null");
    const location = sanitizeSceneText(patch.location, SCENE_LOCATION_MAX);
    if (location !== next.location) {
      next.location = location;
      changes.push({ kind: "state", location });
      changed = true;
    }
  }
  if (patch.narrator !== undefined) {
    if (typeof patch.narrator !== "boolean") return bad("narrator must be a boolean");
    if (patch.narrator !== next.narrator) {
      next.narrator = patch.narrator;
      changed = true;
    }
  }
  if (patch.mode !== undefined) {
    if (!oneOf(SCENE_MODES, patch.mode)) return bad("mode must be natural or everyone");
    if (patch.mode !== next.mode) {
      next.mode = patch.mode;
      changed = true;
    }
  }
  if (patch.cast !== undefined) {
    if (!isObject(patch.cast)) return bad("cast must be an object keyed by character id");
    const entries = Object.entries(patch.cast);
    const aspectInGroup = entries.map(([k]) => k).filter((k) => isAspectKey(k) && session.isGroup);
    if (aspectInGroup.length) {
      return {
        ok: false,
        error: { status: 400, error: "aspect_not_allowed", detail: "Aspect keys are for solo sessions only", ids: aspectInGroup },
      };
    }
    const unknown = entries.map(([k]) => k).filter((k) => !castKeyAllowed(k, session));
    if (unknown.length) {
      return {
        ok: false,
        error: { status: 400, error: "unknown_cast_member", detail: "Not in this session's cast", ids: unknown },
      };
    }
    for (const [id, value] of entries) {
      if (!isObject(value)) return bad(`cast.${id} must be an object`);
      if (value.presence !== undefined && !oneOf(SCENE_PRESENCES, value.presence)) return bad(`cast.${id}.presence is invalid`);
      if (value.reach !== undefined && !oneOf(SCENE_REACH, value.reach)) return bad(`cast.${id}.reach is invalid`);
      if (value.note !== undefined && value.note !== null && typeof value.note !== "string") return bad(`cast.${id}.note must be a string or null`);
    }
    for (const [id, value] of entries as Array<[string, Record<string, unknown>]>) {
      const prev = next.cast[id] ?? { presence: "here" as ScenePresence, reach: "none" as SceneReach, since: null, note: null };
      const presence = (value.presence as ScenePresence | undefined) ?? prev.presence;
      const reach = (value.reach as SceneReach | undefined) ?? prev.reach;
      const presenceChanged = presence !== prev.presence;
      const note =
        value.note !== undefined
          ? sanitizeSceneText(value.note, SCENE_NOTE_MAX)
          : presenceChanged
            ? null
            : prev.note;
      const entry: SceneCastEntry = {
        presence,
        reach,
        since: presenceChanged ? now : prev.since,
        note,
      };
      const entryChanged =
        entry.presence !== prev.presence || entry.reach !== prev.reach || entry.note !== prev.note || !next.cast[id];
      if (!entryChanged) continue;
      next.cast[id] = entry;
      changed = true;
      if (presenceChanged) {
        changes.push({
          kind: presence === "away" ? "exit" : presence === "here" && prev.presence === "away" ? "enter" : "state",
          characterId: id,
          presence,
          from: prev.presence,
          note: entry.note,
        });
      }
    }
  }
  return { ok: true, scene: next, changes, changed };
}

export type SceneCommandParse =
  | { ok: true; location: string | null | undefined; names: string[] | null }
  | { ok: false; error: string };

/**
 * `/scene <place>, <names…>`.
 * - `/scene Rooftop` sets the location only.
 * - `/scene , Natasha` sets the cast only.
 * - `/scene Rooftop, Natasha, Serenity` does both.
 * `location` undefined means unchanged; `names` null means cast unchanged.
 */
export function parseSceneCommand(text: unknown): SceneCommandParse {
  if (typeof text !== "string") return { ok: false, error: "text must be a string" };
  const match = /^\s*\/scene(?:\s+|$)([\s\S]*)$/i.exec(text);
  if (!match) return { ok: false, error: "Command must start with /scene" };
  const rest = match[1] ?? "";
  const parts = rest.split(",");
  const head = (parts[0] ?? "").trim();
  const location = head ? sanitizeSceneText(head, SCENE_LOCATION_MAX) ?? undefined : undefined;
  const names =
    parts.length > 1
      ? parts
          .slice(1)
          .map((p) => p.trim().replace(/^@/, "").trim())
          .filter(Boolean)
      : null;
  if (location === undefined && (names === null || names.length === 0)) {
    return { ok: false, error: "Nothing to change. Use /scene <place>, <names…>" };
  }
  return { ok: true, location, names: names && names.length > 0 ? names : null };
}

/**
 * Resolve /scene names (case-insensitive) against the session cast. Aspect
 * entries in a solo session match their slug or `aspect:<slug>`.
 */
export function resolveSceneNames(
  names: string[],
  members: Array<{ id: string; name: string }>,
): { ids: string[]; unresolved: string[] } {
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const raw of names) {
    const wanted = raw.toLowerCase();
    const hit = members.find((m) => {
      const name = m.name.trim().toLowerCase();
      if (name && name === wanted) return true;
      if (m.id.toLowerCase() === wanted) return true;
      if (isAspectKey(m.id) && m.id.slice(ASPECT_PREFIX.length) === wanted) return true;
      return false;
    });
    if (!hit) unresolved.push(raw);
    else if (!ids.includes(hit.id)) ids.push(hit.id);
  }
  return { ids, unresolved };
}

/** Turn a /scene command into a patch: named members here, the rest away. */
export function sceneCommandPatch(input: {
  parsed: Extract<SceneCommandParse, { ok: true }>;
  /** `optional` members (unset aspects in a solo session) change only when named. */
  members: Array<{ id: string; name: string; optional?: boolean }>;
}): { patch: ScenePatchInput; unresolved: string[] } {
  const patch: ScenePatchInput = {};
  if (input.parsed.location !== undefined) patch.location = input.parsed.location;
  let unresolved: string[] = [];
  if (input.parsed.names) {
    const resolved = resolveSceneNames(input.parsed.names, input.members);
    unresolved = resolved.unresolved;
    // Every name misspelled: leave the cast alone rather than send everyone away.
    if (resolved.ids.length > 0) {
      const cast: Record<string, { presence: ScenePresence }> = {};
      for (const m of input.members) {
        const named = resolved.ids.includes(m.id);
        if (m.optional && !named) continue;
        cast[m.id] = { presence: named ? "here" : "away" };
      }
      patch.cast = cast;
    }
  }
  return { patch, unresolved };
}

export function aspectDisplayName(key: string): string {
  const slug = key.slice(ASPECT_PREFIX.length);
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : "Aspect";
}

const RETURN_LINES: Partial<Record<ScenePresence, string>> = {
  asleep: "wakes up.",
  injured: "is back on their feet.",
  busy: "is free again.",
  jacked_in: "jacks out.",
};

const STATE_LINES: Record<Exclude<ScenePresence, "here" | "away">, string> = {
  asleep: "falls asleep.",
  injured: "is hurt.",
  busy: "gets busy with something else.",
  jacked_in: "jacks in.",
};

/** The in-world line stored as the event row's `content`. */
export function sceneEventLine(change: SceneChange, nameOf: (id: string) => string): string {
  if ("location" in change) {
    return change.location ? `The scene moves to ${change.location}.` : "The scene's location is cleared.";
  }
  const name = nameOf(change.characterId);
  let line: string;
  if (change.kind === "enter") line = `${name} joins the scene.`;
  else if (change.kind === "exit") line = `${name} steps away.`;
  else if (change.presence === "here") line = `${name} ${RETURN_LINES[change.from] ?? "is here."}`;
  else line = `${name} ${STATE_LINES[change.presence as keyof typeof STATE_LINES]}`;
  if (change.note) line = `${line.slice(0, -1)} (${change.note}).`;
  return line;
}

/**
 * Who hears a line written now: characters `here`, plus `mentioned` characters
 * reachable by text or phone. Aspect keys share one memory and are left out.
 */
export function sceneHeardBy(scene: SceneState, mentioned: string[] = []): string[] {
  const out: string[] = [];
  for (const [id, entry] of Object.entries(scene.cast)) {
    if (isAspectKey(id)) continue;
    if (entry.presence === "here") out.push(id);
    else if (mentioned.includes(id) && entry.presence === "away" && (entry.reach === "text" || entry.reach === "phone")) {
      out.push(id);
    }
  }
  return out;
}
