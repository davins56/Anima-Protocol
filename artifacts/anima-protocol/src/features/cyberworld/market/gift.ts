/**
 * Gifting a companion: satisfies their social need and produces a
 * journey-style event (kind "journey", activity "received a gift", motive
 * "social") so it flows through the same JourneySink / toMemoryEventRow path.
 */
import type { Traveller } from "../journey/journeys";
import { THOUGHT_MS } from "../journey/journeys";
import type { JourneyEvent, JourneySink } from "../journey/log";
import { satisfy } from "../journey/motives";

export const GIFT_ACTIVITY = "received a gift";

export function receiveGift(
  t: Traveller,
  gift: { itemId: string; itemName: string; areaId: string; strength: number; now: number },
): { t: Traveller; event: JourneyEvent } {
  const reason = `you gave them ${gift.itemName}`;
  const event: JourneyEvent = {
    id: `${t.id}:gift:${gift.now}`,
    companionId: t.id,
    kind: "journey",
    areaId: gift.areaId,
    targetId: gift.itemId,
    activity: GIFT_ACTIVITY,
    reason,
    motive: "social",
    summary: `${t.name} ${GIFT_ACTIVITY} because ${reason}`,
    occurredAt: new Date(gift.now).toISOString(),
  };
  return {
    t: { ...t, motives: satisfy(t.motives, { social: 1 }, gift.strength), thought: `♡ thanks for the ${gift.itemName}!`, thoughtUntil: gift.now + THOUGHT_MS },
    event,
  };
}

/**
 * The gift path used by useJourneys: update the companion and record the event
 * through the same sink as journeys (localStorage + backend sync queue), so a
 * gift syncs as event_type cyberworld_journey / activity "received a gift".
 */
export function recordGift(
  travellers: readonly Traveller[],
  companionId: string,
  gift: { itemId: string; itemName: string; areaId: string; strength: number; now: number },
  sink: JourneySink,
): { travellers: Traveller[]; event: JourneyEvent | null } {
  let event: JourneyEvent | null = null;
  const next = travellers.map((t) => {
    if (t.id !== companionId) return t;
    const r = receiveGift(t, gift);
    event = r.event;
    return r.t;
  });
  if (event) sink.record([event]);
  return { travellers: next, event };
}
