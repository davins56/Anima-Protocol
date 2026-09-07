import { describe, it, expect } from "vitest";
import { isEchoLibrarySteward } from "../echoKeys/steward.js";
import {
  ATTAINABLE_ITEMS,
  ATTAINABLE_ITEM_IDS,
  catalogItemIds,
  catalogItemToInventoryPayload,
  missingCatalogItems,
  selectStewardInventoryTargets,
  shouldGrantStewardInventory,
} from "./index.js";

const TYPES = ["gear", "weapon", "armor", "consumable", "artifact", "misc"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];
const BANNED = /^(cannon|hicannon|m-cannon|sword|wideswrd|protoman|gutsman|roll|bass|megaman)\b/i;

describe("attainable inventory catalog", () => {
  it("spans every item type and rarity with unique ids and names", () => {
    expect(ATTAINABLE_ITEMS.length).toBeGreaterThanOrEqual(40);
    expect(ATTAINABLE_ITEMS.length).toBeLessThan(200);
    expect(new Set(ATTAINABLE_ITEM_IDS).size).toBe(ATTAINABLE_ITEMS.length);
    expect(new Set(ATTAINABLE_ITEMS.map((i) => i.name)).size).toBe(ATTAINABLE_ITEMS.length);
    expect(catalogItemIds()).toEqual(ATTAINABLE_ITEM_IDS);
    for (const type of TYPES) {
      expect(ATTAINABLE_ITEMS.some((i) => i.type === type), type).toBe(true);
    }
    for (const rarity of RARITIES) {
      expect(ATTAINABLE_ITEMS.some((i) => i.rarity === rarity), rarity).toBe(true);
    }
  });

  it("uses original Anima Protocol names, not Capcom chip names", () => {
    for (const item of ATTAINABLE_ITEMS) {
      expect(BANNED.test(item.name)).toBe(false);
      expect(BANNED.test(item.id)).toBe(false);
      expect(item.description).toBeTruthy();
    }
  });
});

describe("steward inventory grant", () => {
  it("grants only to the Echo Key steward, not a generic admin", () => {
    expect(shouldGrantStewardInventory({ email: "davins56@gmail.com" })).toBe(true);
    expect(shouldGrantStewardInventory({ username: "davins56" })).toBe(true);
    expect(shouldGrantStewardInventory({
      externalAccounts: [{ provider: "oauth_github", username: "davins56" }],
    })).toBe(true);
    expect(shouldGrantStewardInventory({ role: "admin" })).toBe(false);
    expect(shouldGrantStewardInventory({ email: "seeker@example.com" })).toBe(false);
    expect(isEchoLibrarySteward({ email: "davins56@hotmail.com" })).toBe(false);
  });

  it("finds missing catalog rows by catalog_id, name, or catalog: trigger", () => {
    const existing = [
      { catalog_id: "pulse-brand" },
      { name: "Phantom Cleaver" },
      { narrative_triggers: ["catalog:lattice-rapier"] },
    ];
    const missing = missingCatalogItems(existing);
    expect(missing.map((i) => i.id)).not.toContain("pulse-brand");
    expect(missing.map((i) => i.id)).not.toContain("phantom-cleaver");
    expect(missing.map((i) => i.id)).not.toContain("lattice-rapier");
    expect(missing.length).toBe(ATTAINABLE_ITEMS.length - 3);
    expect(missingCatalogItems([]).length).toBe(ATTAINABLE_ITEMS.length);
  });

  it("builds an Inventory payload tagged with catalog_id", () => {
    const item = ATTAINABLE_ITEMS[0];
    const payload = catalogItemToInventoryPayload(item, "char-1", "sess-1");
    expect(payload.character_id).toBe("char-1");
    expect(payload.session_id).toBe("sess-1");
    expect(payload.catalog_id).toBe(item.id);
    expect(payload.name).toBe(item.name);
    expect(payload.narrative_triggers).toContain(`catalog:${item.id}`);
    expect(payload.equipped).toBe(false);
    expect(payload.quantity).toBe(1);
  });

  it("targets the selected character and Anima-linked rows, not bundled starters", () => {
    const selected = { id: "char-korra", name: "Korra" };
    const animas = [{ id: "anima-1", name: "Serenity" }];
    const characters = [
      selected,
      { id: "char-starter", name: "Link", _bundled: true },
      { id: "char-anima", name: "Nyx", _isAnima: true },
    ];
    const targets = selectStewardInventoryTargets({ selected, characters, animas });
    expect(targets.map((t) => t.id)).toEqual(["char-korra", "anima-1", "char-anima"]);
  });

  it("falls back to the first real character when nothing is selected", () => {
    const characters = [
      { id: "bundled", _bundled: true },
      { id: "char-1", name: "Primary" },
    ];
    const targets = selectStewardInventoryTargets({ characters, animas: [] });
    expect(targets.map((t) => t.id)).toEqual(["char-1"]);
  });
});
