import { describe, expect, it } from "vitest";
import {
  applyReservedTabBarHeight,
  measureVisibleTabBarHeight,
  syncReservedTabBarHeight,
} from "./tabBarLayout";

function fakeBar({ display = "flex", visibility = "visible", height = 64 } = {}) {
  return {
    getBoundingClientRect: () => ({ height }),
    offsetHeight: height,
    ownerDocument: document,
  };
}

describe("measureVisibleTabBarHeight", () => {
  it("reports absent when there is no tab bar", () => {
    expect(measureVisibleTabBarHeight(null)).toEqual({
      present: false,
      visible: false,
      height: null,
    });
  });

  it("treats display:none / visibility:hidden as present but not reserved", () => {
    const hidden = document.createElement("div");
    hidden.className = "tab-bar";
    hidden.style.display = "none";
    document.body.appendChild(hidden);
    expect(measureVisibleTabBarHeight(hidden)).toEqual({
      present: true,
      visible: false,
      height: 0,
    });
    hidden.remove();
  });

  it("returns the painted height of a visible bar", () => {
    const bar = fakeBar({ height: 68 });
    // jsdom getComputedStyle on a plain object is empty → treated as visible.
    expect(measureVisibleTabBarHeight(bar).height).toBe(68);
    expect(measureVisibleTabBarHeight(bar).visible).toBe(true);
  });
});

describe("applyReservedTabBarHeight", () => {
  it("zeroes the reservation while the keyboard is open", () => {
    const root = document.createElement("html");
    applyReservedTabBarHeight(
      root,
      { present: true, visible: true, height: 64 },
      { keyboardOpen: true },
    );
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
  });

  it("clears the JS override when the bar is not in the DOM (CSS fallback)", () => {
    const root = document.createElement("html");
    root.style.setProperty("--tab-bar-height", "0px");
    applyReservedTabBarHeight(root, {
      present: false,
      visible: false,
      height: null,
    });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("");
  });

  it("zeroes when the bar is mounted but hidden", () => {
    const root = document.createElement("html");
    applyReservedTabBarHeight(root, {
      present: true,
      visible: false,
      height: 0,
    });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
  });

  it("writes the measured height of a visible bar", () => {
    const root = document.createElement("html");
    applyReservedTabBarHeight(root, {
      present: true,
      visible: true,
      height: 72,
    });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("72px");
  });

  it("keeps the CSS fallback when a visible bar has not laid out yet", () => {
    const root = document.createElement("html");
    applyReservedTabBarHeight(root, {
      present: true,
      visible: true,
      height: 0,
    });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("");
  });
});

describe("syncReservedTabBarHeight", () => {
  it("does not invent a 0px reservation when no .tab-bar exists", () => {
    const root = document.createElement("html");
    const measured = syncReservedTabBarHeight(root);
    expect(measured.present).toBe(false);
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("");
  });

  it("prefers a .tab-bar under the root over the document", () => {
    const root = document.createElement("div");
    const bar = document.createElement("div");
    bar.className = "tab-bar";
    Object.defineProperty(bar, "offsetHeight", { value: 60, configurable: true });
    bar.getBoundingClientRect = () => /** @type {DOMRect} */ ({ height: 60 });
    root.appendChild(bar);

    syncReservedTabBarHeight(root);
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("60px");
  });
});
