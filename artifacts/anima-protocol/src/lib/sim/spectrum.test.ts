import { describe, expect, it } from "vitest";
import { BANDS } from "./engine";
import { RESONANCE_SPECTRUM } from "@/styles/anima-tokens";

describe("sim W axis ↔ design tokens", () => {
  it("uses the same bands, ranges and colours as Figma/anima-tokens", () => {
    expect(BANDS.map((b) => [b.key, b.min, b.max, b.color.toLowerCase()])).toEqual(
      RESONANCE_SPECTRUM.map((b) => [b.key, b.min, b.max, b.color.toLowerCase()]),
    );
  });
});
