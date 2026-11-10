import { describe, expect, it } from "vitest";
import { buildWorld } from "../areas";
import { isWalkable } from "../collision";
import { actionAvailability, COLLECT_RADIUS, exploreReducer, initialExploreState, SCAN_COOLDOWN_MS, SCAN_RADIUS } from "./actions";
import { BIOME_IDS, biomeTint, classifyBiome } from "./biomes";
import { companionLine, systemLine } from "./companion";
import { eligibleLoot, isEligible, LOOT, LOOT_BY_ID, rollLoot, type LootConditions } from "./loot";
import { emptyProgress, parseProgress, visitRegion } from "./progress";
import { buildRegionContext, cellKey, coordsFromTimezone, dayKeyFor, seasonFor, snapToCell, timeOfDay, weatherFromWmo, type RegionContext } from "./region";
import { hashString, seededRng, weightedIndex } from "./rng";
import { generateNodes, NODES_PER_AREA } from "./spawns";
import { fetchWeather, openMeteoUrl, parseOpenMeteo, WEATHER_CACHE_KEY } from "./weather";

const at = (h: number, month = 5, day = 10) => new Date(2026, month, day, h, 0, 0);
const tz = (timezone: string, date = at(12)) => buildRegionContext({ source: "timezone", timezone }, date);

describe("rng", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = seededRng("x");
    const b = seededRng("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRng("y")()).not.toBe(seededRng("x")());
    expect(hashString("abc")).toBe(hashString("abc"));
  });
  it("picks by weight", () => {
    expect(weightedIndex([1, 0, 1], 0.1)).toBe(0);
    expect(weightedIndex([1, 0, 1], 0.9)).toBe(2);
    expect(weightedIndex([], 0.5)).toBe(-1);
  });
});

describe("region", () => {
  it("snaps coordinates to a ~0.5° cell and keys it opaquely", () => {
    expect(snapToCell(40.7128, -74.006)).toEqual({ lat: 40.75, lon: -74.25 });
    expect(snapToCell(40.6, -74.4)).toEqual(snapToCell(40.9, -74.01));
    const key = cellKey(40.7128, -74.006);
    expect(key).toMatch(/^cell-[0-9a-z]+$/);
    expect(key).not.toContain("40");
    expect(cellKey(40.6, -74.4)).toBe(key);
  });
  it("falls back to timezone coordinates by zone, then continent", () => {
    expect(coordsFromTimezone("Asia/Tokyo")).toEqual({ lat: 35.7, lon: 139.7 });
    expect(coordsFromTimezone("Europe/Vilnius").lat).toBe(50);
    expect(coordsFromTimezone(undefined).lat).toBeCloseTo(51.5);
  });
  it("derives time of day and hemisphere-aware seasons", () => {
    expect([timeOfDay(at(6)), timeOfDay(at(12)), timeOfDay(at(19)), timeOfDay(at(23)), timeOfDay(at(3))]).toEqual(["dawn", "day", "dusk", "night", "night"]);
    expect(seasonFor(at(12, 6), 40)).toBe("summer");
    expect(seasonFor(at(12, 6), -33)).toBe("winter");
    expect(seasonFor(at(12, 0), -33)).toBe("summer");
    expect(dayKeyFor(at(12, 0, 5))).toBe("2026-01-05");
  });
  it("maps WMO weather codes", () => {
    expect([0, 2, 45, 61, 81, 73, 95, null].map((c) => weatherFromWmo(c))).toEqual(["clear", "cloudy", "fog", "rain", "rain", "snow", "storm", "unknown"]);
  });
  it("builds a context without exposing precise coordinates", () => {
    const geo = buildRegionContext({ source: "geo", lat: 40.7128, lon: -74.006, elevation: 10, weather: "rain" }, at(22));
    expect(geo).toMatchObject({ source: "geo", lat: 40.75, lon: -74.25, biome: "urban", timeOfDay: "night", weather: "rain", dayKey: "2026-06-10" });
    expect(JSON.stringify(geo)).not.toContain("40.7128");
    expect(tz("America/New_York")).toMatchObject({ key: "tz-America/New_York", label: "New York", biome: "urban", weather: "unknown" });
  });
});

describe("biomes", () => {
  it("classifies deterministically from lat/lon/elevation", () => {
    expect(classifyBiome({ lat: 78, lon: 15 })).toBe("polar");
    expect(classifyBiome({ lat: -77.8, lon: 166 })).toBe("polar");
    expect(classifyBiome({ lat: 35.7, lon: 139.7 })).toBe("urban");
    expect(classifyBiome({ lat: 23, lon: 10 })).toBe("desert");
    expect(classifyBiome({ lat: 39.7, lon: -105.5, elevation: 2600 })).toBe("mountain");
    expect(classifyBiome({ lat: 44, lon: -68, elevation: 5 })).toBe("coastal");
    expect(classifyBiome({ lat: 46, lon: 7.5, elevation: 600 })).toBe("forest");
    expect(classifyBiome({ lat: NaN, lon: 0 })).toBe("forest");
    expect(classifyBiome({ lat: 44.1, lon: -71.2 })).toBe(classifyBiome({ lat: 44.1, lon: -71.2 }));
  });
  it("tints darker at night", () => {
    expect(biomeTint("forest", "night").light).toBeLessThan(biomeTint("forest", "day").light);
  });
});

describe("loot", () => {
  const cond = (o: Partial<LootConditions>): LootConditions => ({ biome: "forest", timeOfDay: "day", weather: "clear", season: "summer", ...o });
  it("every biome has native finds and every row is reachable", () => {
    for (const b of BIOME_IDS) expect(eligibleLoot(cond({ biome: b })).some((d) => d.biomes !== "any")).toBe(true);
    expect(new Set(LOOT.map((d) => d.id)).size).toBe(LOOT.length);
  });
  it("gates night-only, rain-only and season finds", () => {
    expect(isEligible(LOOT_BY_ID["moon-cache"], cond({ timeOfDay: "day" }))).toBe(false);
    expect(isEligible(LOOT_BY_ID["moon-cache"], cond({ timeOfDay: "night" }))).toBe(true);
    expect(isEligible(LOOT_BY_ID["rain-glyph"], cond({ weather: "rain" }))).toBe(true);
    expect(isEligible(LOOT_BY_ID["moss-cache"], cond({ weather: "clear" }))).toBe(false);
    expect(isEligible(LOOT_BY_ID["elder-root"], cond({ season: "autumn" }))).toBe(true);
    expect(isEligible(LOOT_BY_ID["aurora-core"], cond({ biome: "forest", timeOfDay: "night" }))).toBe(false);
    expect(isEligible(LOOT_BY_ID["aurora-core"], cond({ biome: "polar", timeOfDay: "night" }))).toBe(true);
  });
  it("rolls deterministically and respects rarity", () => {
    const r1 = seededRng("s");
    const r2 = seededRng("s");
    const a = Array.from({ length: 20 }, () => rollLoot(r1, cond({}))?.id);
    const b = Array.from({ length: 20 }, () => rollLoot(r2, cond({}))?.id);
    expect(a).toEqual(b);
    const rng = seededRng("dist");
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const d = rollLoot(rng, cond({}))!;
      counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
    }
    expect(counts.common).toBeGreaterThan(counts.rare ?? 0);
    expect(counts.legendary ?? 0).toBe(0); // no legendary is eligible in a clear forest day
  });
});

describe("spawns", () => {
  const world = buildWorld([]);
  const hub = world.areas[0];
  const region = tz("Europe/Berlin");
  it("are deterministic per region + day + area, and walkable", () => {
    const a = generateNodes(hub, region);
    expect(a).toHaveLength(NODES_PER_AREA);
    expect(generateNodes(hub, region)).toEqual(a);
    for (const n of a) expect(isWalkable(hub, n.position)).toBe(true);
    for (const g of hub.portals) for (const n of a) expect(Math.hypot(n.position[0] - g.position[0], n.position[1] - g.position[1])).toBeGreaterThan(1.5);
  });
  it("change with the day and the region", () => {
    const a = generateNodes(hub, region);
    const tomorrow = { ...region, dayKey: "2099-01-01" };
    expect(generateNodes(hub, tomorrow).map((n) => n.position)).not.toEqual(a.map((n) => n.position));
    const tokyo = tz("Asia/Tokyo");
    expect(generateNodes(hub, tokyo)[0].id).not.toBe(a[0].id);
  });
  it("only spawn finds the conditions allow", () => {
    const nightPolar: RegionContext = { ...tz("Arctic/Longyearbyen", at(23)), weather: "clear" };
    for (const area of world.areas)
      for (const n of generateNodes(area, nightPolar)) expect(isEligible(n.loot, { biome: "polar", timeOfDay: "night", weather: "clear", season: nightPolar.season })).toBe(true);
  });
});

describe("explore actions", () => {
  const hub = buildWorld([]).areas[0];
  const region = tz("Europe/Berlin");
  const nodes = generateNodes(hub, region);
  const target = nodes[0];
  const s0 = initialExploreState(emptyProgress());

  it("scan reveals nodes in radius, then cools down", () => {
    const s1 = exploreReducer(s0, { t: "scan", now: 1000, pos: target.position, nodes });
    expect(s1.revealed).toContain(target.id);
    for (const id of s1.revealed) {
      const n = nodes.find((x) => x.id === id)!;
      expect(Math.hypot(n.position[0] - target.position[0], n.position[1] - target.position[1])).toBeLessThanOrEqual(SCAN_RADIUS);
    }
    expect(s1.last).toMatchObject({ type: "scan" });
    const s2 = exploreReducer(s1, { t: "scan", now: 1000 + SCAN_COOLDOWN_MS - 1, pos: target.position, nodes });
    expect(s2.last?.type).toBe("scan-cooldown");
    expect(exploreReducer(s1, { t: "scan", now: 1000 + SCAN_COOLDOWN_MS, pos: target.position, nodes }).last?.type).toBe("scan");
  });

  it("collect needs a revealed node within reach, and only once", () => {
    const hidden = exploreReducer(s0, { t: "collect", now: 1, pos: target.position, nodes });
    expect(hidden.last).toMatchObject({ type: "nothing", action: "collect" });
    const s1 = exploreReducer(s0, { t: "scan", now: 1, pos: target.position, nodes });
    const far = exploreReducer(s1, { t: "collect", now: 2, pos: [target.position[0] + COLLECT_RADIUS + 0.5, target.position[1]], nodes });
    expect(far.last?.type).not.toBe("collect");
    const s2 = exploreReducer(s1, { t: "collect", now: 2, pos: target.position, nodes });
    expect(s2.last).toMatchObject({ type: "collect", firstTime: true });
    expect(s2.progress.inventory[target.loot.id]).toBe(1);
    expect(s2.progress.codexItems[target.loot.id]).toBe(region.dayKey);
    expect(s2.progress.collected).toContain(target.id);
    const again = exploreReducer(s2, { t: "collect", now: 3, pos: target.position, nodes });
    expect(again.progress.inventory[target.loot.id]).toBe(1);
  });

  it("inspect shows a nearby revealed node or a named item", () => {
    const s1 = exploreReducer(s0, { t: "scan", now: 1, pos: target.position, nodes });
    expect(exploreReducer(s1, { t: "inspect", now: 2, pos: target.position, nodes }).inspecting).toBe(target.loot.id);
    expect(exploreReducer(s0, { t: "inspect", now: 2, pos: [99, 99], nodes, itemId: "storm-core" }).inspecting).toBe("storm-core");
    expect(exploreReducer(s0, { t: "inspect", now: 2, pos: [99, 99], nodes }).last?.type).toBe("nothing");
  });

  it("reports availability with reasons", () => {
    const av = actionAvailability({ now: 0, scanReadyAt: 2500, canCollect: false, canInspect: true, nearPortal: false, hasCompanion: true });
    expect(av.scan).toEqual({ enabled: false, reason: "Recharging 3s" });
    expect(av.collect.enabled).toBe(false);
    expect(av.inspect.enabled).toBe(true);
    expect(av.jack.reason).toBe("Find a gate");
    expect(av.log.enabled).toBe(true);
  });
});

describe("progress", () => {
  it("parses tolerantly and prunes collected nodes to today", () => {
    expect(parseProgress("nope")).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 2 }))).toEqual(emptyProgress());
    const raw = JSON.stringify({
      version: 1,
      inventory: { "bit-dust": 3, bad: -1, worse: "x" },
      collected: ["tz-UTC:2026-06-10:hub:0", "tz-UTC:2026-06-09:hub:1", 5],
      codexItems: { "bit-dust": "2026-06-09" },
      regions: { "tz-UTC": { label: "UTC", biome: "urban", firstSeen: "2026-06-09", lastSeen: "2026-06-09", days: 1 }, broken: {} },
    });
    const p = parseProgress(raw, "2026-06-10");
    expect(p.inventory).toEqual({ "bit-dust": 3 });
    expect(p.collected).toEqual(["tz-UTC:2026-06-10:hub:0"]);
    expect(Object.keys(p.regions)).toEqual(["tz-UTC"]);
  });
  it("counts distinct days per region and stores no coordinates", () => {
    const r = tz("Asia/Tokyo");
    const p1 = visitRegion(emptyProgress(), r);
    expect(visitRegion(p1, r)).toBe(p1);
    const p2 = visitRegion(p1, { ...r, dayKey: "2099-01-01" });
    expect(p2.regions[r.key].days).toBe(2);
    expect(JSON.stringify(p2)).not.toMatch(/139\.7|35\.7/);
  });
});

describe("weather", () => {
  it("builds the Open-Meteo URL and parses the response", () => {
    expect(openMeteoUrl(40.75, -74.25)).toContain("latitude=40.75");
    expect(parseOpenMeteo({ elevation: 12, current: { weather_code: 61 } })).toEqual({ code: 61, elevation: 12 });
    expect(parseOpenMeteo(null)).toEqual({ code: null, elevation: null });
  });
  it("caches per cell and degrades to unknown", async () => {
    window.localStorage.removeItem(WEATHER_CACHE_KEY);
    let calls = 0;
    const ok = (async () => {
      calls++;
      return new Response(JSON.stringify({ elevation: 3, current: { weather_code: 95 } }));
    }) as unknown as typeof fetch;
    expect(await fetchWeather("cell-a", 1, 2, 1000, ok)).toEqual({ weather: "storm", elevation: 3 });
    expect(await fetchWeather("cell-a", 1, 2, 2000, ok)).toEqual({ weather: "storm", elevation: 3 });
    expect(calls).toBe(1);
    expect(window.localStorage.getItem(WEATHER_CACHE_KEY)).not.toMatch(/"lat|"lon/);
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchWeather("cell-b", 1, 2, 3000, boom)).toEqual({ weather: "unknown", elevation: null });
    window.localStorage.removeItem(WEATHER_CACHE_KEY);
  });
});

describe("companion", () => {
  const region = tz("Europe/Berlin");
  it("comments on events deterministically", () => {
    const ev = { type: "collect" as const, loot: LOOT_BY_ID["seed-byte"], firstTime: true, at: 5 };
    expect(companionLine("Serenity", ev, region)).toBe(companionLine("Serenity", ev, region));
    expect(companionLine("Serenity", ev, region)).toContain("Seed Byte");
    expect(companionLine("Serenity", null, region)).toBeNull();
    expect(systemLine({ type: "scan", found: 0, best: null, at: 1 })).toMatch(/no signals/);
  });
});
