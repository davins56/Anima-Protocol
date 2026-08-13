import { describe, expect, it } from "vitest";
import {
  RENDERER_QUALITY,
  lowerRendererQuality,
  raiseRendererQuality,
  selectRendererQuality,
} from "./rendererQuality";

describe("renderer quality tiers", () => {
  it("honors reduced motion and low-memory devices", () => {
    expect(
      selectRendererQuality({
        reducedMotion: true,
        webgl2: true,
        deviceMemory: 16,
        hardwareConcurrency: 12,
      }),
    ).toBe(RENDERER_QUALITY.low);
    expect(
      selectRendererQuality({
        webgl2: true,
        deviceMemory: 2,
        hardwareConcurrency: 8,
      }),
    ).toBe(RENDERER_QUALITY.low);
  });

  it("selects high only for known capable devices", () => {
    expect(
      selectRendererQuality({
        webgl2: true,
        deviceMemory: 8,
        hardwareConcurrency: 8,
        pixelRatio: 2,
      }),
    ).toBe(RENDERER_QUALITY.high);
    expect(selectRendererQuality({ webgl2: true })).toBe(
      RENDERER_QUALITY.medium,
    );
  });

  it("adapts without exceeding the detected ceiling", () => {
    expect(lowerRendererQuality(RENDERER_QUALITY.high)).toBe(
      RENDERER_QUALITY.medium,
    );
    expect(
      raiseRendererQuality(RENDERER_QUALITY.low, RENDERER_QUALITY.medium),
    ).toBe(RENDERER_QUALITY.medium);
    expect(
      raiseRendererQuality(RENDERER_QUALITY.medium, RENDERER_QUALITY.medium),
    ).toBe(RENDERER_QUALITY.medium);
  });
});
