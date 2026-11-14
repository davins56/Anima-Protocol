import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMeterDelta, meterDelta, useMeterDelta } from "./useMeterDelta";

describe("meterDelta", () => {
  it("reports whole-point changes only between two known values", () => {
    expect(meterDelta(null, 40)).toBeNull();
    expect(meterDelta(40, null)).toBeNull();
    expect(meterDelta(40, 40)).toBeNull();
    expect(meterDelta(40, 43)).toBe(3);
    expect(meterDelta(43, 37)).toBe(-6);
    expect(meterDelta(40.2, 40.4)).toBeNull();
  });

  it("formats with a real minus sign", () => {
    expect(formatMeterDelta(3)).toBe("+3");
    expect(formatMeterDelta(-2)).toBe("\u22122");
    expect(formatMeterDelta(0)).toBe("");
  });
});

describe("useMeterDelta", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flashes the change after a turn, then clears", () => {
    const { result, rerender } = renderHook(({ v }) => useMeterDelta(v, { resetKey: "a", holdMs: 1000 }), {
      initialProps: { v: 40 },
    });
    expect(result.current.delta).toBeNull();
    rerender({ v: 42 });
    expect(result.current.delta).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(result.current.delta).toBeNull();
    rerender({ v: 39 });
    expect(result.current.delta).toBe(-3);
  });

  it("does not flash when the companion or data source changes", () => {
    const { result, rerender } = renderHook(({ v, k }) => useMeterDelta(v, { resetKey: k }), {
      initialProps: { v: 12, k: "serenity:estimate" },
    });
    rerender({ v: 64, k: "serenity:bond" });
    expect(result.current.delta).toBeNull();
    rerender({ v: 66, k: "serenity:bond" });
    expect(result.current.delta).toBe(2);
  });

  it("ignores the first value and missing values", () => {
    const { result, rerender } = renderHook(({ v }) => useMeterDelta(v), { initialProps: { v: null } });
    rerender({ v: 50 });
    expect(result.current.delta).toBeNull();
    rerender({ v: null });
    expect(result.current.delta).toBeNull();
    rerender({ v: 52 });
    expect(result.current.delta).toBe(2);
  });
});
