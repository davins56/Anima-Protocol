/**
 * Data Bazaar economy. Pure functions over the exploration Progress (same
 * localStorage persistence), so pricing, affordability, exchange math and
 * inventory mutations are all unit-tested.
 *
 *  - Wallet: fragment-kind finds are the currency, valued in "bits" by rarity.
 *    Paying spends the lowest-value fragments first (no change is given).
 *  - Shop: boosters, gifts and cosmetics, priced by rarity.
 *  - Exchange: trade N finds of one rarity up for one of the next tier, plus
 *    biome-native item swaps; both rotate daily (seeded by date).
 *  - Gifts: any gift or found item can be given to a companion.
 */
import { LOOT, LOOT_BY_ID, type LootDef, type Rarity } from "../explore/loot";
import type { Progress } from "../explore/progress";
import { hashString, mulberry32 } from "../explore/rng";

export const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Bits per fragment, by rarity. */
export const FRAGMENT_VALUE: Record<Rarity, number> = { common: 1, uncommon: 3, rare: 8, epic: 20, legendary: 50 };
/** Shop price in bits, by rarity. */
export const PRICE: Record<Rarity, number> = { common: 6, uncommon: 15, rare: 30, epic: 60, legendary: 120 };
/** Finds of a rarity needed to trade up one tier. */
export const TRADE_UP_COST: Partial<Record<Rarity, number>> = { common: 5, uncommon: 4, rare: 3, epic: 3 };
/** Boosted scans granted per Scan Booster. */
export const BOOSTER_SCANS = 3;

export type ShopKind = "booster" | "gift" | "cosmetic";
export type CosmeticSlot = "visor" | "trail";
export type ShopItem = { id: string; name: string; kind: ShopKind; rarity: Rarity; desc: string; slot?: CosmeticSlot; color?: string };

export const SHOP: readonly ShopItem[] = [
  { id: "shop:scan-booster", name: "Scan Booster", kind: "booster", rarity: "uncommon", desc: `Your next ${BOOSTER_SCANS} scans reach 50% farther.` },
  { id: "shop:data-bouquet", name: "Data Bouquet", kind: "gift", rarity: "common", desc: "Little packets arranged like flowers. A sweet gift." },
  { id: "shop:music-box", name: "Music Box", kind: "gift", rarity: "rare", desc: "Plays a loop someone hummed into the net years ago." },
  { id: "shop:visor-sunset", name: "Visor Tint · Sunset", kind: "cosmetic", rarity: "uncommon", slot: "visor", color: "#FF9A3C", desc: "Your navi's visor glows orange." },
  { id: "shop:visor-sakura", name: "Visor Tint · Sakura", kind: "cosmetic", rarity: "uncommon", slot: "visor", color: "#FF4FA3", desc: "Your navi's visor glows pink." },
  { id: "shop:neon-trail", name: "Neon Trail", kind: "cosmetic", rarity: "rare", slot: "trail", color: "#39E6FF", desc: "Leave a short trail of light cubes as you walk." },
];
export const SHOP_BY_ID: Record<string, ShopItem> = Object.fromEntries(SHOP.map((s) => [s.id, s]));

export const price = (item: Pick<ShopItem, "rarity">): number => PRICE[item.rarity];

export type Cosmetics = { owned: string[]; equipped: Partial<Record<CosmeticSlot, string>> };
export const cosmeticsOf = (p: Progress): Cosmetics => p.cosmetics ?? { owned: [], equipped: {} };

/** Spendable fragments in the inventory, cheapest first. */
function fragments(inv: Record<string, number>): { def: LootDef; count: number }[] {
  return Object.entries(inv)
    .map(([id, count]) => ({ def: LOOT_BY_ID[id], count }))
    .filter((x): x is { def: LootDef; count: number } => !!x.def && x.def.kind === "fragment" && x.count > 0)
    .sort((a, b) => FRAGMENT_VALUE[a.def.rarity] - FRAGMENT_VALUE[b.def.rarity] || a.def.id.localeCompare(b.def.id));
}

export function walletBits(inv: Record<string, number>): number {
  return fragments(inv).reduce((s, f) => s + FRAGMENT_VALUE[f.def.rarity] * f.count, 0);
}

export const canAfford = (inv: Record<string, number>, bits: number): boolean => walletBits(inv) >= bits;

/** Spend `bits` worth of fragments, lowest value first. Returns null if unaffordable. */
export function payBits(inv: Record<string, number>, bits: number): Record<string, number> | null {
  if (!canAfford(inv, bits)) return null;
  const out = { ...inv };
  let due = bits;
  for (const f of fragments(inv)) {
    const v = FRAGMENT_VALUE[f.def.rarity];
    while (due > 0 && out[f.def.id] > 0) {
      out[f.def.id] -= 1;
      due -= v;
    }
    if (out[f.def.id] === 0) delete out[f.def.id];
    if (due <= 0) break;
  }
  return out;
}

const add = (inv: Record<string, number>, id: string, n = 1): Record<string, number> => {
  const out = { ...inv, [id]: (inv[id] ?? 0) + n };
  if (out[id] <= 0) delete out[id];
  return out;
};

export type TradeResult = { ok: true; progress: Progress; message: string } | { ok: false; reason: string };

/** Buy a shop item: boosters stack scans, gifts stack, cosmetics are owned once and auto-equipped. */
export function buy(p: Progress, itemId: string): TradeResult {
  const item = SHOP_BY_ID[itemId];
  if (!item) return { ok: false, reason: "Not for sale" };
  const cos = cosmeticsOf(p);
  if (item.kind === "cosmetic" && cos.owned.includes(item.id)) return { ok: false, reason: "Already owned" };
  const paid = payBits(p.inventory, price(item));
  if (!paid) return { ok: false, reason: `Needs ${price(item)} bits` };
  if (item.kind === "cosmetic" && item.slot) {
    return { ok: true, progress: { ...p, inventory: paid, cosmetics: { owned: [...cos.owned, item.id], equipped: { ...cos.equipped, [item.slot]: item.id } } }, message: `Equipped ${item.name}` };
  }
  const n = item.kind === "booster" ? BOOSTER_SCANS : 1;
  return { ok: true, progress: { ...p, inventory: add(paid, item.id, n) }, message: `Bought ${item.name}` };
}

/** Toggle an owned cosmetic on/off in its slot. */
export function toggleEquip(p: Progress, itemId: string): Progress {
  const item = SHOP_BY_ID[itemId];
  const cos = cosmeticsOf(p);
  if (!item?.slot || !cos.owned.includes(itemId)) return p;
  const equipped = { ...cos.equipped };
  if (equipped[item.slot] === itemId) delete equipped[item.slot];
  else equipped[item.slot] = itemId;
  return { ...p, cosmetics: { ...cos, equipped } };
}

/* ── Exchange ─────────────────────────────────────────────────────────── */

export type TradeUpOffer = { from: Rarity; n: number; toId: string };
export type SwapOffer = { giveId: string; getId: string };
export type DailyOffers = { dayKey: string; tradeUps: TradeUpOffer[]; swaps: SwapOffer[] };

const native = (r: Rarity) => LOOT.filter((l) => l.rarity === r && l.biomes !== "any" && !l.time && !l.weather && !l.season);

/** Today's exchange board: one trade-up target per tier and two biome swaps. Same for everyone on a date. */
export function dailyOffers(dayKey: string): DailyOffers {
  const rnd = mulberry32(hashString(`bazaar|${dayKey}`));
  const tradeUps: TradeUpOffer[] = [];
  for (const from of RARITY_ORDER) {
    const n = TRADE_UP_COST[from];
    if (!n) continue;
    const next = RARITY_ORDER[RARITY_ORDER.indexOf(from) + 1];
    const pool = LOOT.filter((l) => l.rarity === next);
    if (pool.length) tradeUps.push({ from, n, toId: pool[Math.floor(rnd() * pool.length)].id });
  }
  const swaps: SwapOffer[] = [];
  for (const r of ["common", "uncommon"] as const) {
    const pool = native(r);
    if (pool.length < 2) continue;
    const a = pool[Math.floor(rnd() * pool.length)];
    const others = pool.filter((l) => JSON.stringify(l.biomes) !== JSON.stringify(a.biomes));
    const b = others[Math.floor(rnd() * others.length)];
    if (b) swaps.push({ giveId: a.id, getId: b.id });
  }
  return { dayKey, tradeUps, swaps };
}

/** Finds of a rarity that can be traded in (fragments first, then items/lore), with counts. */
export function tradeableOf(inv: Record<string, number>, r: Rarity): { id: string; count: number }[] {
  return Object.entries(inv)
    .filter(([id, n]) => n > 0 && LOOT_BY_ID[id]?.rarity === r)
    .map(([id, count]) => ({ id, count, frag: LOOT_BY_ID[id].kind === "fragment" ? 0 : 1 }))
    .sort((a, b) => a.frag - b.frag || a.id.localeCompare(b.id))
    .map(({ id, count }) => ({ id, count }));
}

const gain = (p: Progress, inventory: Record<string, number>, id: string, dayKey: string): Progress => ({
  ...p,
  inventory: add(inventory, id),
  codexItems: p.codexItems[id] ? p.codexItems : { ...p.codexItems, [id]: dayKey },
});

export function tradeUp(p: Progress, offer: TradeUpOffer, dayKey: string): TradeResult {
  const have = tradeableOf(p.inventory, offer.from);
  if (have.reduce((s, x) => s + x.count, 0) < offer.n) return { ok: false, reason: `Needs ${offer.n} ${offer.from} finds` };
  let inv = { ...p.inventory };
  let due = offer.n;
  for (const x of have) {
    const take = Math.min(due, x.count);
    inv = add(inv, x.id, -take);
    due -= take;
    if (!due) break;
  }
  const to = LOOT_BY_ID[offer.toId];
  return { ok: true, progress: gain(p, inv, offer.toId, dayKey), message: `Traded up for ${to?.name ?? offer.toId}` };
}

export function swap(p: Progress, offer: SwapOffer, dayKey: string): TradeResult {
  if ((p.inventory[offer.giveId] ?? 0) < 1) return { ok: false, reason: `Needs 1 ${LOOT_BY_ID[offer.giveId]?.name ?? offer.giveId}` };
  return { ok: true, progress: gain(p, add(p.inventory, offer.giveId, -1), offer.getId, dayKey), message: `Swapped for ${LOOT_BY_ID[offer.getId]?.name ?? offer.getId}` };
}

/* ── Gifts ────────────────────────────────────────────────────────────── */

export type Giftable = { id: string; name: string; count: number; special: boolean };

/** Gift-shop items first, then found items (not fragments or boosters). */
export function giftables(inv: Record<string, number>): Giftable[] {
  const out: Giftable[] = [];
  for (const [id, count] of Object.entries(inv)) {
    if (count <= 0) continue;
    const s = SHOP_BY_ID[id];
    if (s?.kind === "gift") out.push({ id, name: s.name, count, special: true });
    const l = LOOT_BY_ID[id];
    if (l && l.kind !== "fragment") out.push({ id, name: l.name, count, special: false });
  }
  return out.sort((a, b) => Number(b.special) - Number(a.special) || a.name.localeCompare(b.name));
}

export function giftName(id: string): string {
  return SHOP_BY_ID[id]?.name ?? LOOT_BY_ID[id]?.name ?? id;
}

/** Remove one gift from the inventory. Social satisfaction scales with the gift (shop gifts / rarer finds count more). */
export function give(p: Progress, itemId: string): { ok: true; progress: Progress; strength: number } | { ok: false; reason: string } {
  if (!giftables(p.inventory).some((g) => g.id === itemId)) return { ok: false, reason: "Nothing to give" };
  const r = SHOP_BY_ID[itemId]?.rarity ?? LOOT_BY_ID[itemId]?.rarity ?? "common";
  const strength = Math.min(1, 0.55 + RARITY_ORDER.indexOf(r) * 0.12 + (SHOP_BY_ID[itemId] ? 0.1 : 0));
  return { ok: true, progress: { ...p, inventory: add(p.inventory, itemId, -1) }, strength };
}
