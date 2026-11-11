import { describe, expect, it } from "vitest";
import { bandFor, placementFor } from "../src/lib/resonance/resonanceStore";

describe("resonance placement", () => {
  it("maps frequencies to bands", () => {
    expect(bandFor(3)).toBe("delta");
    expect(bandFor(42)).toBe("alpha");
    expect(bandFor(96.3)).toBe("omega");
    expect(bandFor(100)).toBe("omega");
  });
  it("places companions deterministically in alpha/beta", () => {
    const a = placementFor("char-123");
    expect(placementFor("char-123")).toEqual(a);
    expect(a.frequency).toBeGreaterThanOrEqual(30);
    expect(a.frequency).toBeLessThan(70);
    expect(["alpha", "beta"]).toContain(a.band);
  });
});
