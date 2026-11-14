/**
 * Player action items as data + a pure state reducer. The page binds these to
 * the action bar and keyboard; everything testable lives here.
 */
import type { Vec2 } from "../layout";
import { LOOT_BY_ID, RARITY, type LootDef, type Rarity } from "./loot";
import { visitRegion, type Progress } from "./progress";
import type { RegionContext } from "./region";
import type { DataNode } from "./spawns";

export type ActionId = "scan" | "collect" | "inspect" | "jack" | "accompany" | "log";

export type ActionDef = { id: ActionId; label: string; key: string; code: string; hint: string; glyph: string };

export const ACTIONS: readonly ActionDef[] = [
  { id: "scan", label: "Scan", key: "Q", code: "KeyQ", glyph: "◎", hint: "Reveal hidden data nodes nearby" },
  { id: "collect", label: "Hack", key: "E", code: "KeyE", glyph: "⌬", hint: "Hack open a revealed node and collect it" },
  { id: "inspect", label: "Inspect", key: "F", code: "KeyF", glyph: "ⓘ", hint: "Read what a node or find is" },
  { id: "jack", label: "Jack in", key: "J", code: "KeyJ", glyph: "⇥", hint: "Travel through the nearest gate" },
  { id: "accompany", label: "Accompany", key: "C", code: "KeyC", glyph: "♡", hint: "Have your Anima explore with you" },
  { id: "log", label: "Log", key: "L", code: "KeyL", glyph: "☰", hint: "Inventory and codex" },
];

export const SCAN_RADIUS = 9;
export const SCAN_COOLDOWN_MS = 4000;
export const COLLECT_RADIUS = 1.8;
export const INSPECT_RADIUS = 3;
export const JACK_RADIUS = 4;

export type ExploreEvent =
  | { type: "scan"; found: number; best: Rarity | null; at: number; boosted?: boolean }
  | { type: "scan-cooldown"; remainingMs: number; at: number }
  | { type: "collect"; loot: LootDef; firstTime: boolean; at: number }
  | { type: "inspect"; loot: LootDef; at: number }
  | { type: "nothing"; action: ActionId; at: number };

export type ExploreState = {
  revealed: string[];
  scanReadyAt: number;
  inspecting: string | null;
  progress: Progress;
  last: ExploreEvent | null;
};

export type ExploreAction =
  | { t: "scan"; now: number; pos: Vec2; nodes: readonly DataNode[] }
  | { t: "collect"; now: number; pos: Vec2; nodes: readonly DataNode[] }
  | { t: "inspect"; now: number; pos: Vec2; nodes: readonly DataNode[]; itemId?: string }
  | { t: "close-inspect" }
  | { t: "visit"; region: RegionContext }
  | { t: "load"; progress: Progress };

export function initialExploreState(progress: Progress): ExploreState {
  return { revealed: [], scanReadyAt: 0, inspecting: null, progress, last: null };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Nearest node matching `filter` within `radius`, or null. */
export function nearestNode(nodes: readonly DataNode[], pos: Vec2, radius: number, filter: (n: DataNode) => boolean = () => true): DataNode | null {
  let best: DataNode | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    if (!filter(n)) continue;
    const d = dist(n.position, pos);
    if (d <= radius && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

export function collectible(state: ExploreState, nodes: readonly DataNode[], pos: Vec2): DataNode | null {
  return nearestNode(nodes, pos, COLLECT_RADIUS, (n) => state.revealed.includes(n.id) && !state.progress.collected.includes(n.id));
}

/** Inventory id of the Data Bazaar Scan Booster (see market/economy SHOP). */
export const SCAN_BOOSTER_ID = "shop:scan-booster";

function spendOne(inv: Record<string, number>, id: string): Record<string, number> {
  const out = { ...inv, [id]: (inv[id] ?? 0) - 1 };
  if (out[id] <= 0) delete out[id];
  return out;
}

const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export function exploreReducer(state: ExploreState, a: ExploreAction): ExploreState {
  switch (a.t) {
    case "load":
      return { ...state, progress: a.progress };
    case "visit": {
      const progress = visitRegion(state.progress, a.region);
      return progress === state.progress ? state : { ...state, progress };
    }
    case "close-inspect":
      return { ...state, inspecting: null };
    case "scan": {
      if (a.now < state.scanReadyAt) return { ...state, last: { type: "scan-cooldown", remainingMs: state.scanReadyAt - a.now, at: a.now } };
      // A Scan Booster (Data Bazaar) widens one scan by 50% and is used up.
      const boosters = state.progress.inventory[SCAN_BOOSTER_ID] ?? 0;
      const radius = boosters > 0 ? SCAN_RADIUS * 1.5 : SCAN_RADIUS;
      const hits = a.nodes.filter((n) => dist(n.position, a.pos) <= radius && !state.progress.collected.includes(n.id));
      const fresh = hits.filter((n) => !state.revealed.includes(n.id));
      let best: Rarity | null = null;
      for (const n of hits) if (!best || RARITY_ORDER.indexOf(n.loot.rarity) > RARITY_ORDER.indexOf(best)) best = n.loot.rarity;
      return {
        ...state,
        revealed: [...state.revealed, ...fresh.map((n) => n.id)],
        scanReadyAt: a.now + SCAN_COOLDOWN_MS,
        progress: boosters > 0 ? { ...state.progress, inventory: spendOne(state.progress.inventory, SCAN_BOOSTER_ID) } : state.progress,
        last: { type: "scan", found: hits.length, best, at: a.now, boosted: boosters > 0 },
      };
    }
    case "collect": {
      const node = collectible(state, a.nodes, a.pos);
      if (!node) return { ...state, last: { type: "nothing", action: "collect", at: a.now } };
      const p = state.progress;
      const firstTime = !p.codexItems[node.loot.id];
      const dayKey = node.id.split(":")[1] ?? "";
      return {
        ...state,
        inspecting: null,
        progress: {
          ...p,
          collected: [...p.collected, node.id],
          inventory: { ...p.inventory, [node.loot.id]: (p.inventory[node.loot.id] ?? 0) + 1 },
          codexItems: firstTime ? { ...p.codexItems, [node.loot.id]: dayKey } : p.codexItems,
        },
        last: { type: "collect", loot: node.loot, firstTime, at: a.now },
      };
    }
    case "inspect": {
      const loot = a.itemId
        ? LOOT_BY_ID[a.itemId]
        : nearestNode(a.nodes, a.pos, INSPECT_RADIUS, (n) => state.revealed.includes(n.id) && !state.progress.collected.includes(n.id))?.loot;
      if (!loot) return { ...state, last: { type: "nothing", action: "inspect", at: a.now } };
      return { ...state, inspecting: loot.id, last: { type: "inspect", loot, at: a.now } };
    }
  }
}

export type AvailabilityInput = {
  now: number;
  scanReadyAt: number;
  canCollect: boolean;
  canInspect: boolean;
  nearPortal: boolean;
  hasCompanion: boolean;
  /** Standing at the Data Bazaar vendor terminal: Inspect opens the market. */
  nearVendor?: boolean;
};

/** Which actions are enabled right now, with a reason when not. */
export function actionAvailability(i: AvailabilityInput): Record<ActionId, { enabled: boolean; reason?: string }> {
  const cooling = i.now < i.scanReadyAt;
  return {
    scan: cooling ? { enabled: false, reason: `Recharging ${Math.ceil((i.scanReadyAt - i.now) / 1000)}s` } : { enabled: true },
    collect: i.canCollect ? { enabled: true } : { enabled: false, reason: "Stand on a revealed node" },
    inspect: i.canInspect || i.nearVendor ? { enabled: true } : { enabled: false, reason: "Get close to a revealed node or a vendor" },
    jack: i.nearPortal ? { enabled: true } : { enabled: false, reason: "Find a gate" },
    accompany: i.hasCompanion ? { enabled: true } : { enabled: false, reason: "No Anima to bring" },
    log: { enabled: true },
  };
}

export function rarityColor(r: Rarity): string {
  return RARITY[r].color;
}
