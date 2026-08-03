import { describe, it, expect } from "vitest";
import { parseCompanion } from "../src/routes/openai/functions";

describe("parseCompanion", () => {
  it("parses a clean JSON object with an array of traits", () => {
    const raw = JSON.stringify({
      name: "Sherlock Holmes",
      universe: "Sir Arthur Conan Doyle's stories",
      category: "Detective",
      tagline: "The world's only consulting detective.",
      personality: "Brilliant, observant, and aloof.",
      backstory: "A consulting detective living at 221B Baker Street.",
      speaking_style: "Precise, deductive, occasionally condescending.",
      traits: ["analytical", "observant", "eccentric"],
      is_real_character: true,
    });
    const c = parseCompanion(raw);
    expect(c.name).toBe("Sherlock Holmes");
    expect(c.category).toBe("Detective");
    expect(c.traits).toBe("analytical, observant, eccentric");
    expect(c.is_real_character).toBe(true);
  });

  it("strips markdown code fences before parsing", () => {
    const raw = "```json\n" + JSON.stringify({ name: "Aria", traits: "kind" }) + "\n```";
    const c = parseCompanion(raw);
    expect(c.name).toBe("Aria");
    expect(c.traits).toBe("kind");
    expect(c.is_real_character).toBe(false);
  });

  it("extracts JSON when surrounded by prose", () => {
    const raw = 'Here is your companion: { "name": "Nova", "universe": "Deep space" } Hope you like it!';
    const c = parseCompanion(raw);
    expect(c.name).toBe("Nova");
    expect(c.universe).toBe("Deep space");
  });

  it("accepts a string traits value and trims it", () => {
    const raw = JSON.stringify({ name: "X", traits: "  brave, loyal  " });
    expect(parseCompanion(raw).traits).toBe("brave, loyal");
  });

  it("filters non-string / empty entries out of a traits array", () => {
    const raw = JSON.stringify({ name: "X", traits: ["brave", "", 5, "  loyal  "] });
    expect(parseCompanion(raw).traits).toBe("brave, loyal");
  });

  it("coerces a non-boolean is_real_character to false", () => {
    const raw = JSON.stringify({ name: "X", is_real_character: "true" });
    expect(parseCompanion(raw).is_real_character).toBe(false);
  });

  it("returns the empty shape on malformed input", () => {
    const c = parseCompanion("not json at all");
    expect(c).toEqual({
      name: "",
      universe: "",
      category: "",
      tagline: "",
      personality: "",
      backstory: "",
      speaking_style: "",
      traits: "",
      is_real_character: false,
    });
  });

  it("defaults missing fields to empty strings", () => {
    const c = parseCompanion(JSON.stringify({ name: "Solo" }));
    expect(c.name).toBe("Solo");
    expect(c.universe).toBe("");
    expect(c.personality).toBe("");
  });
});
