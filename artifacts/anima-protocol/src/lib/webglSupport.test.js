import { describe, expect, it } from "vitest";
import { hasWebGL } from "./webglSupport";

describe("hasWebGL", () => {
  it("returns a boolean without throwing", () => {
    expect(typeof hasWebGL()).toBe("boolean");
  });
});
