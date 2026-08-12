import { describe, expect, it } from "vitest";
import { createCompositeAtlas } from "@/lib/universeWorldMap";

describe("createCompositeAtlas", () => {
  it("maps MCU Avengers characters to the United States corridor", () => {
    const atlas = createCompositeAtlas([
      {
        name: "Tony Stark",
        universe: "Marvel Cinematic Universe",
        backstory: "Founded and funded the Avengers from New York.",
      },
    ]);

    const marvel = atlas.worlds.find((world) => world.id === "mcu-avengers-earth");
    expect(marvel).toBeTruthy();
    expect(marvel.label).toContain("Avengers");
    expect(marvel.regions.find((region) => region.id === "avengers-us").characterCount).toBe(1);
  });

  it("populates Korra characters across the Four Nations world", () => {
    const atlas = createCompositeAtlas([
      {
        name: "Korra",
        universe: "Avatar: Legend of Korra",
        backstory: "The Avatar born into the Southern Water Tribe.",
      },
      {
        name: "Tenzin",
        universe: "Avatar: Legend of Korra",
        backstory: "An Airbending Master rebuilding the Air Nation.",
      },
    ]);

    const korra = atlas.worlds.find((world) => world.id === "korra-four-nations");
    expect(korra).toBeTruthy();
    expect(korra.regions.map((region) => region.name)).toEqual(
      expect.arrayContaining([
        "United Republic / Republic City",
        "Earth Kingdom",
        "Northern & Southern Water Tribes",
        "Fire Nation",
        "Air Nation",
      ]),
    );
    expect(korra.characterCount).toBe(2);
  });

  it("creates an uncharted world for custom character universes", () => {
    const atlas = createCompositeAtlas([
      { name: "Nyx", universe: "Crystal Archive", backstory: "Guardian of a floating library." },
    ]);

    expect(atlas.worlds).toHaveLength(1);
    expect(atlas.worlds[0]).toMatchObject({
      id: "custom-crystal-archive",
      label: "Uncharted Universe",
      characterCount: 1,
    });
  });

  it("projects saved locations into the shared map strip", () => {
    const atlas = createCompositeAtlas([], [
      { id: "loc_1", name: "Watchtower", x_coord: 50, y_coord: 25 },
    ]);

    expect(atlas.savedLocations[0]).toMatchObject({
      id: "loc_1",
      name: "Watchtower",
    });
    expect(atlas.savedLocations[0].mapX).toBeGreaterThan(1000);
    expect(atlas.savedLocations[0].mapY).toBeGreaterThan(1300);
  });
});
