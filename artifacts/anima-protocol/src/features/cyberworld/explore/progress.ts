/**
 * Exploration progress: inventory, today's collected nodes, and the codex of
 * discovered items and regions. Persisted to localStorage.
 *
 * TODO(cyberworld-explore): sync to the account. The existing Inventory store
 * entity (lib/inventory) is catalog-bound (ATTAINABLE_ITEMS) and has no slot
 * for exploration finds or a region codex; adding one needs a schema/catalog
 * decision, so this stays device-local for now. Region entries hold only an
 * opaque key, label and biome — never coordinates.
 */
import type { BiomeId } from "./biomes";
import type { RegionContext } from "./region";

export const PROGRESS_STORAGE_KEY = "anima.cyberworld.explore.v1";

export type RegionEntry = { key: string; label: string; biome: BiomeId; firstSeen: string; lastSeen: string; days: number };

export type Progress = {
  version: 1;
  inventory: Record<string, number>;
  /** Node ids collected; pruned to the current day on load. */
  collected: string[];
  /** itemId → day first found. */
  codexItems: Record<string, string>;
  regions: Record<string, RegionEntry>;
};

export function emptyProgress(): Progress {
  return { version: 1, inventory: {}, collected: [], codexItems: {}, regions: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Tolerant parse: drops anything malformed rather than throwing. */
export function parseProgress(raw: string | null | undefined, dayKey?: string): Progress {
  const out = emptyProgress();
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(data) || data.version !== 1) return out;
  if (isRecord(data.inventory)) for (const [k, v] of Object.entries(data.inventory)) if (typeof v === "number" && v > 0) out.inventory[k] = Math.floor(v);
  if (Array.isArray(data.collected)) out.collected = data.collected.filter((x): x is string => typeof x === "string" && (!dayKey || x.includes(`:${dayKey}:`)));
  if (isRecord(data.codexItems)) for (const [k, v] of Object.entries(data.codexItems)) if (typeof v === "string") out.codexItems[k] = v;
  if (isRecord(data.regions))
    for (const [k, v] of Object.entries(data.regions)) {
      if (isRecord(v) && typeof v.label === "string" && typeof v.biome === "string" && typeof v.firstSeen === "string" && typeof v.lastSeen === "string")
        out.regions[k] = { key: k, label: v.label, biome: v.biome as BiomeId, firstSeen: v.firstSeen, lastSeen: v.lastSeen, days: typeof v.days === "number" ? v.days : 1 };
    }
  return out;
}

export function loadProgress(dayKey: string): Progress {
  try {
    return parseProgress(window.localStorage.getItem(PROGRESS_STORAGE_KEY), dayKey);
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full / disabled */
  }
}

/** Record a visit to a region (counts distinct days). */
export function visitRegion(p: Progress, r: Pick<RegionContext, "key" | "label" | "biome" | "dayKey">): Progress {
  const prev = p.regions[r.key];
  if (prev && prev.lastSeen === r.dayKey && prev.biome === r.biome) return p;
  const entry: RegionEntry = prev
    ? { ...prev, label: r.label, biome: r.biome, lastSeen: r.dayKey, days: prev.lastSeen === r.dayKey ? prev.days : prev.days + 1 }
    : { key: r.key, label: r.label, biome: r.biome, firstSeen: r.dayKey, lastSeen: r.dayKey, days: 1 };
  return { ...p, regions: { ...p.regions, [r.key]: entry } };
}
