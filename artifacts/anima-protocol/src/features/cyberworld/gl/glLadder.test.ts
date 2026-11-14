import { describe, expect, it, vi } from "vitest";
import { probeWebGL } from "@/lib/webglSupport";
import { clampDpr, diagnosticLine, GL_TIERS, IOS_MAX_DPR, isIOSLike, MAX_GL_ATTEMPTS, RENDERABLE_TIERS, retryDelay, tierForAttempt, webglUnavailable } from "./glLadder";

describe("tier ladder", () => {
  it("steps WebGL2 default → WebGL2 safe and sticks there (three needs WebGL2)", () => {
    expect(tierForAttempt(0).name).toBe("webgl2");
    expect(tierForAttempt(1).name).toBe("webgl2-safe");
    expect(tierForAttempt(9).name).toBe("webgl2-safe");
    const safe = tierForAttempt(1);
    expect(safe.attributes).toMatchObject({ antialias: false, powerPreference: "default" });
    expect(safe.maxDpr).toBe(1.5);
    expect(safe.bloom).toBe(false);
    expect(GL_TIERS.map((t) => t.name)).toEqual(["webgl2", "webgl2-safe", "webgl1"]);
    expect(RENDERABLE_TIERS.every((t) => t.context === "webgl2")).toBe(true);
    for (const t of GL_TIERS) {
      expect(t.attributes).not.toHaveProperty("failIfMajorPerformanceCaveat");
      expect(t.attributes.powerPreference).not.toBe("high-performance");
      expect(t.attributes.preserveDrawingBuffer ?? false).toBe(false);
    }
  });
});

describe("DPR / size clamp", () => {
  const top = GL_TIERS[0];
  it("caps iOS (incl. iPadOS posing as a Mac) at 1.5", () => {
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", maxTouchPoints: 5 };
    expect(isIOSLike(ipad)).toBe(true);
    expect(isIOSLike({ userAgent: ipad.userAgent, maxTouchPoints: 0 })).toBe(false);
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(true);
    expect(clampDpr({ deviceDpr: 2, tier: top, ios: true, cssW: 1376, cssH: 1032, maxRenderbuffer: 16384 })).toBe(IOS_MAX_DPR);
    expect(clampDpr({ deviceDpr: 2, tier: top, ios: false, cssW: 1376, cssH: 1032, maxRenderbuffer: 16384 })).toBe(2);
  });
  it("respects tier and quality caps and keeps the buffer under MAX_RENDERBUFFER_SIZE", () => {
    expect(clampDpr({ deviceDpr: 3, tier: GL_TIERS[1], ios: false, cssW: 800, cssH: 600, maxRenderbuffer: 16384 })).toBe(1.5);
    expect(clampDpr({ deviceDpr: 2, tier: top, ios: false, qualityMax: 1, cssW: 800, cssH: 600, maxRenderbuffer: 16384 })).toBe(1);
    const d = clampDpr({ deviceDpr: 2, tier: top, ios: false, cssW: 2752, cssH: 2064, maxRenderbuffer: 4096 });
    expect(2752 * d).toBeLessThanOrEqual(4096);
    // Unknown limit → conservative 4096.
    expect(4000 * clampDpr({ deviceDpr: 2, tier: top, ios: false, cssW: 4000, cssH: 10, maxRenderbuffer: null })).toBeLessThanOrEqual(4096);
    expect(clampDpr({ deviceDpr: 0, tier: top, ios: false, cssW: 10, cssH: 10 })).toBe(1);
  });
});

describe("detection (mocked getContext)", () => {
  const canvasWith = (impl: (type: string, attrs?: unknown) => unknown) => {
    const getContext = vi.fn(impl);
    return { getContext, create: () => ({ getContext }) };
  };
  const ctx = () => {
    const loseContext = vi.fn();
    return { loseContext, gl: { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext } : null) } };
  };

  it("WebGL2 ok: probes without attributes (no failIfMajorPerformanceCaveat) and releases the context", () => {
    const c = ctx();
    const m = canvasWith((t) => (t === "webgl2" ? c.gl : null));
    const p = probeWebGL(m.create);
    expect(p).toEqual({ webgl2: true, webgl1: false, error: null });
    expect(m.getContext).toHaveBeenCalledTimes(1);
    expect(m.getContext.mock.calls[0]).toEqual(["webgl2"]);
    expect(c.loseContext).toHaveBeenCalledTimes(1);
    expect(webglUnavailable(p)).toBe(false);
  });

  it("falls back to WebGL1 and only reports unavailable when both fail", () => {
    const c = ctx();
    expect(probeWebGL(canvasWith((t) => (t === "webgl" ? c.gl : null)).create)).toMatchObject({ webgl2: false, webgl1: true });
    expect(c.loseContext).toHaveBeenCalled();
    const none = probeWebGL(canvasWith(() => null).create);
    expect(webglUnavailable(none)).toBe(true);
    const threw = probeWebGL(
      canvasWith(() => {
        throw new Error("blocked");
      }).create,
    );
    expect(threw).toMatchObject({ webgl2: false, webgl1: false, error: "blocked" });
  });

  it("ignores a context without WEBGL_lose_context", () => {
    expect(probeWebGL(canvasWith(() => ({ getExtension: () => null })).create).webgl2).toBe(true);
  });
});

describe("retry policy", () => {
  it("backs off exponentially, then stops", () => {
    expect(retryDelay(1)).toBe(250);
    expect(retryDelay(2)).toBe(500);
    expect(retryDelay(3)).toBe(1000);
    expect(retryDelay(MAX_GL_ATTEMPTS)).toBeNull();
    expect(retryDelay(20, 50)).toBe(4000);
  });
  it("diagnostic names the tier, the error and the probe", () => {
    const line = diagnosticLine({ tier: "webgl2-safe", error: 'getContext("webgl2") returned null', probe: { webgl2: true, webgl1: false, error: null }, attempts: 4 });
    expect(line).toBe('tier webgl2-safe failed after 4 attempts: getContext("webgl2") returned null · probe webgl2=ok webgl1=no');
  });
});
