import { describe, expect, it } from "vitest";
import {
  BATTLE_RENDERER,
  SERENITY_SILHOUETTE,
  resolveBattleModels,
  resolveEnemyModel,
  resolvePlayerModel,
  virusSilhouetteForName,
} from "./battleModels";

describe("virusSilhouetteForName", () => {
  it("maps catalog virus names to silhouettes", () => {
    expect(virusSilhouetteForName("Shade.Vrs")).toBe("shade");
    expect(virusSilhouetteForName("Static.Vrs")).toBe("static");
    expect(virusSilhouetteForName("Mettaur.Vrs")).toBe("mettaur");
    expect(virusSilhouetteForName("Halo.Vrs")).toBe("halo");
    expect(virusSilhouetteForName("Aegis.Vrs")).toBe("aegis");
  });

  it("falls back to mettaur for unknown names", () => {
    expect(virusSilhouetteForName("Unknown.Vrs")).toBe("mettaur");
    expect(virusSilhouetteForName("")).toBe("mettaur");
  });
});

describe("resolvePlayerModel", () => {
  it("always resolves Serenity's combat silhouette", () => {
    const model = resolvePlayerModel({
      name: "Serenity",
      avatar_url: "https://cdn.example/serenity.png",
      color: "#fde68a",
    });
    expect(model.silhouette).toBe(SERENITY_SILHOUETTE);
    expect(model.id).toBe("serenity");
    expect(model.texture_url).toBe("https://cdn.example/serenity.png");
    expect(model.renderer).toBe(BATTLE_RENDERER);
  });

  it("keeps a custom Anima name but still uses the Serenity navi body", () => {
    const model = resolvePlayerModel({ name: "Nyx" });
    expect(model.name).toBe("Nyx");
    expect(model.silhouette).toBe(SERENITY_SILHOUETTE);
  });

  it("rejects non-image urls for the face texture", () => {
    expect(resolvePlayerModel({ avatar_url: "javascript:alert(1)" }).texture_url).toBeNull();
  });
});

describe("resolveEnemyModel", () => {
  it("resolves a 3D virus from the catalog name", () => {
    const model = resolveEnemyModel({ name: "Aegis.Vrs", color: "#a5f3fc" });
    expect(model.silhouette).toBe("aegis");
    expect(model.color).toBe("#a5f3fc");
  });
});

describe("resolveBattleModels", () => {
  it("returns player + enemy descriptors for the R3F arena", () => {
    const models = resolveBattleModels({
      player: { name: "Serenity", color: "#67e8f9" },
      enemy: { name: "Shade.Vrs", color: "#fb7185" },
    });
    expect(models.renderer).toBe(BATTLE_RENDERER);
    expect(models.player.silhouette).toBe("serenity");
    expect(models.enemy.silhouette).toBe("shade");
  });
});
