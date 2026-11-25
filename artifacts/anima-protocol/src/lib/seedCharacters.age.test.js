import { describe, expect, it } from "vitest";
import { getStarterRoster, withCharacterAge } from "./seedCharacters";

describe("starter character ages", () => {
  it("marks canon minors as not adult and known adults as adult", () => {
    const roster = getStarterRoster();
    const byName = Object.fromEntries(roster.map((c) => [c.name, c]));
    expect(byName.Jinora).toMatchObject({ age: 15, age_is_adult: false });
    expect(byName.Sprite).toMatchObject({ age: 11, age_is_adult: false });
    expect(byName["Peter Parker"]).toMatchObject({ age: 17, age_is_adult: false });
    expect(byName["Mark Grayson"]).toMatchObject({ age: 17, age_is_adult: false });
    expect(byName.Korra).toMatchObject({ age_is_adult: true });
    expect(byName["Natasha Romanoff"]).toMatchObject({ age_is_adult: true });
  });

  it("defaults an unknown card to not adult", () => {
    expect(withCharacterAge({ name: "Original Companion" })).toEqual({
      name: "Original Companion",
      age_is_adult: false,
    });
  });

  it("puts an age on every starter card", () => {
    for (const c of getStarterRoster()) {
      expect(c).toHaveProperty("age_is_adult");
      if (c.age_is_adult) expect(c.age).toBeGreaterThanOrEqual(18);
      else if (typeof c.age === "number") expect(c.age).toBeLessThan(18);
    }
  });
});
