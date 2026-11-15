/** Minimal GLB / VRM byte builders for tests. */
export function buildGlb(gltf: Record<string, unknown>): Uint8Array {
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const pad = (4 - (json.length % 4)) % 4;
  const jsonLen = json.length + pad;
  const total = 12 + 8 + jsonLen;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  if (pad) out.fill(0x20, 20 + json.length, 20 + jsonLen);
  return new Uint8Array(out);
}

export const MINIMAL_VRM = {
  asset: { version: "2.0" },
  extensionsUsed: ["VRMC_vrm"],
  extensions: {
    VRMC_vrm: {
      specVersion: "1.0",
      humanoid: { humanBones: { hips: { node: 0 }, head: { node: 0 } } },
      expressions: {
        preset: { happy: {}, angry: {}, aa: {}, ih: {}, ou: {}, ee: {}, oh: {}, blink: {} },
        custom: { wink: {} },
      },
    },
  },
  animations: [{ name: "idle", channels: [], samplers: [] }],
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Root" }],
};

export const PLAIN_GLB = {
  asset: { version: "2.0" },
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Root" }],
};

export function vrmBytes(): Uint8Array {
  return buildGlb(MINIMAL_VRM);
}

export function glbBytes(): Uint8Array {
  return buildGlb(PLAIN_GLB);
}
