import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer t" }) }));
import { __resetVesselSnapshots, loadVesselSnapshot, primeVesselSnapshot } from "./vesselSnapshot";

describe("vesselSnapshot", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    __resetVesselSnapshots();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches once per (character, path) with auth and returns an object URL", async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200, headers: { "content-type": "image/jpeg" } }));
    expect(await loadVesselSnapshot("c1", "p1")).toBe("blob:x");
    expect(await loadVesselSnapshot("c1", "p1")).toBe("blob:x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/vessel\/c1\/snapshot$/);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
  });

  it("caches misses as null (404 or non-image) and refetches when the path changes", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await loadVesselSnapshot("c1", "p1")).toBeNull();
    expect(await loadVesselSnapshot("c1", "p1")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await loadVesselSnapshot("c1", "p2")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a primed Studio render without a network round-trip", async () => {
    primeVesselSnapshot("c1", "p9", "data:image/jpeg;base64,AA");
    expect(await loadVesselSnapshot("c1", "p9")).toBe("data:image/jpeg;base64,AA");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await loadVesselSnapshot("c1", null)).toBeNull();
  });
});
