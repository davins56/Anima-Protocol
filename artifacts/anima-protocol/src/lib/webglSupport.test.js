import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWebGL } from "./webglSupport";

describe("hasWebGL", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a boolean without throwing when WebGL is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    expect(hasWebGL()).toBe(false);
  });
});
