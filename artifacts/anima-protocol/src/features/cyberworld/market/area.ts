/**
 * Data Bazaar: a market district reached from the plaza. Pure data like the
 * other areas — zones, paths, a return gate and voxel props (stalls, kiosks,
 * the vendor terminal, crates and holographic price boards). Several props
 * carry journey tags so companions come here for reasons (browse, haggle,
 * admire the holo-art, sit at the café).
 */
import { HUB_AREA_ID, PATH_WIDTH, PORTAL_RADIUS, rectZone, type Area, type AreaDecor, type Vec2 } from "../layout";

export const MARKET_AREA_ID = "market";
export const MARKET_GATE_ID = "market:to-hub";
export const HUB_MARKET_GATE_ID = "hub:to-market";
/** Where the vendor terminal stands; Inspect within VENDOR_RADIUS opens the market. */
export const VENDOR_POINT: Vec2 = [-7.6, 1.6];
export const VENDOR_RADIUS = 2.6;

export const MARKET_COLORS = { orange: "#FF9A3C", cyan: "#00EAFF", pink: "#FF4FA3", violet: "#8B5CF6", lime: "#A3FF4F" };

export function nearVendor(areaId: string, p: Vec2): boolean {
  return areaId === MARKET_AREA_ID && Math.hypot(p[0] - VENDOR_POINT[0], p[1] - VENDOR_POINT[1]) <= VENDOR_RADIUS;
}

export function buildMarketArea(): Area {
  const c = MARKET_COLORS;
  const decor: AreaDecor[] = [
    { kind: "billboard", id: "title", text: "DATA BAZAAR", position: [0, 4.4, -7.4], color: c.orange, height: 1.4 },
    { kind: "billboard", id: "sub", text: "fragments in · treasures out", position: [0, 3.3, -7.4], color: "#F1F5F9", height: 0.45 },
    // Stalls along the back of the trading floor.
    {
      kind: "prop", id: "market:stall-data", prop: "stall", position: [-5.4, 0, -4.6], color: c.cyan, label: "DATA",
      journey: { needs: { curiosity: 0.75 }, topics: ["trade", "shopping", "collecting", "tech"], activity: "browse the stalls", label: "the Bazaar stalls" },
    },
    { kind: "prop", id: "market:stall-relics", prop: "stall", position: [0, 0, -4.6], color: c.lime, label: "RELICS" },
    {
      kind: "prop", id: "market:stall-holo", prop: "stall", position: [5.4, 0, -4.6], color: c.pink, label: "HOLO-ART",
      journey: { needs: { creativity: 0.8, curiosity: 0.2 }, topics: ["art", "design", "collecting", "shopping"], activity: "admire the holo-art", label: "the holo-art stall" },
    },
    // The vendor terminal (opens the shop / exchange / gift panel).
    {
      kind: "prop", id: "market:vendor", prop: "terminal", position: [VENDOR_POINT[0], 0, VENDOR_POINT[1] - 0.9], yaw: Math.PI / 2, color: c.orange, label: "VENDOR",
      journey: { needs: { social: 0.8, curiosity: 0.2 }, topics: ["trade", "gifts", "shopping", "chat"], activity: "haggle with the vendor", label: "the Bazaar vendor" },
    },
    // Holographic price boards over the floor.
    { kind: "prop", id: "market:board-a", prop: "priceboard", position: [-2.8, 2.9, 1.4], color: c.cyan },
    {
      kind: "prop", id: "market:board-b", prop: "priceboard", position: [3.4, 2.9, 1.8], color: c.violet,
      journey: { needs: { creativity: 0.6, curiosity: 0.4 }, topics: ["art", "trade", "numbers", "collecting"], activity: "watch the holo price boards", label: "the price boards" },
    },
    { kind: "prop", id: "market:crates-a", prop: "crates", position: [8.6, 0, 4.6], color: c.orange },
    { kind: "prop", id: "market:crates-b", prop: "crates", position: [-8.8, 0, -4.8], color: c.cyan },
    { kind: "prop", id: "market:crates-c", prop: "crates", position: [-4.2, 0, 5.4], color: c.violet },
    // Café kiosk on its own little terrace.
    {
      kind: "prop", id: "market:cafe", prop: "kiosk", position: [15, 0, -1.6], color: c.pink, label: "CAFÉ",
      journey: { needs: { rest: 0.7, social: 0.2 }, topics: ["quiet", "coffee", "tea", "food"], activity: "sit at the café kiosk", label: "the café kiosk" },
    },
  ];
  return {
    id: MARKET_AREA_ID,
    label: "Data Bazaar",
    kind: "site",
    theme: { accent: c.orange, gridCell: "#3a1d08", gridSection: "#b45309" },
    zones: [
      rectZone({ id: "market:floor", kind: "site", label: "Trading Floor", center: [0, 0], size: [20, 13], color: c.orange, journey: { needs: { curiosity: 0.5, social: 0.3 }, topics: ["trade", "shopping", "crowds"], activity: "wander the trading floor" } }),
      rectZone({ id: "market:entry", kind: "site", label: "Bazaar Gate", center: [0, 12], size: [8, 5], color: c.cyan }),
      { id: "market:cafe-terrace", kind: "site", label: "Café Terrace", center: [14.5, -1], radius: 3.4, color: c.pink },
    ],
    paths: [
      { id: "market:entry-floor", from: "market:entry", to: "market:floor", width: PATH_WIDTH * 1.5, color: c.cyan },
      { id: "market:floor-cafe", from: "market:floor", to: "market:cafe-terrace", width: PATH_WIDTH * 1.2, color: c.pink },
    ],
    portals: [
      {
        id: MARKET_GATE_ID,
        label: "Central Plaza",
        position: [2.8, 12.6],
        radius: PORTAL_RADIUS,
        color: c.cyan,
        to: { area: HUB_AREA_ID, portal: HUB_MARKET_GATE_ID },
      },
    ],
    decor,
    spawn: [0, 10.5],
  };
}
