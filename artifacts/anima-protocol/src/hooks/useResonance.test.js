import { describe, expect, it } from "vitest";
import { resonanceTier, useResonance } from "./useResonance";
import { renderHook } from "@testing-library/react";

describe("useResonance", () => {
  it("prefers persisted synchro_strength over the client formula", () => {
    const { result } = renderHook(() =>
      useResonance({
        messageCount: 2,
        relationship: { score: 10 },
        emotion: { intensity: 1 },
        synchroStrength: 74,
      }),
    );
    expect(result.current.value).toBe(74);
    expect(result.current.label).toBe("BONDED");
    expect(resonanceTier(74).label).toBe("BONDED");
  });

  it("falls back to the in-session formula when synchro is unknown", () => {
    const { result } = renderHook(() =>
      useResonance({
        messageCount: 0,
        relationship: null,
        emotion: null,
      }),
    );
    expect(result.current.value).toBe(0);
    expect(result.current.label).toBe("DISTANT");
  });
});

describe("useResonance render path", () => {
  it("regression: follows each new synchro_strength the chat reply reports", () => {
    const { result, rerender } = renderHook((props) => useResonance(props), {
      initialProps: { messageCount: 10, synchroStrength: 30 },
    });
    expect(result.current).toMatchObject({ value: 30, label: "ATTUNED", source: "bond" });
    rerender({ messageCount: 12, synchroStrength: 33 });
    expect(result.current.value).toBe(33);
    rerender({ messageCount: 14, synchroStrength: 52 });
    expect(result.current).toMatchObject({ value: 52, label: "BONDED" });
  });

  it("labels the local formula as an estimate", () => {
    const { result } = renderHook(() => useResonance({ messageCount: 4 }));
    expect(result.current.source).toBe("estimate");
  });
});
