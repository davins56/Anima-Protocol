import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import * as THREE from "three";
import { createRefCache } from "./refCache";
import { materialKey, useVesselMaterial, vesselMaterials } from "./materialCache";

describe("refCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shares one value per key and disposes it after the last release + grace", () => {
    const dispose = vi.fn();
    const c = createRefCache<{ id: number }>(dispose, { graceMs: 500 });
    let n = 0;
    const a = c.get("k", () => ({ id: ++n }));
    const b = c.get("k", () => ({ id: ++n }));
    expect(a).toBe(b);
    c.retain("k");
    c.retain("k");
    c.release("k");
    vi.advanceTimersByTime(1000);
    expect(dispose).not.toHaveBeenCalled();
    c.release("k");
    vi.advanceTimersByTime(499);
    expect(dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(dispose).toHaveBeenCalledWith(a, "k");
    expect(c.has("k")).toBe(false);
  });

  it("a quick re-retain (StrictMode / remount) cancels disposal", () => {
    const dispose = vi.fn();
    const c = createRefCache(dispose, { graceMs: 500 });
    c.get("k", () => 1);
    c.retain("k");
    c.release("k");
    c.retain("k");
    vi.advanceTimersByTime(2000);
    expect(dispose).not.toHaveBeenCalled();
    expect(c.refs("k")).toBe(1);
  });

  it("collects values created by renders that never committed", () => {
    const dispose = vi.fn();
    const c = createRefCache(dispose, { graceMs: 100 });
    c.get("orphan", () => 1);
    vi.advanceTimersByTime(200);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("useVesselMaterial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vesselMaterials.clear();
  });
  afterEach(() => vi.useRealTimers());

  function Probe({ color, out }: { color: string; out: THREE.Material[] }) {
    out.push(useVesselMaterial({ color, hologram: false }));
    return null;
  }

  it("caches by colour + mode with ref-counting and disposes on unmount", () => {
    const out: THREE.Material[] = [];
    const ui = (
      <StrictMode>
        <Probe color="#ff0000" out={out} />
        <Probe color="#ff0000" out={out} />
      </StrictMode>
    );
    const { unmount } = render(ui);
    const key = materialKey({ color: "#ff0000", hologram: false });
    expect(new Set(out).size).toBe(1);
    expect(vesselMaterials.refs(key)).toBe(2);
    const mat = out[0];
    const spy = vi.spyOn(mat, "dispose");
    act(() => vi.advanceTimersByTime(5000));
    expect(spy).not.toHaveBeenCalled(); // still in use
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(vesselMaterials.has(key)).toBe(false);
  });

  it("keys hologram and emissive variants separately", () => {
    expect(materialKey({ color: "#fff", hologram: true })).not.toBe(materialKey({ color: "#fff", hologram: false }));
    expect(materialKey({ color: "#fff", hologram: false, emissive: "#fff", emissiveIntensity: 0.4 })).not.toBe(
      materialKey({ color: "#fff", hologram: false, emissive: "#fff", emissiveIntensity: 0.6 }),
    );
  });
});
