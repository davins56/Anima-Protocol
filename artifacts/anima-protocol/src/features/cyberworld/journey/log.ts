/**
 * Journey log: where companions went and why, as structured events with a
 * pluggable sink. Default sink keeps the last
 * JOURNEY_LOG_CAP events per companion in localStorage. Nothing is sent to the
 * backend yet — see toMemoryEventRow / the adapter TODO below.
 */

import type { Need } from "../layout";

export type JourneyEvent = {
  /** Stable id (companion + sim time), doubles as a dedupe key. */
  id: string;
  companionId: string;
  kind: "journey";
  /** Area of the destination. */
  areaId: string;
  /** Destination zone / prop id. */
  targetId: string;
  /** What they did there, e.g. "read the new signs". */
  activity: string;
  /** Why, e.g. "curious about the Landing Page signs". */
  reason: string;
  /** The need that drove the choice. */
  motive: Need;
  /** "went to X because Y". */
  summary: string;
  /** ISO 8601 timestamp. */
  occurredAt: string;
};

export interface JourneySink {
  record(events: readonly JourneyEvent[]): void;
  list(companionId: string): JourneyEvent[];
}

export const JOURNEY_LOG_KEY = "anima.cyberworld.journeys.v1";
export const JOURNEY_LOG_CAP = 50;

type Store = Pick<Storage, "getItem" | "setItem">;

function isEvent(v: unknown): v is JourneyEvent {
  const e = v as JourneyEvent;
  return !!e && typeof e.id === "string" && typeof e.companionId === "string" && e.kind === "journey" && typeof e.occurredAt === "string";
}

/** localStorage sink: { [companionId]: JourneyEvent[] }, newest last, capped per companion. */
export function localStorageSink(store: Store | null = typeof localStorage === "undefined" ? null : localStorage, cap = JOURNEY_LOG_CAP): JourneySink {
  const read = (): Record<string, JourneyEvent[]> => {
    try {
      const raw = store?.getItem(JOURNEY_LOG_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, JourneyEvent[]> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter(isEvent);
      return out;
    } catch {
      return {};
    }
  };
  return {
    record(events) {
      if (!events.length || !store) return;
      const all = read();
      for (const e of events) {
        const list = all[e.companionId] ?? [];
        if (!list.some((x) => x.id === e.id)) list.push(e);
        all[e.companionId] = list.slice(-cap);
      }
      try {
        store.setItem(JOURNEY_LOG_KEY, JSON.stringify(all));
      } catch {
        /* quota / private mode: the log is best-effort */
      }
    },
    list(companionId) {
      return read()[companionId] ?? [];
    },
  };
}

/** Fan out to several sinks (e.g. localStorage + a future backend adapter). */
export function multiSink(...sinks: JourneySink[]): JourneySink {
  return {
    record: (events) => sinks.forEach((s) => s.record(events)),
    list: (id) => sinks[0]?.list(id) ?? [],
  };
}

/**
 * Shape of a public.memory_events row for this event (see
 * supabase/migrations/20261022160100_memory_events.sql). Pure; not sent anywhere.
 *
 * TODO(Anima Backend Data): to persist journey events —
 *  1. add a `cyberworld_journey` row to public.memory_event_types (plain INSERT),
 *  2. expose an authenticated, append-only API route that inserts these rows
 *     (user_id from the session, never from the client), upserting on
 *     (user_id, dedupe_key),
 *  3. implement a JourneySink that batches toMemoryEventRow() output to it and
 *     add it via multiSink(localStorageSink(), backendSink).
 *  Mock residents (ids starting "mock-") must not be sent.
 */
export function toMemoryEventRow(e: JourneyEvent, userId: string) {
  return {
    user_id: userId,
    character_id: e.companionId,
    conversation_id: null,
    message_id: null,
    event_type: "cyberworld_journey",
    content: e.summary,
    payload: { kind: e.kind, area_id: e.areaId, target_id: e.targetId, activity: e.activity, reason: e.reason, motive: e.motive, journey_event_id: e.id },
    emotional_weight: e.motive === "social" ? 0.3 : 0.2,
    dedupe_key: `journey:${e.id}`,
    source: "cyberworld",
    occurred_at: e.occurredAt,
  };
}
