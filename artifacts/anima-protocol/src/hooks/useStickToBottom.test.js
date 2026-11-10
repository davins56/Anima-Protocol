import { describe, expect, it } from "vitest";
import { isNearBottom, NEAR_BOTTOM_PX } from "./useStickToBottom";

describe("isNearBottom", () => {
  it("treats the last NEAR_BOTTOM_PX as the bottom", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600 - NEAR_BOTTOM_PX, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 400 })).toBe(false);
  });
});
