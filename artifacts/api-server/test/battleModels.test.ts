import { describe, expect, it } from "vitest";
import {
  BATTLE_RENDERER,
  SERENITY_SILHOUETTE,
  resolveBattleModels,
  resolveEnemyModel,
  resolvePlayerModel,
  virusSilhouetteForName,
} from "../src/lib/battleModels";

describe("virusSilhouetteForName", () => {
  it("maps catalog virus names to silhouettes", () => {
    expect(virusSilhouetteForName("Shade.Vrs")).toBe("shade");
    expect(virusSilhouetteForName("Aegis.Vrs")).toBe("aegis");
  });

  it("falls back to mettaur for unknown names", () => {
    expect(virusSilhouetteForName("Unknown.Vrs")).toBe("mettaur");
  });
});

describe("resolveBattleModels", () => {
  it("resolves Serenity and a virus into R3F descriptors", () => {
    const models = resolveBattleModels({
      player: {
        name: "Serenity",
        avatar_url: "https://cdn.example/serenity.png",
        color: "#67e8f9",
      },
      enemy: { name: "Shade.Vrs", color: "#fb7185" },
    });
    expect(models.renderer).toBe(BATTLE_RENDERER);
    expect(models.player.silhouette).toBe(SERENITY_SILHOUETTE);
    expect(models.player.texture_url).toBe("https://cdn.example/serenity.png");
    expect(models.enemy.silhouette).toBe("shade");
  });

  it("keeps a custom Anima name on the Serenity navi body", () => {
    const player = resolvePlayerModel({ name: "Nyx" });
    expect(player.name).toBe("Nyx");
    expect(player.silhouette).toBe(SERENITY_SILHOUETTE);
  });

  it("rejects unsafe texture urls", () => {
    expect(resolvePlayerModel({ avatar_url: "javascript:alert(1)" }).texture_url).toBeNull();
    expect(resolveEnemyModel({ name: "Halo.Vrs" }).silhouette).toBe("halo");
  });
});
