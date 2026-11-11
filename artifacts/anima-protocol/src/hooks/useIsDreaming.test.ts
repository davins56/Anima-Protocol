import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIsDreaming } from "./useIsDreaming";

describe("useIsDreaming", () => {
  it("exposes isDreaming from continuity presence", async () => {
    const load = vi.fn().mockResolvedValue({
      presence: "dreaming",
      presence_label: "Aeland is dreaming",
      state: { lastDreamAt: "2026-11-10T12:00:00.000Z", recentDreams: [{ id: "d1", fragment: "a lantern", created_at: "2026-11-10T12:00:00.000Z" }] },
    });
    const { result } = renderHook(() => useIsDreaming("c1", { name: "Aeland", api: { continuity: { load } } }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isDreaming).toBe(true);
    expect(result.current.presenceLabel).toBe("Aeland is dreaming");
    expect(result.current.recentDreams).toHaveLength(1);
    expect(load).toHaveBeenCalledWith("c1", { surface: "home", name: "Aeland" });
  });

  it("is not dreaming when she is only lost in thought", async () => {
    const load = vi.fn().mockResolvedValue({ presence: "drifting", presence_label: "Aeland is lost in thought", state: {} });
    const { result } = renderHook(() => useIsDreaming("c1", { api: { continuity: { load } } }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isDreaming).toBe(false);
  });
});
