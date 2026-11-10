import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: vi.fn(async () => ({ Authorization: "Bearer clerk" })) }));

import { isGlbHeader, modelExtOf, putToSignedUrl, uploadErrorMessage, uploadVesselModel, validateModelFile } from "./vesselModelUpload";

function glb(size = 64, { magic = 0x46546c67, version = 2 } = {}) {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint32(4, version, true);
  dv.setUint32(8, size, true);
  return b;
}
const file = (name: string, bytes: Uint8Array | string = glb()) => new File([bytes as BlobPart], name);

describe("validateModelFile", () => {
  it("accepts .vrm and .glb with a GLB v2 header", async () => {
    expect(await validateModelFile(file("serenity.vrm"))).toEqual({ ok: true, ext: "vrm" });
    expect(await validateModelFile(file("Body.GLB"))).toEqual({ ok: true, ext: "glb" });
  });
  it("rejects other extensions, with a hint for FBX / glTF", async () => {
    const fbx = await validateModelFile(file("a.fbx"));
    expect(fbx).toMatchObject({ ok: false, code: "ext" });
    expect((fbx as { message: string }).message).toMatch(/FBX/);
    expect(await validateModelFile(file("a.gltf"))).toMatchObject({ ok: false, code: "ext" });
    expect(await validateModelFile(file("a.png"))).toMatchObject({ ok: false, code: "ext" });
  });
  it("rejects files over the cap (50 MB by default) and empty files", async () => {
    expect(await validateModelFile(file("a.vrm"), 32)).toMatchObject({ ok: false, code: "size" });
    expect(await validateModelFile(file("a.vrm", new Uint8Array(0)))).toMatchObject({ ok: false, code: "empty" });
    const big = { name: "big.vrm", size: 50 * 1024 * 1024 + 1, slice: () => new Blob([glb()]) } as unknown as File;
    expect(await validateModelFile(big)).toMatchObject({ ok: false, code: "size" });
  });
  it("rejects a renamed non-GLB (magic header check)", async () => {
    expect(await validateModelFile(file("fake.vrm", "{\"asset\":{}} not binary gltf"))).toMatchObject({ ok: false, code: "magic" });
    expect(await validateModelFile(file("v1.glb", glb(64, { version: 1 })))).toMatchObject({ ok: false, code: "magic" });
  });
  it("helpers", () => {
    expect(modelExtOf("x.VRM")).toBe("vrm");
    expect(modelExtOf("x.vrm.zip")).toBeNull();
    expect(isGlbHeader(glb())).toBe(true);
    expect(isGlbHeader(new Uint8Array(4))).toBe(false);
  });
});

class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  body: unknown;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private respond: (x: FakeXhr) => void) {
    FakeXhr.last = this;
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    this.respond(this);
  }
  abort() {
    this.onabort?.();
  }
}

describe("putToSignedUrl", () => {
  const sign = { uploadUrl: "https://x.supabase.co/storage/v1/object/upload/sign/b/p.vrm", token: "tok", contentType: "model/vrm" };
  it("PUTs the file with Bearer token + content type and reports progress", async () => {
    const progress: number[] = [];
    const f = file("a.vrm");
    await putToSignedUrl(sign, f, {
      onProgress: (p) => progress.push(p),
      xhr: () => new FakeXhr((x) => ((x.status = 200), x.onload?.())) as never,
    });
    expect(FakeXhr.last.method).toBe("PUT");
    expect(FakeXhr.last.url).toBe(sign.uploadUrl);
    expect(FakeXhr.last.headers).toEqual({ Authorization: "Bearer tok", "Content-Type": "model/vrm" });
    expect(FakeXhr.last.body).toBe(f);
    expect(progress).toEqual([0.5, 1]);
  });
  it("doesn't add a Bearer header when the token is already in the URL", async () => {
    await putToSignedUrl({ ...sign, uploadUrl: `${sign.uploadUrl}?token=tok` }, file("a.vrm"), {
      xhr: () => new FakeXhr((x) => ((x.status = 200), x.onload?.())) as never,
    });
    expect(FakeXhr.last.headers.Authorization).toBeUndefined();
  });
  it("rejects on HTTP error with the storage message, and on network error", async () => {
    await expect(
      putToSignedUrl(sign, file("a.vrm"), {
        xhr: () => new FakeXhr((x) => ((x.status = 400), (x.responseText = '{"message":"jwt expired"}'), x.onload?.())) as never,
      }),
    ).rejects.toThrow(/jwt expired/);
    await expect(putToSignedUrl(sign, file("a.vrm"), { xhr: () => new FakeXhr((x) => x.onerror?.()) as never })).rejects.toThrow(/CORS/);
  });
});

describe("uploadVesselModel (sign → PUT → complete)", () => {
  const signed = { bucket: "character-models", path: "u/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.vrm", uploadUrl: "https://s/u", token: "t", expiresIn: 600, maxBytes: 52428800, contentType: "model/vrm" };
  it("runs the phases in order with the contract payloads", async () => {
    const calls: string[] = [];
    const sign = vi.fn(async (...a: unknown[]) => (calls.push("sign"), signed));
    const put = vi.fn(async (_s: unknown, _f: unknown) => {
      calls.push("put");
    });
    const complete = vi.fn(async () => (calls.push("complete"), { vessel: { version: 4 } as never, identity_version: 2, model: { kind: "vrm" } as never }));
    const phases: string[] = [];
    const f = file("serenity.vrm");
    const out = await uploadVesselModel("char-1", f, { onPhase: (p) => phases.push(p), deps: { sign, put, complete } as never });
    expect(calls).toEqual(["sign", "put", "complete"]);
    expect(sign).toHaveBeenCalledWith("char-1", { byteSize: f.size, filename: "serenity.vrm", ext: "vrm" });
    expect(put.mock.calls[0][0]).toBe(signed);
    expect(put.mock.calls[0][1]).toBe(f);
    expect(complete).toHaveBeenCalledWith("char-1", { path: signed.path });
    expect(phases).toEqual(["validating", "signing", "uploading", "processing", "done"]);
    expect(out.vessel.version).toBe(4);
  });
  it("never signs an invalid file", async () => {
    const sign = vi.fn();
    await expect(uploadVesselModel("c", file("a.fbx"), { deps: { sign } as never })).rejects.toThrow(/vrm or \.glb/i);
    expect(sign).not.toHaveBeenCalled();
  });

  describe("through the real API helpers (mocked fetch)", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    it("POSTs sign and complete to /api/vessel/:id/model/*", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/model/sign")) return new Response(JSON.stringify(signed), { status: 201 });
        if (url.endsWith("/model/complete"))
          return new Response(JSON.stringify({ vessel: { id: "v", character_id: "c 1", version: 2, config: { model: { kind: "vrm", url: "/api/vessel/c%201/model" } } }, identity_version: 1, model: {} }), { status: 201 });
        return new Response("{}", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const put = vi.fn(async () => {});
      const out = await uploadVesselModel("c 1", file("a.glb"), { deps: { put } });
      const [signUrl, signInit] = fetchMock.mock.calls[0];
      expect(signUrl).toMatch(/\/api\/vessel\/c%201\/model\/sign$/);
      expect(JSON.parse(String(signInit!.body))).toMatchObject({ ext: "glb", filename: "a.glb" });
      expect((signInit!.headers as Record<string, string>).Authorization).toBe("Bearer clerk");
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ path: signed.path });
      expect(out.vessel.config.model.kind).toBe("vrm");
      vi.unstubAllGlobals();
    });
    it("surfaces server error codes", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", code: "model_storage_unconfigured" }), { status: 503 })));
      const err = await uploadVesselModel("c", file("a.vrm")).catch((e) => e);
      expect(uploadErrorMessage(err)).toMatch(/storage isn't set up/);
      vi.unstubAllGlobals();
    });
  });
});
