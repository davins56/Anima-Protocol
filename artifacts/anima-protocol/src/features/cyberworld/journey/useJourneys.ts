/**
 * Runs every resident's journey state machine. On-screen companions (same
 * area as the player) tick at 4 Hz and the scene smooths their motion;
 * companions elsewhere tick once a second with nothing rendered. Accompany
 * mode freezes the companion's journey; dismissing it sends them home from
 * wherever you are. Journey events go to the pluggable sink (localStorage).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { PlayerTelemetry } from "../CyberworldScene";
import type { Vec2, World, WorldAnima } from "../layout";
import { NO_HINTS, type InterestHints } from "./choose";
import { initTraveller, releaseAt, statusLine, tickTraveller, type JourneyMode, type Traveller } from "./journeys";
import { receiveGift } from "../market/gift";
import { localStorageSink, type JourneyEvent, type JourneySink } from "./log";

const FINE_MS = 250;
const COARSE_EVERY = 4; // off-screen: every 4th tick (1 s)
const PUBLISH_EVERY = 2; // HUD snapshot at 2 Hz

/** What the HUD needs (re-rendered at 2 Hz, not per frame). */
export type TravellerView = { id: string; name: string; areaId: string; pos: Vec2; mode: JourneyMode; thought: string | null; status: string };

type Options = {
  world: World;
  animas: readonly WorldAnima[];
  areaId: string;
  dayKey: string;
  telemetry: MutableRefObject<PlayerTelemetry>;
  companionId: string | null;
  /** TODO(Anima Backend Data / Builder): per-companion interest hints (recent chat topics, memories). */
  hintsFor?: (animaId: string) => InterestHints;
  sink?: JourneySink;
};

export function useJourneys({ world, animas, areaId, dayKey, telemetry, companionId, hintsFor, sink }: Options) {
  const travellers = useRef<Traveller[]>([]);
  const [views, setViews] = useState<TravellerView[]>([]);
  const logSink = useMemo(() => sink ?? localStorageSink(), [sink]);
  const live = useRef({ areaId, companionId, hintsFor });
  live.current = { areaId, companionId, hintsFor };

  // (Re)build when the residents or the day change; keep existing state by id.
  useEffect(() => {
    const now = Date.now();
    const prev = new Map(travellers.current.map((t) => [t.id, t]));
    travellers.current = animas.map((a) => prev.get(a.id) ?? initTraveller(world, a, dayKey, now)).filter((t): t is Traveller => !!t);
  }, [world, animas, dayKey]);

  // Accompany ended → release the companion where the player stands.
  const lastCompanion = useRef<string | null>(null);
  useEffect(() => {
    const was = lastCompanion.current;
    lastCompanion.current = companionId;
    if (!was || was === companionId) return;
    const p = telemetry.current;
    travellers.current = travellers.current.map((t) => (t.id === was ? releaseAt(world, t, live.current.areaId, [p.x, p.z], Date.now()) : t));
  }, [companionId, telemetry, world]);

  useEffect(() => {
    let n = 0;
    let last = Date.now();
    const lastTick = new Map<string, number>();
    const id = setInterval(() => {
      const now = Date.now();
      n++;
      const { areaId: here, companionId: with_, hintsFor: hints } = live.current;
      const p = telemetry.current;
      const homeIds = new Set(travellers.current.filter((t) => t.mode === "home" || (t.resume === "home" && t.mode === "greet")).map((t) => t.id));
      const events: JourneyEvent[] = [];
      travellers.current = travellers.current.map((t) => {
        if (t.id === with_) return t; // Accompany overrides journeys.
        const onScreen = t.areaId === here;
        if (!onScreen && n % COARSE_EVERY !== 0) return t;
        const prevAt = lastTick.get(t.id) ?? last;
        lastTick.set(t.id, now);
        const r = tickTraveller(world, t, { now, dt: Math.min(5, (now - prevAt) / 1000), playerArea: here, playerPos: [p.x, p.z], hints: hints?.(t.id) ?? NO_HINTS, homeIds });
        events.push(...r.events);
        return r.t;
      });
      last = now;
      if (events.length) logSink.record(events);
      if (n % PUBLISH_EVERY === 0) {
        setViews(travellers.current.map((t) => ({ id: t.id, name: t.name, areaId: t.areaId, pos: t.pos, mode: t.mode, thought: t.thought, status: statusLine(t, world) })));
      }
    }, FINE_MS);
    return () => clearInterval(id);
  }, [world, telemetry, logSink]);

  /** Give a gift (Data Bazaar): updates the companion's motives/thought and logs the event. */
  const gift = useCallback(
    (companionId: string, g: { itemId: string; itemName: string; areaId: string; strength: number }) => {
      const now = Date.now();
      let event: JourneyEvent | null = null;
      travellers.current = travellers.current.map((t) => {
        if (t.id !== companionId) return t;
        const r = receiveGift(t, { ...g, now });
        event = r.event;
        return r.t;
      });
      if (event) logSink.record([event]);
      return event as JourneyEvent | null;
    },
    [logSink],
  );

  return { travellers, views, gift };
}
