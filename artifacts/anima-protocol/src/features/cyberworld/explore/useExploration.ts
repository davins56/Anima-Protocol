import { useCallback, useEffect, useMemo, useReducer, useState, type MutableRefObject } from "react";
import type { PlayerTelemetry, SceneCommands, SceneNode } from "../CyberworldScene";
import type { Area, Vec2 } from "../layout";
import { JACK_RADIUS, actionAvailability, collectible, exploreReducer, initialExploreState, nearestNode, INSPECT_RADIUS } from "./actions";
import { RARITY } from "./loot";
import { loadProgress, saveProgress } from "./progress";
import type { RegionContext } from "./region";
import { generateNodes } from "./spawns";

type Opts = {
  area: Area;
  region: RegionContext;
  telemetry: MutableRefObject<PlayerTelemetry>;
  commands: MutableRefObject<SceneCommands>;
  hasCompanion: boolean;
};

const RARITY_TIER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as const;

/** Exploration loop glue: daily nodes, reducer, persistence, proximity and actions. */
export function useExploration({ area, region, telemetry, commands, hasCompanion }: Opts) {
  const [state, dispatch] = useReducer(exploreReducer, undefined, () => initialExploreState(loadProgress(region.dayKey)));
  const [prox, setProx] = useState({ canCollect: false, canInspect: false, portalId: null as string | null });
  const [now, setNow] = useState(() => performance.now());

  const nodes = useMemo(
    () => generateNodes(area, region),
    // Only the inputs that change what spawns (not the minute clock).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [area, region.key, region.dayKey, region.biome, region.timeOfDay, region.weather, region.season],
  );

  useEffect(() => saveProgress(state.progress), [state.progress]);
  useEffect(() => dispatch({ t: "visit", region }), [region]);

  // Proximity poll (cheap; avoids per-frame React updates).
  useEffect(() => {
    const t = setInterval(() => {
      const pos: Vec2 = [telemetry.current.x, telemetry.current.z];
      const canCollect = !!collectible(state, nodes, pos);
      const canInspect = !!nearestNode(nodes, pos, INSPECT_RADIUS, (n) => state.revealed.includes(n.id) && !state.progress.collected.includes(n.id));
      let portalId: string | null = null;
      let bd = JACK_RADIUS;
      for (const g of area.portals) {
        const d = Math.hypot(g.position[0] - pos[0], g.position[1] - pos[1]);
        if (d <= bd) {
          bd = d;
          portalId = g.id;
        }
      }
      setProx((p) => (p.canCollect === canCollect && p.canInspect === canInspect && p.portalId === portalId ? p : { canCollect, canInspect, portalId }));
      // Only tick the clock while the scanner is recharging (drives the countdown label).
      const t = performance.now();
      if (t < state.scanReadyAt + 300) setNow(t);
    }, 200);
    return () => clearInterval(t);
  }, [telemetry, state, nodes, area]);

  const scan = useCallback(() => dispatch({ t: "scan", now: performance.now(), pos: [telemetry.current.x, telemetry.current.z], nodes }), [nodes, telemetry]);
  const collect = useCallback(() => dispatch({ t: "collect", now: performance.now(), pos: [telemetry.current.x, telemetry.current.z], nodes }), [nodes, telemetry]);
  const inspect = useCallback(
    (itemId?: string) => dispatch({ t: "inspect", now: performance.now(), pos: [telemetry.current.x, telemetry.current.z], nodes, itemId }),
    [nodes, telemetry],
  );
  const closeInspect = useCallback(() => dispatch({ t: "close-inspect" }), []);
  const jack = useCallback(() => {
    const g = area.portals.find((p) => p.id === prox.portalId);
    if (g) commands.current.walkTo = g.position;
  }, [area, prox.portalId, commands]);

  const sceneNodes: SceneNode[] = useMemo(
    () =>
      nodes
        .filter((n) => !state.progress.collected.includes(n.id))
        .map((n) => ({ id: n.id, position: n.position, color: RARITY[n.loot.rarity].color, revealed: state.revealed.includes(n.id), big: RARITY_TIER[n.loot.rarity] >= 3 })),
    [nodes, state.progress.collected, state.revealed],
  );

  const availability = actionAvailability({
    now,
    scanReadyAt: state.scanReadyAt,
    canCollect: prox.canCollect,
    canInspect: prox.canInspect,
    nearPortal: !!prox.portalId,
    hasCompanion,
  });

  return { state, nodes, sceneNodes, availability, scan, collect, inspect, closeInspect, jack, rarityTier: RARITY_TIER };
}
