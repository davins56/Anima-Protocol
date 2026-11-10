import { afterEach, describe, expect, it, vi } from "vitest";

const { authHeaders } = vi.hoisted(() => {
  const fn = vi.fn(async () => ({ Authorization: `Bearer t${fn.mock.calls.length}` }));
  return { authHeaders: fn };
});
vi.mock("@/api/authBridge", () => ({ authHeaders: () => authHeaders() }));

import { clearVesselModelCache, fetchVesselModelBytes, isApiModelUrl, loadVesselModelBytes, modelCacheKey, resolveModelRequestUrl } from "./vesselModelAsset";

const bytes = (n = 8) => new Uint8Array(n).buffer;
function res(status: number, body: ArrayBuffer | string = "", redirected = false) {
  const r = new Response(status === 204 ? null : body, { status });
  Object.defineProperty(r, "redirected", { value: redirected });
  return r;
}

afterEach(() => {
  clearVesselModelCache();
  authHeaders.mockClear();
});

describe("model URLs", () => {
  it("recognises the owner-only API route and resolves it through apiUrl", () => {
    expect(isApiModelUrl("/api/vessel/abc/model")).toBe(true);
    expect(isApiModelUrl("https://cdn.example/a.vrm")).toBe(false);
    expect(resolveModelRequestUrl("/api/vessel/abc/model")).toBe(`${window.location.origin}/api/vessel/abc/model`);
    expect(resolveModelRequestUrl("https://cdn.example/a.vrm")).toBe("https://cdn.example/a.vrm");
  });
  it("cache key changes when the stored object is replaced", () => {
    const a = modelCacheKey({ url: "/api/vessel/c/model", path: "u/c/1.vrm", byteSize: 10 });
    const b = modelCacheKey({ url: "/api/vessel/c/model", path: "u/c/2.vrm", byteSize: 10 });
    expect(a).not.toBe(b);
    expect(modelCacheKey(null)).toBe("");
  });
});

describe("fetchVesselModelBytes", () => {
  it("requests the API URL with auth, follows the redirect, and never stores the signed URL", async () => {
    const fetchImpl = vi.fn(async () => res(200, bytes(16), true));
    const buf = await fetchVesselModelBytes("/api/vessel/c/model", { fetchImpl });
    expect(buf.byteLength).toBe(16);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/vessel\/c\/model$/);
    expect(init.redirect).toBe("follow");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });
  it("re-fetches through the API (fresh signed URL + token) when the signed URL expired", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(400, '{"error":"InvalidJWT","message":"\\"exp\\" claim timestamp check failed"}', true))
      .mockResolvedValueOnce(res(200, bytes(4), true));
    const buf = await fetchVesselModelBytes("/api/vessel/c/model", { fetchImpl });
    expect(buf.byteLength).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toMatch(/\/api\/vessel\/c\/model$/);
    expect(authHeaders).toHaveBeenCalledTimes(2);
  });
  it("retries 403 once then gives up; never retries 404", async () => {
    const forbidden = vi.fn(async () => res(403, "", true));
    await expect(fetchVesselModelBytes("/api/vessel/c/model", { fetchImpl: forbidden })).rejects.toMatchObject({ status: 403 });
    expect(forbidden).toHaveBeenCalledTimes(2);
    const missing = vi.fn(async () => res(404));
    await expect(fetchVesselModelBytes("/api/vessel/c/model", { fetchImpl: missing })).rejects.toThrow(/No model/);
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it("fetches external https models without credentials", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => res(200, bytes(2)));
    await fetchVesselModelBytes("https://cdn.example/a.vrm", { fetchImpl });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
    expect(init.headers).toBeUndefined();
    expect(authHeaders).not.toHaveBeenCalled();
  });
  it("rejects oversized downloads", async () => {
    const r = res(200, bytes(2));
    r.headers.set("content-length", String(60 * 1024 * 1024));
    await expect(fetchVesselModelBytes("https://cdn.example/a.vrm", { fetchImpl: async () => r })).rejects.toMatchObject({ status: 413 });
  });
});

describe("loadVesselModelBytes cache", () => {
  it("shares one download per key and drops failures so the next mount retries", async () => {
    const ok = vi.fn(async () => res(200, bytes(3)));
    const p1 = loadVesselModelBytes("https://cdn.example/a.vrm", "k1", ok);
    const p2 = loadVesselModelBytes("https://cdn.example/a.vrm", "k1", ok);
    expect(p1).toBe(p2);
    await p1;
    expect(ok).toHaveBeenCalledTimes(1);

    const bad = vi.fn(async () => res(500));
    await expect(loadVesselModelBytes("https://cdn.example/b.vrm", "k2", bad)).rejects.toThrow();
    const good = vi.fn(async () => res(200, bytes(1)));
    await expect(loadVesselModelBytes("https://cdn.example/b.vrm", "k2", good)).resolves.toBeInstanceOf(ArrayBuffer);
  });
});
