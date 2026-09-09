import { describe, expect, it } from "vitest";
import { presentEntityData } from "../src/lib/entityRecord";

describe("presentEntityData", () => {
  it("fills data.id from entityId when jsonb omitted it", () => {
    expect(
      presentEntityData({
        entityId: "seed_avatar-legend-of-korra-korra",
        data: { name: "Korra", universe: "Avatar: Legend of Korra" },
      }),
    ).toEqual({
      name: "Korra",
      universe: "Avatar: Legend of Korra",
      id: "seed_avatar-legend-of-korra-korra",
    });
  });

  it("keeps a usable jsonb id", () => {
    expect(
      presentEntityData({
        entityId: "row-1",
        data: { id: "char_custom", name: "Aelynd" },
      }),
    ).toMatchObject({ id: "char_custom", name: "Aelynd" });
  });

  it("replaces unusable jsonb ids", () => {
    expect(
      presentEntityData({
        entityId: "row-2",
        data: { id: "undefined", name: "Ghost" },
      }),
    ).toMatchObject({ id: "row-2", name: "Ghost" });
  });
});
