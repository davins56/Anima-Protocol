import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ErrorBoundary from "@/components/ErrorBoundary";

// The ErrorBoundary is the app's only safety net against a render-phase throw
// blanking the entire screen (App.full.jsx wraps <Routes> in it, keyed on
// location.pathname). These tests pin the three guarantees that matter:
//   1. a child that throws yields the on-brand recovery panel, not a blank tree
//   2. changing resetKey (a route change) auto-clears the error so navigating
//      away recovers without a manual reload
//   3. componentDidCatch logs to the console AND fires best-effort analytics
//      without letting a reporting failure escape

// Record analytics calls instead of touching the real (consent-gated) client.
// `trackImpl.fn` is swappable so a test can make reporting throw.
const trackCalls = [];
const defaultTrack = (...args) => {
  trackCalls.push(args);
};
const trackImpl = { fn: defaultTrack };
vi.mock("@/lib/analytics", () => ({
  track: (...args) => trackImpl.fn(...args),
}));

// A child that throws on demand during render.
function Boom({ explode }) {
  if (explode) throw new Error("kaboom");
  return <div data-testid="ok">all good</div>;
}

let container;
let root;
let consoleErrorSpy;

// The boundary stays silent for AUTO_HEAL_DELAY_MS (700ms) on the first crash,
// attempting one in-place remount before it ever shows the alarm panel. Tests
// use fake timers to drive past that window deterministically.
const AUTO_HEAL_DELAY_MS = 700;

beforeEach(() => {
  vi.useFakeTimers();
  trackCalls.length = 0;
  trackImpl.fn = defaultTrack;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // React logs caught errors to console.error; silence + capture it so the
  // suite output stays clean and we can assert the boundary's own log fired.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleErrorSpy.mockRestore();
  vi.useRealTimers();
});

// Let the silent auto-heal attempt fire (and fail, if the child still throws),
// so the persistent-crash panel is on screen.
function advancePastAutoHeal() {
  act(() => {
    vi.advanceTimersByTime(AUTO_HEAL_DELAY_MS + 50);
  });
}

describe("ErrorBoundary", () => {
  it("shows the on-brand recovery panel when a child throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode />
        </ErrorBoundary>,
      );
    });

    // First crash is silent — the boundary tries to heal itself, no alarm panel.
    expect(container.textContent).not.toContain("Something went wrong");
    expect(container.querySelector('[data-testid="ok"]')).toBeNull();

    // The auto-heal retry also fails (the child always throws), so the panel
    // takes over.
    advancePastAutoHeal();

    // Recovery panel content is shown instead of a blank tree.
    expect(container.textContent).toContain("Something went wrong");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((b) => /reload/i.test(b.textContent))).toBe(true);
    expect(buttons.some((b) => /self-repair/i.test(b.textContent))).toBe(true);
    // The thrown child is NOT in the DOM.
    expect(container.querySelector('[data-testid="ok"]')).toBeNull();
  });

  it("renders children normally when nothing throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Something went wrong");
  });

  it("auto-recovers when the reset key (route) changes", () => {
    // First render throws -> after the silent heal retry fails, panel shown.
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    advancePastAutoHeal();
    expect(container.textContent).toContain("Something went wrong");

    // Navigate away: resetKey changes AND the new child no longer throws. The
    // boundary must clear its error and render the healthy child.
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/b">
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Something went wrong");
  });

  it("does NOT recover when an unrelated re-render keeps the same reset key", () => {
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    advancePastAutoHeal();
    expect(container.textContent).toContain("Something went wrong");

    // Same resetKey: a healthy child re-render must NOT silently clear a real
    // error (otherwise a parent re-render would flash the broken screen back).
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("Something went wrong");
    expect(container.querySelector('[data-testid="ok"]')).toBeNull();
  });

  it("logs to the console and fires best-effort analytics on catch", () => {
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode />
        </ErrorBoundary>,
      );
    });

    // Our own boundary log fired (alongside React's dev logging).
    expect(
      consoleErrorSpy.mock.calls.some(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("[ErrorBoundary] caught render error:"),
      ),
    ).toBe(true);

    // Analytics was called with the event name + the error message.
    expect(trackCalls).toHaveLength(1);
    const [eventName, props] = trackCalls[0];
    expect(eventName).toBe("Error Boundary Triggered");
    expect(props.message).toBe("kaboom");
    expect(typeof props.component_stack).toBe("string");
  });

  it("does not throw if analytics reporting itself fails", () => {
    // componentDidCatch wraps track() in try/catch so a reporting failure can
    // never turn into a second crash. Make track throw and prove the panel
    // still renders.
    trackCalls.length = 0;
    const original = trackImpl.fn;
    trackImpl.fn = () => {
      throw new Error("analytics down");
    };

    expect(() => {
      act(() => {
        root.render(
          <ErrorBoundary resetKey="/a">
            <Boom explode />
          </ErrorBoundary>,
        );
      });
      advancePastAutoHeal();
    }).not.toThrow();

    expect(container.textContent).toContain("Something went wrong");
    trackImpl.fn = original;
  });

  it("auto-heals a transient crash in place without showing the panel", () => {
    // Model a transient crash: the child throws while `down` is true (a race, a
    // momentarily-missing value). The boundary stays SILENT (no alarm panel),
    // then its auto-heal timer remounts the subtree. By the time it fires the
    // condition has cleared, so the child renders — no user action, no reload.
    // (React 18's createRoot does a synchronous render retry, so a child that
    // throws exactly once heals before the boundary ever sees it; an external
    // flag that stays true across those retries is what actually trips it.)
    let down = true;
    function Flaky() {
      if (down) throw new Error("transient");
      return <div data-testid="ok">recovered</div>;
    }

    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Flaky />
        </ErrorBoundary>,
      );
    });
    // First crash is silent — the alarm panel is never shown for a transient.
    expect(container.textContent).not.toContain("Something went wrong");
    expect(container.querySelector('[data-testid="ok"]')).toBeNull();

    // The transient condition clears, then the auto-heal timer fires.
    down = false;
    advancePastAutoHeal();

    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Something went wrong");
  });

  it("recovers in place when the user clicks Self-repair", () => {
    // Child throws while `boom` is true. The silent auto-heal retry also fails,
    // so the panel appears; flip `boom` false, then click Self-repair and the
    // boundary remounts the subtree and renders the healthy child — proving
    // recovery happens without a full page reload.
    let boom = true;
    function Toggle() {
      if (boom) throw new Error("still broken");
      return <div data-testid="ok">fixed</div>;
    }

    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Toggle />
        </ErrorBoundary>,
      );
    });
    advancePastAutoHeal();
    expect(container.textContent).toContain("Something went wrong");

    boom = false;
    const selfRepairBtn = [...container.querySelectorAll("button")].find((b) =>
      /self-repair/i.test(b.textContent),
    );
    expect(selfRepairBtn).toBeTruthy();
    act(() => {
      selfRepairBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Something went wrong");
  });

  it("reports uncaught runtime errors for diagnosis", () => {
    act(() => {
      root.render(
        <ErrorBoundary resetKey="/a">
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });

    trackCalls.length = 0;
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "async boom", error: new Error("async boom") }),
      );
    });

    expect(
      trackCalls.some(([name]) => name === "Runtime Error Captured"),
    ).toBe(true);
  });
});
