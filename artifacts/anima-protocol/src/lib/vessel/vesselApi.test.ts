import { afterEach, describe, expect, it, vi } from "vitest";
import { clearVesselRecordCache, fetchVessel } from "./vesselApi";
import { defaultVesselFor } from "./vesselConfig";

vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer test" }) }));
const response = (id: string) => new Response(JSON.stringify({ vessel: {
  id, character_id: "same-character", version: 1, config: defaultVesselFor({ name: "Serenity" }), snapshot_path: null, created_at: "2026-11-15T00:00:00Z",
} }), { status: 200 });
afterEach(() => { clearVesselRecordCache(); vi.unstubAllGlobals(); });

describe("private vessel cache invalidation", () => {
  it("fetches again after an account boundary even when character ids collide", async () => {
    const request = vi.fn().mockResolvedValueOnce(response("owner-a")).mockResolvedValueOnce(response("owner-b"));
    vi.stubGlobal("fetch", request);
    expect((await fetchVessel("same-character"))?.id).toBe("owner-a");
    clearVesselRecordCache();
    expect((await fetchVessel("same-character"))?.id).toBe("owner-b");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("discards an old account's in-flight result without replacing the new account cache", async () => {
    let resolveOld!: (res: Response) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response("owner-b"));
    vi.stubGlobal("fetch", request);
    const oldRead = fetchVessel("same-character");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    clearVesselRecordCache();
    expect((await fetchVessel("same-character"))?.id).toBe("owner-b");
    resolveOld(response("owner-a"));
    expect(await oldRead).toBeNull();
    expect((await fetchVessel("same-character"))?.id).toBe("owner-b");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
