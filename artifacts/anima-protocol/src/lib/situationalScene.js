// @ts-check
/**
 * Front-end half of #763 (situational scenes, ANIMA_SITUATIONAL_SCENES).
 *
 * The server owns scene state, awareness (`heard_by`), eligibility, the
 * response plan and the adult gate. This module only reads what the server
 * sends and shapes it for the Talk screen:
 *
 * - `scenes_enabled` on `GET /chat/sessions/:id/context` is the discovery
 *   signal. A 409 `scenes_disabled` (or a 404 while the routes are not
 *   deployed) is authoritative "feature off": every scene control hides and
 *   today's behaviour is unchanged.
 * - `heard_by` is read from the server-stamped row only and never recomputed
 *   from the cast. A missing `heard_by` (legacy) and `heard_by: []` (nobody)
 *   are different states.
 * - `adult_gated` is read from the server and never inferred from the cast.
 * - `blocked` and `next_speaker` come only from `scene_plan` / `done`.
 */

export const PRESENCE_STATES = /** @type {const} */ (["here", "away", "asleep", "injured", "busy", "jacked_in"]);
export const REACH_VALUES = /** @type {const} */ (["none", "text", "phone"]);
export const SCENE_MODES = /** @type {const} */ (["natural", "everyone"]);
export const SCENE_EVENT_KINDS = /** @type {const} */ (["enter", "exit", "state", "narration"]);
/** Lover Matrix aspect keys the server accepts in a solo session (M7). */
export const ASPECT_CAST_SLUGS = /** @type {const} */ (["serenity", "angel", "shadow", "creator", "anima", "therapy"]);

/** @typedef {typeof PRESENCE_STATES[number]} Presence */
/** @typedef {typeof REACH_VALUES[number]} Reach */
/** @typedef {typeof SCENE_MODES[number]} SceneMode */
/**
 * @typedef {{ presence: Presence, reach: Reach, since: string | null, note: string | null }} CastEntry
 * @typedef {{
 *   version: number,
 *   rev: number | null,
 *   location: string | null,
 *   narrator: boolean,
 *   mode: SceneMode,
 *   cast: Record<string, CastEntry>,
 *   adult_gated: boolean | null,
 * }} Scene
 */

/** Glyph and label per presence (B1). */
export const PRESENCE_META = Object.freeze({
  here: { glyph: "●", label: "here", verb: "is here" },
  away: { glyph: "↗", label: "away", verb: "is away" },
  asleep: { glyph: "☾", label: "asleep", verb: "is asleep" },
  injured: { glyph: "✚", label: "injured", verb: "is injured" },
  busy: { glyph: "⏳", label: "busy", verb: "is busy" },
  jacked_in: { glyph: "⌁", label: "jacked in", verb: "is jacked in" },
});

export const REACH_META = Object.freeze({
  none: { glyph: "", label: "no reach" },
  text: { glyph: "✉", label: "reachable by text" },
  phone: { glyph: "☎", label: "reachable by phone" },
});

/** Client-side display caps (the server clamps too: location 80, note 120). */
export const LOCATION_MAX = 80;
export const NOTE_MAX = 120;

const PRESENCE_SET = new Set(/** @type {readonly string[]} */ (PRESENCE_STATES));
const REACH_SET = new Set(/** @type {readonly string[]} */ (REACH_VALUES));
const MODE_SET = new Set(/** @type {readonly string[]} */ (SCENE_MODES));
const KIND_SET = new Set(/** @type {readonly string[]} */ (SCENE_EVENT_KINDS));
const ASPECT_SET = new Set(/** @type {readonly string[]} */ (ASPECT_CAST_SLUGS));

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Plain, single-line text with a length cap. Display only.
 * @param {unknown} value
 * @param {number} max
 */
export function plainSceneText(value, max) {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * `scenes_enabled: true` on the session context means the flag is on for
 * this session. Anything else is off.
 * @param {unknown} payload
 */
export function scenesEnabledFromContext(payload) {
  return isRecord(payload) && payload.scenes_enabled === true;
}

/**
 * Sanitize a server scene. Returns null for anything unreadable.
 * `adult_gated` is copied only when the server sent a boolean.
 * @param {unknown} raw
 * @returns {Scene | null}
 */
export function normalizeScene(raw) {
  const src = isRecord(raw) && isRecord(raw.scene) ? raw.scene : raw;
  if (!isRecord(src)) return null;
  /** @type {Record<string, CastEntry>} */
  const cast = {};
  if (isRecord(src.cast)) {
    for (const [id, entry] of Object.entries(src.cast)) {
      if (!id || !isRecord(entry)) continue;
      const presence = PRESENCE_SET.has(entry.presence) ? /** @type {Presence} */ (entry.presence) : null;
      if (!presence) continue;
      cast[id] = {
        presence,
        reach: REACH_SET.has(entry.reach) ? /** @type {Reach} */ (entry.reach) : "none",
        since: typeof entry.since === "string" ? entry.since : null,
        note: plainSceneText(entry.note, NOTE_MAX),
      };
    }
  }
  const rev = Number.isSafeInteger(src.rev) ? Number(src.rev) : null;
  const gate =
    typeof src.adult_gated === "boolean"
      ? src.adult_gated
      : isRecord(raw) && typeof raw.adult_gated === "boolean"
        ? raw.adult_gated
        : null;
  return {
    version: Number.isSafeInteger(src.version) ? Number(src.version) : 1,
    rev,
    location: plainSceneText(src.location, LOCATION_MAX),
    narrator: src.narrator === true,
    mode: MODE_SET.has(src.mode) ? /** @type {SceneMode} */ (src.mode) : "natural",
    cast,
    adult_gated: gate,
  };
}

/**
 * @param {any} err
 * @param {string} code
 */
function errorCodeIs(err, code) {
  if (!err) return false;
  return (
    err.code === code ||
    err.payload?.error === code ||
    err.payload?.code === code ||
    err.message === code
  );
}

/**
 * Flag off: 409 `scenes_disabled`, or a 404 from a deployment that does not
 * have the scene routes yet. Either hides every scene control quietly.
 * @param {any} err
 */
export function isScenesDisabledError(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  return err.status === 409 && errorCodeIs(err, "scenes_disabled");
}

/** @param {any} err */
export function isSceneConflictError(err) {
  return Boolean(err) && err.status === 409 && errorCodeIs(err, "scene_conflict");
}

/** @param {any} err */
export function isScenePlanStaleError(err) {
  return Boolean(err) && err.status === 409 && errorCodeIs(err, "scene_plan_stale");
}

/** The `{ scene }` a 409 `scene_conflict` / `scene_plan_stale` carries. */
export function sceneFromErrorPayload(err) {
  return normalizeScene(err?.payload?.scene ?? null);
}

/**
 * `/scene …` typed in the composer (B6). Never sent as a chat message.
 * @param {unknown} text
 */
export function isSceneCommand(text) {
  return typeof text === "string" && /^\s*\/scene(?:\s|$)/i.test(text);
}

/**
 * Display name for a cast key: a character id from the roster, or an
 * `aspect:<slug>` key in a solo Lover Matrix session.
 * @param {string} id
 * @param {{ id: string, name?: string }[]} roster
 * @param {(slug: string) => string} [aspectName]
 */
export function castDisplayName(id, roster, aspectName) {
  if (id.startsWith("aspect:")) {
    const slug = id.slice("aspect:".length);
    return aspectName ? aspectName(slug) : slug;
  }
  const hit = (roster || []).find((c) => String(c?.id) === id);
  return hit?.name || "Someone";
}

/**
 * Rows for the presence list: every session participant (missing from cast
 * counts as `here`, as the contract says) plus any extra cast key the server
 * returned (e.g. `aspect:*` in a solo session).
 *
 * @param {Scene | null} scene
 * @param {{ participantIds: string[], roster: { id: string, name?: string }[], aspectName?: (slug: string) => string }} opts
 */
export function castRows(scene, { participantIds, roster, aspectName }) {
  const ids = [];
  const seen = new Set();
  for (const raw of participantIds || []) {
    const id = String(raw || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const id of Object.keys(scene?.cast || {})) {
    if (seen.has(id)) continue;
    // Only aspect keys may appear without being a participant.
    if (!id.startsWith("aspect:") || !ASPECT_SET.has(id.slice(7))) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.map((id) => {
    const entry = scene?.cast?.[id];
    return {
      id,
      name: castDisplayName(id, roster, aspectName),
      presence: entry?.presence || /** @type {Presence} */ ("here"),
      reach: entry?.reach || /** @type {Reach} */ ("none"),
      note: entry?.note || null,
    };
  });
}

/**
 * Collapsed summary, e.g. "Rooftop · 3 here · 1 away".
 * @param {Scene | null} scene
 * @param {{ presence: Presence }[]} rows
 */
export function sceneSummaryLine(scene, rows) {
  const parts = [];
  if (scene?.location) parts.push(scene.location);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows || []) counts[row.presence] = (counts[row.presence] || 0) + 1;
  for (const presence of PRESENCE_STATES) {
    if (counts[presence]) parts.push(`${counts[presence]} ${PRESENCE_META[presence].label}`);
  }
  return parts.join(" · ");
}

/**
 * The PATCH body for one chip action (B1). Each action sends one PATCH.
 * @param {string} id
 * @param {{ presence?: Presence, reach?: Reach, note?: string | null }} change
 */
export function castPatch(id, change) {
  /** @type {Record<string, unknown>} */
  const entry = {};
  if (change.presence && PRESENCE_SET.has(change.presence)) entry.presence = change.presence;
  if (change.reach && REACH_SET.has(change.reach)) entry.reach = change.reach;
  if (change.note !== undefined) entry.note = change.note == null ? null : plainSceneText(change.note, NOTE_MAX);
  return { cast: { [id]: entry } };
}

/**
 * Optimistic local view of a PATCH. Reconciled with the server's `scene`.
 * Never touches `adult_gated` or `rev`; those stay server values.
 * @param {Scene} scene
 * @param {Record<string, any>} partial
 * @returns {Scene}
 */
export function applyScenePatch(scene, partial) {
  const next = { ...scene, cast: { ...scene.cast } };
  if ("location" in partial) next.location = plainSceneText(partial.location, LOCATION_MAX);
  if (typeof partial.narrator === "boolean") next.narrator = partial.narrator;
  if (MODE_SET.has(partial.mode)) next.mode = partial.mode;
  if (isRecord(partial.cast)) {
    for (const [id, change] of Object.entries(partial.cast)) {
      if (!isRecord(change)) continue;
      const prev = next.cast[id] || { presence: "here", reach: "none", since: null, note: null };
      next.cast[id] = {
        presence: PRESENCE_SET.has(change.presence) ? change.presence : prev.presence,
        reach: REACH_SET.has(change.reach) ? change.reach : prev.reach,
        since: prev.since,
        note: "note" in change ? plainSceneText(change.note, NOTE_MAX) : prev.note,
      };
    }
  }
  return next;
}

/** A blank scene used only as the base for an optimistic PATCH. */
export function emptyScene() {
  return /** @type {Scene} */ ({
    version: 1,
    rev: null,
    location: null,
    narrator: false,
    mode: "natural",
    cast: {},
    adult_gated: null,
  });
}

/**
 * Scene event rows are `chat_messages` with `role: 'event'` (contract 3).
 * Older `type: 'event'` emotion/location chips are a different thing.
 * @param {any} message
 */
export function isSceneEventRow(message) {
  return Boolean(message) && message.role === "event";
}

/**
 * Metadata of a scene event row, tolerant of the store flattening it.
 * @param {any} row
 */
export function sceneEventMeta(row) {
  const meta = isRecord(row?.metadata) ? row.metadata : {};
  const kindRaw = meta.kind ?? row?.kind;
  const kind = KIND_SET.has(kindRaw) ? kindRaw : "state";
  const characterId = meta.character_id ?? row?.character_id ?? null;
  const presenceRaw = meta.presence ?? row?.presence;
  return {
    kind,
    characterId: characterId == null ? null : String(characterId),
    presence: PRESENCE_SET.has(presenceRaw) ? presenceRaw : null,
  };
}

/**
 * Normalize a persisted event row from PATCH / command / `scene_event`.
 * Returns null unless it is a server row with an id and text.
 * @param {any} raw
 */
export function sceneEventRow(raw) {
  if (!isRecord(raw) || raw.role !== "event") return null;
  const id = raw.id == null ? "" : String(raw.id);
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (!id || !content) return null;
  return {
    ...raw,
    id,
    role: "event",
    content,
    timestamp: raw.timestamp || raw.created_at || null,
  };
}

/**
 * The chat turn a scene event belongs to, when the server stamped it.
 * PATCH / command events have none and stay in seq order.
 * @param {any} row
 * @returns {string | null}
 */
export function eventTurnId(row) {
  const meta = isRecord(row?.metadata) ? row.metadata : {};
  const raw = meta.turn_id ?? row?.turn_id;
  if (raw == null || raw === "") return null;
  return String(raw);
}

/**
 * Index to insert a row just after this turn's reply (last non-event
 * message of the turn, then any events already placed for it). `-1`
 * means the turn's reply is not on the thread yet.
 * @param {any[]} messages
 * @param {string} turnId
 */
function indexAfterTurnReply(messages, turnId) {
  let last = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m || isSceneEventRow(m)) continue;
    const tid = m.turn_id == null ? null : String(m.turn_id);
    if (tid === turnId) last = i;
  }
  if (last === -1) return -1;
  let at = last + 1;
  while (at < messages.length && isSceneEventRow(messages[at]) && eventTurnId(messages[at]) === turnId) {
    at += 1;
  }
  return at;
}

/**
 * Add server event rows to a thread once each (by id). Events stamped
 * with a `turn_id` (or `opts.afterTurnId`) go after that turn's reply,
 * even when their `seq` is lower because the server wrote them before
 * the client persisted the assistant row. Other events keep seq order
 * when both sides carry `seq`.
 * @param {any[] | undefined} messages
 * @param {any[]} rows
 * @param {{ afterTurnId?: string | null }} [opts]
 */
export function mergeSceneEventRows(messages, rows, opts) {
  const list = Array.isArray(messages) ? messages : [];
  const fresh = [];
  const have = new Set(list.map((m) => (m?.id == null ? null : String(m.id))).filter(Boolean));
  for (const raw of rows || []) {
    const row = sceneEventRow(raw);
    if (!row || have.has(row.id)) continue;
    have.add(row.id);
    fresh.push(row);
  }
  if (!fresh.length) return list;
  const out = [...list];
  for (const row of fresh) {
    const afterTurnId = opts?.afterTurnId ? String(opts.afterTurnId) : eventTurnId(row);
    if (afterTurnId) {
      const at = indexAfterTurnReply(out, afterTurnId);
      if (at !== -1) {
        out.splice(at, 0, row);
        continue;
      }
    }
    const seq = Number(row.seq);
    if (Number.isFinite(seq)) {
      // Insert before the first later row that has a seq.
      const at = out.findIndex((m) => Number.isFinite(Number(m?.seq)) && m?.seq != null && Number(m.seq) > seq);
      if (at !== -1) {
        out.splice(at, 0, row);
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Re-place event rows that carry a `turn_id` after that turn's reply.
 * Returns the same array when nothing needs to move (flag-off / no stamps).
 * @param {any[] | undefined} messages
 */
export function orderMessagesWithSceneEvents(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.some((m) => isSceneEventRow(m) && eventTurnId(m))) return list;
  const rest = list.filter((m) => !isSceneEventRow(m));
  const events = list.filter((m) => isSceneEventRow(m));
  return mergeSceneEventRows(rest, events);
}

/**
 * Who actually spoke: `done.assistant_character_id` is authoritative;
 * while streaming, the first `scene_plan` speaker is the best preview.
 * The client's local pick is ignored when the server names someone.
 *
 * @param {any} [done]
 * @param {ReturnType<typeof scenePlanFromFrame> | null} [plan]
 * @returns {{ id: string, name: string | null } | null}
 */
export function speakerFromServer(done, plan) {
  const doneId = done?.assistant_character_id;
  if (doneId != null && String(doneId) !== "") {
    const name = done?.assistant_character_name;
    return {
      id: String(doneId),
      name: typeof name === "string" && name.trim() ? name.trim() : null,
    };
  }
  const first = plan?.speakers?.[0];
  if (first != null && String(first) !== "") {
    return { id: String(first), name: null };
  }
  return null;
}

/**
 * The server-stamped `heard_by` on a row. `null` means the row has none
 * (legacy: heard by everyone); `[]` means nobody heard it. Never computed
 * on the client.
 * @param {any} message
 * @returns {string[] | null}
 */
export function heardByFromRow(message) {
  if (!message || typeof message !== "object") return null;
  const raw = isRecord(message.metadata) && "heard_by" in message.metadata
    ? message.metadata.heard_by
    : message.heard_by;
  if (!Array.isArray(raw)) return null;
  return raw.filter((x) => typeof x === "string" || typeof x === "number").map(String);
}

/**
 * Caption for a row's server `heard_by`, or null when there is nothing to say.
 * @param {string[] | null} heardBy
 * @param {(id: string) => string} nameOf
 */
export function heardByCaption(heardBy, nameOf) {
  if (heardBy == null) return null;
  const names = heardBy.filter((id) => !id.startsWith("aspect:")).map(nameOf).filter(Boolean);
  if (!names.length) return "Heard by no one";
  return `Heard by ${names.join(", ")}`;
}

/**
 * The model-history line for an event row: a short stage direction (B4).
 * @param {any} row
 */
export function sceneStageDirection(row) {
  const text = String(row?.content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return `[Scene: ${text.length > 200 ? `${text.slice(0, 199)}…` : text}]`;
}

/**
 * `blocked: [{ id, presence }]` from the server, sanitized.
 * @param {unknown} raw
 * @returns {{ id: string, presence: Presence }[]}
 */
export function blockedFromServer(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id ?? item.character_id;
    if (id == null || !PRESENCE_SET.has(item.presence)) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, presence: /** @type {Presence} */ (item.presence) });
  }
  return out;
}

/**
 * Toast text for a blocked speaker (B7), e.g. "Natasha is asleep".
 * @param {{ presence: Presence }} blocked
 * @param {string} name
 */
export function blockedNotice(blocked, name) {
  const meta = PRESENCE_META[blocked.presence];
  return `${name || "Someone"} ${meta ? meta.verb : "can't answer right now"}`;
}

/**
 * Sanitized `scene_plan` frame (M1): who speaks, who is blocked, and
 * whether the server narrates instead.
 * @param {unknown} raw
 */
export function scenePlanFromFrame(raw) {
  if (!isRecord(raw)) return null;
  const speakers = Array.isArray(raw.speakers)
    ? raw.speakers
        .map((s) => (isRecord(s) ? s.character_id ?? s.id : s))
        .filter((id) => id != null && id !== "")
        .map(String)
    : [];
  const planId = raw.id ?? raw.plan_id ?? null;
  return {
    planId: planId == null ? null : String(planId),
    speakers,
    blocked: blockedFromServer(raw.blocked),
    narrate: raw.narrate === true,
    mode: MODE_SET.has(raw.mode) ? raw.mode : null,
  };
}

/**
 * What the client sends on a plan-following `POST /messages` (M4 + R2):
 * `if_rev` is always the rev from the latest `done.scene`.
 *
 * @param {{ planId: string | null, index: number, speakerId: string | null } | null} follow
 * @param {number | null} latestRev
 */
export function planRequestFields(follow, latestRev) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (Number.isSafeInteger(latestRev)) out.if_rev = latestRev;
  if (follow?.planId) {
    out.scene_plan_id = follow.planId;
    out.responder_index = follow.index;
  }
  return out;
}

/**
 * After `done`: the next plan-following request, or null when the plan is
 * finished. `next_speaker` comes only from the server.
 *
 * @param {any} done
 * @param {{ planId: string | null, index: number } | null} current
 * @param {ReturnType<typeof scenePlanFromFrame>} [plan]
 */
export function nextPlanFollow(done, current, plan) {
  const next = isRecord(done?.next_speaker) ? done.next_speaker : null;
  const speakerId = next?.character_id ?? next?.id ?? null;
  if (speakerId == null || speakerId === "") return null;
  const scenePlan = isRecord(done?.scene?.plan) ? done.scene.plan : null;
  const planId = plan?.planId ?? current?.planId ?? (scenePlan?.id != null ? String(scenePlan.id) : null);
  if (!planId) return null;
  let index;
  if (Number.isSafeInteger(next?.responder_index)) index = Number(next.responder_index);
  else if (Number.isSafeInteger(scenePlan?.index)) index = Number(scenePlan.index);
  else index = (current?.index ?? 0) + 1;
  return { planId, index, speakerId: String(speakerId) };
}

/**
 * The thread without scene event rows (address queue, Narrator, recaps).
 * Returns the same array when there are none, so flag-off is unchanged.
 * @template T
 * @param {T[] | undefined} messages
 * @returns {T[]}
 */
export function withoutSceneEvents(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.some(isSceneEventRow) ? list.filter((m) => !isSceneEventRow(m)) : list;
}

/**
 * The `@name` fragment being typed at the end of the composer text (B5),
 * or null. Names may contain spaces only after a completed mention.
 * @param {unknown} text
 */
export function mentionQuery(text) {
  if (typeof text !== "string") return null;
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(text);
  return m ? m[2] : null;
}

/**
 * Cast members matching the typed `@` fragment, here / reachable first.
 * Eligibility is still the server's call; this only completes names.
 * @param {string | null} query
 * @param {{ id: string, name: string, presence: Presence, reach: Reach }[]} rows
 */
export function mentionMatches(query, rows) {
  if (query == null) return [];
  const q = query.toLowerCase();
  const rank = (r) => (r.presence === "here" ? 0 : r.reach !== "none" ? 1 : 2);
  return (rows || [])
    .filter((r) => !r.id.startsWith("aspect:") && r.name.toLowerCase().startsWith(q))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6);
}

/**
 * Replace the trailing `@fragment` with `@Name `.
 * @param {string} text
 * @param {string} name
 */
export function applyMention(text, name) {
  return String(text).replace(/(^|\s)@([^\s@]{0,40})$/, (_m, lead) => `${lead}@${name} `);
}
