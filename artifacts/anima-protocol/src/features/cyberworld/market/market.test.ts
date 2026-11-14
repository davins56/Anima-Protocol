import { describe, expect, it } from "vitest";
import { areaById, buildWorld, travel, validateWorld } from "../areas";
import { isWalkable } from "../collision";
import { exploreReducer, initialExploreState, SCAN_RADIUS } from "../explore/actions";
import { LOOT_BY_ID } from "../explore/loot";
import { emptyProgress, parseProgress, type Progress } from "../explore/progress";
import { destinationsFor } from "../journey/choose";
import { initTraveller } from "../journey/journeys";
import { toMemoryEventRow } from "../journey/log";
import { HUB_AREA_ID, homeZoneId } from "../layout";
import { MOCK_ANIMAS } from "../mockAnimas";
import { buildMarketArea, HUB_MARKET_GATE_ID, MARKET_AREA_ID, nearVendor, VENDOR_POINT } from "./area";
import { buy, canAfford, dailyOffers, give, giftables, payBits, PRICE, SHOP, swap, toggleEquip, tradeUp, walletBits, BOOSTER_SCANS } from "./economy";
import { GIFT_ACTIVITY, receiveGift } from "./gift";

const withInv = (inventory: Record<string, number>): Progress => ({ ...emptyProgress(), inventory });

describe("wallet & pricing", () => {
  it("values fragments by rarity, ignores items, and prices shop goods by rarity", () => {
    expect(walletBits({ "stray-packet": 4, "echo-shard": 2, "pixel-fern": 9 })).toBe(4 + 6);
    expect(canAfford({ "stray-packet": 5 }, 6)).toBe(false);
    expect(canAfford({ "stray-packet": 6 }, 6)).toBe(true);
    expect(PRICE).toMatchObject({ common: 6, uncommon: 15, rare: 30 });
    for (const s of SHOP) expect(PRICE[s.rarity]).toBeGreaterThan(0);
  });

  it("pays cheapest fragments first and never touches items", () => {
    expect(payBits({ "stray-packet": 2, "echo-shard": 2, x: 1 }, 4)).toEqual({ "echo-shard": 1, x: 1 });
    expect(payBits({ "stray-packet": 1 }, 2)).toBeNull();
  });
});

describe("shop", () => {
  it("buys a booster stack, gifts and a cosmetic (owned once, auto-equipped, toggleable)", () => {
    let p = withInv({ "stray-packet": 40, "echo-shard": 10 });
    const b = buy(p, "shop:scan-booster");
    expect(b.ok && b.progress.inventory["shop:scan-booster"]).toBe(BOOSTER_SCANS);
    const c = buy(p, "shop:visor-sakura");
    if (!c.ok) throw new Error("expected purchase");
    p = c.progress;
    expect(p.cosmetics).toEqual({ owned: ["shop:visor-sakura"], equipped: { visor: "shop:visor-sakura" } });
    expect(buy(p, "shop:visor-sakura").ok).toBe(false);
    expect(toggleEquip(p, "shop:visor-sakura").cosmetics?.equipped.visor).toBeUndefined();
    expect(buy(withInv({}), "shop:data-bouquet")).toEqual({ ok: false, reason: "Needs 6 bits" });
  });

  it("persists cosmetics through the tolerant progress parser", () => {
    const raw = JSON.stringify({ ...withInv({}), cosmetics: { owned: ["shop:neon-trail", 5], equipped: { trail: "shop:neon-trail", visor: "nope" } } });
    expect(parseProgress(raw).cosmetics).toEqual({ owned: ["shop:neon-trail"], equipped: { trail: "shop:neon-trail" } });
    expect(parseProgress(JSON.stringify(withInv({}))).cosmetics).toBeUndefined();
  });

  it("a held Scan Booster widens one scan and is consumed", () => {
    const node = { id: "n1", position: [SCAN_RADIUS * 1.3, 0] as [number, number], loot: LOOT_BY_ID["stray-packet"] };
    const s0 = initialExploreState(withInv({ "shop:scan-booster": 1 }));
    const s1 = exploreReducer(s0, { t: "scan", now: 1, pos: [0, 0], nodes: [node] });
    expect(s1.revealed).toContain("n1");
    expect(s1.progress.inventory["shop:scan-booster"]).toBeUndefined();
    const s2 = exploreReducer(initialExploreState(withInv({})), { t: "scan", now: 1, pos: [0, 0], nodes: [node] });
    expect(s2.revealed).not.toContain("n1");
  });
});

describe("exchange", () => {
  it("daily offers are deterministic per date and point at the next tier", () => {
    const a = dailyOffers("2026-11-10");
    expect(dailyOffers("2026-11-10")).toEqual(a);
    expect(a.tradeUps.map((o) => [o.from, o.n])).toEqual([["common", 5], ["uncommon", 4], ["rare", 3], ["epic", 3]]);
    expect(LOOT_BY_ID[a.tradeUps[0].toId].rarity).toBe("uncommon");
    for (const s of a.swaps) {
      expect(LOOT_BY_ID[s.giveId].rarity).toBe(LOOT_BY_ID[s.getId].rarity);
      expect(LOOT_BY_ID[s.giveId].biomes).not.toEqual(LOOT_BY_ID[s.getId].biomes);
    }
    const days = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(dailyOffers(`2026-11-${10 + i}`))));
    expect(days.size).toBeGreaterThan(1);
  });

  it("trade-up consumes N finds of a tier (fragments first) and adds one of the next to inventory + codex", () => {
    const o = dailyOffers("2026-11-10").tradeUps[0];
    expect(tradeUp(withInv({ "stray-packet": 4 }), o, "2026-11-10").ok).toBe(false);
    const r = tradeUp(withInv({ "stray-packet": 3, "bit-dust": 3 }), o, "2026-11-10");
    if (!r.ok) throw new Error("expected trade");
    const left = Object.entries(r.progress.inventory).filter(([id]) => LOOT_BY_ID[id].rarity === "common").reduce((s, [, n]) => s + n, 0);
    expect(left).toBe(1);
    expect(r.progress.inventory[o.toId]).toBe(1);
    expect(r.progress.codexItems[o.toId]).toBe("2026-11-10");
  });

  it("swap gives one biome item for another", () => {
    const s = dailyOffers("2026-11-10").swaps[0];
    const r = swap(withInv({ [s.giveId]: 1 }), s, "2026-11-10");
    expect(r.ok && r.progress.inventory).toEqual({ [s.getId]: 1 });
    expect(swap(withInv({}), s, "d").ok).toBe(false);
  });
});

describe("gifts", () => {
  it("lists shop gifts first, removes one on give, and shop/rarer gifts count more", () => {
    const p = withInv({ "shop:data-bouquet": 2, "shop:music-box": 1, "stray-packet": 3, "shop:scan-booster": 2 });
    expect(giftables(p.inventory).map((g) => g.id)).toEqual(["shop:data-bouquet", "shop:music-box"]);
    const a = give(p, "shop:data-bouquet");
    const b = give(p, "shop:music-box");
    if (!a.ok || !b.ok) throw new Error("expected gift");
    expect(a.progress.inventory["shop:data-bouquet"]).toBe(1);
    expect(b.strength).toBeGreaterThan(a.strength);
    expect(give(p, "stray-packet").ok).toBe(false);
  });

  it("satisfies social need and emits a journey-compatible event", () => {
    const world = buildWorld(MOCK_ANIMAS);
    const t0 = initTraveller(world, MOCK_ANIMAS[0], "2026-11-10", Date.UTC(2026, 10, 10))!;
    const t = { ...t0, motives: { ...t0.motives, social: 0.9 } };
    const now = Date.UTC(2026, 10, 10, 12);
    const r = receiveGift(t, { itemId: "shop:music-box", itemName: "Music Box", areaId: MARKET_AREA_ID, strength: 0.8, now });
    expect(r.t.motives.social).toBeLessThan(0.9 * 0.3);
    expect(r.t.thought).toMatch(/Music Box/);
    expect(r.event).toMatchObject({ kind: "journey", activity: GIFT_ACTIVITY, motive: "social", targetId: "shop:music-box", reason: "you gave them Music Box" });
    const row = toMemoryEventRow(r.event, "u1");
    expect(row.event_type).toBe("cyberworld_journey");
    expect(row.payload).toMatchObject({ activity: GIFT_ACTIVITY, target_id: "shop:music-box" });
  });
});

describe("Data Bazaar area", () => {
  it.each([0, 1, 3, 5, 8])("is linked from the plaza and validates with %i residents", (n) => {
    const world = buildWorld(Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `A${i}` })));
    expect(validateWorld(world)).toEqual([]);
    const gate = areaById(world, HUB_AREA_ID)!.portals.find((p) => p.id === HUB_MARKET_GATE_ID)!;
    const landing = areaById(world, HUB_AREA_ID)!.portals.find((p) => p.id !== HUB_MARKET_GATE_ID)!;
    expect(Math.hypot(gate.position[0] - landing.position[0], gate.position[1] - landing.position[1])).toBeGreaterThan(3);
    const hop = travel(world, gate)!;
    expect(hop.area.id).toBe(MARKET_AREA_ID);
    expect(isWalkable(hop.area, hop.spawn)).toBe(true);
  });

  it("vendor is on walkable floor and detected only in the market", () => {
    const market = buildMarketArea();
    expect(isWalkable(market, VENDOR_POINT)).toBe(true);
    expect(nearVendor(MARKET_AREA_ID, VENDOR_POINT)).toBe(true);
    expect(nearVendor(HUB_AREA_ID, VENDOR_POINT)).toBe(false);
  });

  it("offers tagged destinations for every need", () => {
    const world = buildWorld(MOCK_ANIMAS);
    const ds = destinationsFor(world.areas, { homeZoneId: homeZoneId(MOCK_ANIMAS[0].id) }).filter((d) => d.areaId === MARKET_AREA_ID);
    const by = (id: string) => ds.find((d) => d.id === id)!;
    expect(by("market:stall-data").tags.needs.curiosity).toBeGreaterThan(0.5);
    expect(by("market:vendor").tags.needs.social).toBeGreaterThan(0.5);
    expect(by("market:stall-holo").tags.needs.creativity).toBeGreaterThan(0.5);
    expect(by("market:cafe").tags.needs.rest).toBeGreaterThan(0.5);
    expect(ds.flatMap((d) => d.tags.topics ?? [])).toEqual(expect.arrayContaining(["trade", "shopping", "gifts", "collecting"]));
  });
});
