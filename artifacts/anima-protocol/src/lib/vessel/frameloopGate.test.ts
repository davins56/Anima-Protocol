import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createFrameloopGate, frameloopFor } from "./frameloopGate";
import { useFrameloopGate } from "@/hooks/useFrameloopGate";

describe("frameloopGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is idle (demand) until held or pulsed", () => {
    const g = createFrameloopGate();
    expect(g.isActive()).toBe(false);
    g.hold("drag");
    expect(g.isActive()).toBe(true);
    g.release("drag");
    expect(g.isActive()).toBe(false);
  });

  it("stays active through overlapping holds", () => {
    const g = createFrameloopGate();
    g.hold("drag");
    g.hold("speaking");
    g.release("drag");
    expect(g.isActive()).toBe(true);
    g.release("speaking");
    expect(g.isActive()).toBe(false);
  });

  it("expires pulses and extends them to the latest end", () => {
    const g = createFrameloopGate();
    const seen: boolean[] = [];
    g.subscribe(() => seen.push(g.isActive()));
    g.pulse(1000);
    expect(g.isActive()).toBe(true);
    vi.advanceTimersByTime(600);
    g.pulse(1000); // now ends at 1600
    g.pulse(100); // shorter pulse never shortens it
    vi.advanceTimersByTime(500);
    expect(g.isActive()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(g.isActive()).toBe(false);
    expect(seen).toEqual([true, false]); // one notify per flip
  });

  it("a hold outlives a pulse", () => {
    const g = createFrameloopGate();
    g.pulse(100);
    g.hold("clip");
    vi.advanceTimersByTime(500);
    expect(g.isActive()).toBe(true);
  });

  it("dispose clears timers and listeners", () => {
    const g = createFrameloopGate();
    const fn = vi.fn();
    g.subscribe(fn);
    g.pulse(1000);
    fn.mockClear();
    g.dispose();
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
    expect(g.isActive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps visibility + activity to a frameloop", () => {
    expect(frameloopFor({ visible: false, active: true })).toBe("never");
    expect(frameloopFor({ visible: true, active: true })).toBe("always");
    expect(frameloopFor({ visible: true, active: false })).toBe("demand");
  });

  it("useFrameloopGate toggles always ↔ demand", () => {
    const { result, unmount } = renderHook(({ visible }) => useFrameloopGate(visible), { initialProps: { visible: true } });
    expect(result.current.frameloop).toBe("demand");
    act(() => result.current.gate.hold("drag"));
    expect(result.current.frameloop).toBe("always");
    act(() => result.current.gate.release("drag"));
    act(() => result.current.gate.pulse(300));
    expect(result.current.frameloop).toBe("always");
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.frameloop).toBe("demand");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
