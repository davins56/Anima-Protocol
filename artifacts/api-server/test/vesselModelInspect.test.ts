import { describe, expect, it } from "vitest";
import {
  extractModelMetadata,
  hasVrmExtension,
  locateGlbJsonChunk,
  parseGlbJsonChunk,
  ModelInspectError,
} from "../src/lib/vessel/modelInspect";
import { glbBytes, vrmBytes, MINIMAL_VRM, PLAIN_GLB } from "./glbFixture";

describe("GLB / VRM inspect", () => {
  it("locates the JSON chunk of a well-formed GLB", () => {
    const bytes = vrmBytes();
    const loc = locateGlbJsonChunk(bytes.subarray(0, 20));
    expect(loc.jsonChunkStart).toBe(20);
    expect(loc.jsonChunkLength).toBeGreaterThan(10);
    const json = parseGlbJsonChunk(bytes.subarray(loc.jsonChunkStart, loc.jsonChunkStart + loc.jsonChunkLength));
    expect(hasVrmExtension(json)).toBe(true);
  });

  it("rejects missing magic, wrong version, and a non-JSON first chunk", () => {
    expect(() => locateGlbJsonChunk(new Uint8Array(20))).toThrow(ModelInspectError);
    const badVer = Buffer.from(vrmBytes());
    badVer.writeUInt32LE(1, 4);
    expect(() => locateGlbJsonChunk(new Uint8Array(badVer.subarray(0, 20)))).toThrow(/version 1/);
  });

  it("extracts VRM expressions, visemes, humanoid and animation count", () => {
    const meta = extractModelMetadata(MINIMAL_VRM, { byteSize: 2048, ext: "vrm", requireVrm: true });
    expect(meta.format).toBe("vrm");
    expect(meta.expressions).toEqual(expect.arrayContaining(["happy", "aa", "ih", "ou", "ee", "oh", "wink"]));
    expect(meta.visemes).toEqual(["aa", "ih", "ou", "ee", "oh"]);
    expect(meta.humanoid).toBe(true);
    expect(meta.animationCount).toBe(1);
  });

  it("rejects a .vrm file that has no VRM extension, and accepts a plain GLB", () => {
    expect(() => extractModelMetadata(PLAIN_GLB, { byteSize: 100, ext: "vrm", requireVrm: true })).toThrow(/VRM/);
    const meta = extractModelMetadata(PLAIN_GLB, { byteSize: glbBytes().byteLength, ext: "glb", requireVrm: false });
    expect(meta.format).toBe("glb");
    expect(meta.expressions).toEqual([]);
    expect(meta.humanoid).toBe(false);
  });

  it("treats a .glb that contains VRMC_vrm as format vrm", () => {
    const meta = extractModelMetadata(MINIMAL_VRM, { byteSize: 100, ext: "glb", requireVrm: false });
    expect(meta.format).toBe("vrm");
  });
});
