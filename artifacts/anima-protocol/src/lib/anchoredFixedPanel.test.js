import { afterEach, describe, expect, it } from "vitest";
import {
  computeAnchoredFixedStyle,
  readTabBarReservePx,
} from "./anchoredFixedPanel";

afterEach(() => {
  document.documentElement.style.removeProperty("--tab-bar-height");
});

describe("computeAnchoredFixedStyle", () => {
  const phoneAnchor = {
    top: 8,
    bottom: 48,
    left: 200,
    right: 310,
    width: 110,
    height: 40,
  };

  it("right-aligns under the trigger and caps height above the tab bar", () => {
    const style = computeAnchoredFixedStyle(phoneAnchor, {
      viewportWidth: 390,
      viewportHeight: 844,
      tabBarReserve: 90,
      maxHeightRatio: 0.7,
    });

    expect(style.position).toBe("fixed");
    expect(style.top).toBe(52);
    expect(style.right).toBe(80);
    expect(style.left).toBeUndefined();
    // available = 844 - 52 - 90 - 8 = 694; 70vh = 590.8
    expect(style.maxHeight).toBe(590.8);
  });

  it("uses remaining space when it is smaller than 70vh so the tab bar stays clear", () => {
    const style = computeAnchoredFixedStyle(
      { top: 400, bottom: 440, left: 100, right: 200, width: 100, height: 40 },
      {
        viewportWidth: 390,
        viewportHeight: 600,
        tabBarReserve: 80,
      },
    );

    expect(style.top).toBe(444);
    // available = 600 - 444 - 80 - 8 = 68
    expect(style.maxHeight).toBe(68);
  });

  it("left-aligns when requested", () => {
    const style = computeAnchoredFixedStyle(phoneAnchor, {
      align: "left",
      viewportWidth: 390,
      viewportHeight: 844,
      tabBarReserve: 0,
    });
    expect(style.left).toBe(200);
    expect(style.right).toBeUndefined();
  });
});

describe("readTabBarReservePx", () => {
  it("resolves --tab-bar-height through a live element", () => {
    document.documentElement.style.setProperty("--tab-bar-height", "72px");
    expect(readTabBarReservePx()).toBe(72);
  });

  it("treats an explicit 0px tab bar as no reserve", () => {
    document.documentElement.style.setProperty("--tab-bar-height", "0px");
    expect(readTabBarReservePx()).toBe(0);
  });
});
