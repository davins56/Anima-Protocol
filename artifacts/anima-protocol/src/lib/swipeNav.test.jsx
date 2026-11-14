// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import { APP_SWIPE_EXCLUDE } from "./swipeNav";

function Harness({ onLeft, onRight }) {
  useSwipeGestures({ onSwipeLeft: onLeft, onSwipeRight: onRight, excludeSelector: APP_SWIPE_EXCLUDE });
  return (
    <div>
      <div data-testid="page">plain page</div>
      {/* Cyberworld's shape: an R3F canvas under the page root. */}
      <div data-testid="world-root">
        <div><canvas data-testid="scene" /></div>
      </div>
      <div data-no-swipe><button type="button" data-testid="dpad">▶</button></div>
    </div>
  );
}

function touch(el, type, x, y) {
  const t = { identifier: 1, target: el, clientX: x, clientY: y };
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [t] });
  Object.defineProperty(e, "changedTouches", { value: [t] });
  el.dispatchEvent(e);
}

/** A 300px horizontal drag, as orbiting the Cyberworld camera on an iPad is. */
function drag(el, dx) {
  touch(el, "touchstart", 400, 500);
  touch(el, "touchend", 400 + dx, 505);
}

afterEach(cleanup);

describe("app-wide swipe navigation exclusions", () => {
  it("still navigates on a plain page swipe", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const { getByTestId } = render(<Harness onLeft={onLeft} onRight={onRight} />);
    drag(getByTestId("page"), 300);
    drag(getByTestId("page"), -300);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it("ignores horizontal drags on a 3D canvas (Cyberworld orbit / walk)", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const { getByTestId } = render(<Harness onLeft={onLeft} onRight={onRight} />);
    drag(getByTestId("scene"), 300);
    drag(getByTestId("scene"), -300);
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("ignores drags inside [data-no-swipe] surfaces (game HUD, d-pad)", () => {
    const onRight = vi.fn();
    const { getByTestId } = render(<Harness onLeft={() => {}} onRight={onRight} />);
    drag(getByTestId("dpad"), 300);
    expect(onRight).not.toHaveBeenCalled();
  });

  it("is the selector ProtocolApp hands the global swipe handler", () => {
    const app = readFileSync(resolve(__dirname, "../ProtocolApp.jsx"), "utf8");
    expect(app).toMatch(/useSwipeGestures\(\{[^}]*excludeSelector:\s*APP_SWIPE_EXCLUDE/s);
    expect(APP_SWIPE_EXCLUDE.split(",").map((s) => s.trim())).toEqual(
      expect.arrayContaining(["canvas", "[data-no-swipe]", "input", "textarea"]),
    );
  });

  it("Cyberworld's page root opts out of swipe navigation", () => {
    const page = readFileSync(resolve(__dirname, "../features/cyberworld/CyberworldPage.tsx"), "utf8");
    expect(page).toMatch(/data-net-hud="cyberworld"[^>]*data-no-swipe/);
  });
});
