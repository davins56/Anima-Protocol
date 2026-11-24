/**
 * Situational scenes (#763) PR 3: who answers, in what order, and the stage
 * markers a reply may carry. Pure helpers, no I/O.
 *
 * Eligibility (design §5): a character may speak when she is `here`, or when
 * she is `away` with `reach` text/phone and was @addressed. asleep, injured,
 * busy and jacked_in never speak, even when addressed. Ids outside the
 * stored cast never speak.
 *
 * Plans (M4 + R2): `metadata.scene.plan = { id, rev, queue, reasons,
 * addressed, index, expires_at, mode }`. `rev` is the scene rev the plan is
 * valid for; the plan's own stage markers move it forward with the scene, a
 * PATCH / command / other tab does not, so those make the plan stale.
 *
 * Stage markers (§6, M9): `[[exit]]` and `[[enter:<name>]]`. They are held
 * back across stream chunks and removed from both the stream and the stored
 * reply with the same filter, so the two are identical. An unclosed `[[…`
 * (or one longer than STAGE_MARKER_MAX) is plain text.
 */
import { isAspectKey, type ScenePresence, type SceneState } from "./sceneState";

export const PLAN_TTL_MS = 10 * 60 * 1000;
export const NATURAL_MAX_SPEAKERS = 2;
export const STAGE_MARKER_MAX = 80;

export type SpeakerReason = "forced" | "addressed" | "picked" | "everyone";
export type PlanSpeaker = { character_id: string; reason: SpeakerReason };
export type BlockedSpeaker = { id: string; presence: ScenePresence | "unknown" };

export type ScenePlan = {
  id: string;
  rev: number;
  queue: string[];
  reasons: SpeakerReason[];
  addressed: string[];
  index: number;
  expires_at: string;
  mode: "natural" | "everyone";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Can `id` speak in `scene` right now? `addressed` = @mentioned this turn. */
export function speakerEligible(scene: SceneState, id: string, addressed: boolean): boolean {
  if (!id || isAspectKey(id)) return false;
  const entry = scene.cast[id];
  if (!entry) return false;
  if (entry.presence === "here") return true;
  return addressed && entry.presence === "away" && (entry.reach === "text" || entry.reach === "phone");
}

export function blockedOf(scene: SceneState, id: string): BlockedSpeaker {
  return { id, presence: scene.cast[id]?.presence ?? "unknown" };
}

function pushBlocked(list: BlockedSpeaker[], entry: BlockedSpeaker) {
  if (!list.some((b) => b.id === entry.id)) list.push(entry);
}

/**
 * The speakers for a new turn.
 * - natural: the requested speaker (when eligible), then other addressed
 *   characters, at most 2. When the user spoke and nobody was picked, the
 *   first eligible character answers (M5). A continue picks at most one.
 * - everyone: every eligible character, the requested / addressed first.
 * `blocked` lists the requested and addressed characters who cannot answer.
 * `narrate` is true only when nobody speaks, the user spoke and the narrator
 * is on (M3).
 */
export function planSpeakers(input: {
  scene: SceneState;
  cast: readonly string[];
  requested: string | null;
  mentioned: readonly string[];
  isContinue: boolean;
}): { speakers: PlanSpeaker[]; blocked: BlockedSpeaker[]; narrate: boolean } {
  const { scene, cast } = input;
  const mentioned = input.mentioned.filter((id) => cast.includes(id));
  const requested = input.requested && cast.includes(input.requested) ? input.requested : null;
  const speakers: PlanSpeaker[] = [];
  const blocked: BlockedSpeaker[] = [];
  const add = (id: string, reason: SpeakerReason) => {
    if (!speakers.some((s) => s.character_id === id)) speakers.push({ character_id: id, reason });
  };
  const addressedOf = (id: string) => mentioned.includes(id);
  if (requested) {
    if (speakerEligible(scene, requested, addressedOf(requested))) {
      add(requested, addressedOf(requested) ? "addressed" : "forced");
    } else pushBlocked(blocked, blockedOf(scene, requested));
  }
  for (const id of mentioned) {
    if (speakerEligible(scene, id, true)) add(id, "addressed");
    else pushBlocked(blocked, blockedOf(scene, id));
  }
  const eligibleHere = cast.filter((id) => speakerEligible(scene, id, false));
  if (scene.mode === "everyone" && !input.isContinue) {
    for (const id of eligibleHere) add(id, speakers.length ? "everyone" : "picked");
  } else {
    if (!speakers.length && eligibleHere.length) {
      const userSpoke = !input.isContinue;
      // M5: the user spoke, so someone answers. A continue keeps going only
      // when the requested speaker could not (she is blocked) and someone is
      // still in the room.
      if (userSpoke || requested) add(eligibleHere[0]!, "picked");
    }
    speakers.splice(input.isContinue ? 1 : NATURAL_MAX_SPEAKERS);
  }
  const narrate = speakers.length === 0 && !input.isContinue && scene.narrator === true;
  return { speakers, blocked, narrate };
}

/** A stored plan, or null when missing or malformed. */
export function readPlan(raw: unknown): ScenePlan | null {
  if (!isObject(raw)) return null;
  const { id, rev, queue, index, expires_at } = raw;
  if (typeof id !== "string" || !id) return null;
  if (!Number.isSafeInteger(rev) || !Number.isSafeInteger(index)) return null;
  if (!Array.isArray(queue) || !queue.every((q) => typeof q === "string" && q)) return null;
  if (typeof expires_at !== "string" || Number.isNaN(Date.parse(expires_at))) return null;
  const reasons = Array.isArray(raw.reasons) ? (raw.reasons as SpeakerReason[]) : [];
  const addressed = Array.isArray(raw.addressed) ? (raw.addressed as unknown[]).filter((a): a is string => typeof a === "string") : [];
  return {
    id,
    rev: Number(rev),
    queue: queue as string[],
    reasons: queue.map((_, i) => reasons[i] ?? "picked"),
    addressed,
    index: Number(index),
    expires_at,
    mode: raw.mode === "everyone" ? "everyone" : "natural",
  };
}

/**
 * The first queued speaker at or after `from` who can still speak in
 * `scene`. Skipped speakers are returned as `blocked` (R2: no 409 for an
 * eligibility change, the queue is revalidated).
 */
export function revalidateQueue(
  plan: ScenePlan,
  scene: SceneState,
  from: number,
): { index: number | null; blocked: BlockedSpeaker[] } {
  const blocked: BlockedSpeaker[] = [];
  for (let i = Math.max(0, from); i < plan.queue.length; i += 1) {
    const id = plan.queue[i]!;
    if (speakerEligible(scene, id, plan.addressed.includes(id))) return { index: i, blocked };
    pushBlocked(blocked, blockedOf(scene, id));
  }
  return { index: null, blocked };
}

/** The remaining speakers of a plan from `index`, as the scene_plan frame lists them. */
export function remainingSpeakers(plan: ScenePlan, scene: SceneState, index: number): PlanSpeaker[] {
  const out: PlanSpeaker[] = [];
  for (let i = index; i < plan.queue.length; i += 1) {
    const id = plan.queue[i]!;
    if (speakerEligible(scene, id, plan.addressed.includes(id))) out.push({ character_id: id, reason: plan.reasons[i] ?? "picked" });
  }
  return out;
}

// ------------------------------------------------------------ stage markers

export type StageMarker = { kind: "exit" } | { kind: "enter"; name: string };

const MARKER_RE = /^\[\[\s*(?:(exit)|enter\s*:\s*([^\][\n]{1,60}?))\s*\]\]$/i;

function parseMarker(candidate: string): StageMarker | null {
  const m = MARKER_RE.exec(candidate);
  if (!m) return null;
  if (m[1]) return { kind: "exit" };
  const name = (m[2] ?? "").trim();
  return name ? { kind: "enter", name } : null;
}

/**
 * Chunk-safe marker filter. `push` returns the text that may be shown now;
 * `finish` returns the held tail (an unclosed `[[…` is plain text). The
 * output does not depend on how the text was chunked.
 */
export class StageMarkerFilter {
  private held = "";
  readonly markers: StageMarker[] = [];

  push(delta: string): string {
    this.held += delta;
    return this.drain(false);
  }

  finish(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let out = "";
    let buf = this.held;
    for (;;) {
      const open = buf.indexOf("[[");
      if (open < 0) {
        // A lone trailing "[" may be the start of a marker.
        if (!final && buf.endsWith("[")) {
          out += buf.slice(0, -1);
          buf = "[";
        } else {
          out += buf;
          buf = "";
        }
        break;
      }
      out += buf.slice(0, open);
      buf = buf.slice(open);
      const close = buf.indexOf("]]", 2);
      if (close >= 0 && close + 2 <= STAGE_MARKER_MAX) {
        const candidate = buf.slice(0, close + 2);
        const marker = parseMarker(candidate);
        if (marker) this.markers.push(marker);
        else out += candidate;
        buf = buf.slice(close + 2);
        continue;
      }
      if (close < 0 && buf.length < STAGE_MARKER_MAX && !final) break; // wait for more
      // Too long (or never closed): not a marker. Emit "[[" and keep scanning.
      out += "[[";
      buf = buf.slice(2);
    }
    this.held = buf;
    return out;
  }
}

/** The same filter over a whole reply. */
export function extractStageMarkers(text: string): { visible: string; markers: StageMarker[] } {
  const filter = new StageMarkerFilter();
  const visible = filter.push(text) + filter.finish();
  return { visible, markers: filter.markers };
}

/**
 * The cast patch a speaker's markers may make (§6, R2):
 * - `[[exit]]`: only the speaker herself, only while she is `here`;
 * - `[[enter:Name]]`: a cast member who is `away` comes back (`here`).
 *   Nobody can be woken, healed or jacked out by a marker, and a speaker who
 *   is not `here` changes nothing.
 * Names match the session's cast names case-insensitively.
 */
export function markerCastPatch(input: {
  markers: readonly StageMarker[];
  scene: SceneState;
  speakerId: string | null;
  names: ReadonlyMap<string, string>;
}): Record<string, { presence: "here" | "away" }> | null {
  const { scene, speakerId } = input;
  if (!speakerId || scene.cast[speakerId]?.presence !== "here") return null;
  const patch: Record<string, { presence: "here" | "away" }> = {};
  for (const marker of input.markers) {
    if (marker.kind === "exit") {
      patch[speakerId] = { presence: "away" };
      continue;
    }
    const wanted = marker.name.toLowerCase();
    for (const [id, name] of input.names) {
      if (id === speakerId || name.trim().toLowerCase() !== wanted) continue;
      if (scene.cast[id]?.presence === "away" && !patch[id]) patch[id] = { presence: "here" };
    }
  }
  return Object.keys(patch).length ? patch : null;
}
