/**
 * Inspect a GLB / VRM from a small header + JSON-chunk prefix.
 * Never loads the binary chunk or the rest of the file.
 */
export const GLB_MAGIC = 0x46546c67; // 'glTF'
export const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'
export const GLB_VERSION = 2;
export const GLB_HEADER_BYTES = 12;
export const GLB_CHUNK_HEADER_BYTES = 8;
/** Cap on the JSON chunk we will pull into the Worker. */
export const MODEL_JSON_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
export const MODEL_EXTS = ["vrm", "glb"] as const;
export type ModelExt = (typeof MODEL_EXTS)[number];

export const VRM_VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type VrmViseme = (typeof VRM_VISEMES)[number];

export type GlbJsonLocation = {
  totalLength: number;
  jsonChunkLength: number;
  jsonChunkStart: number;
};

export type VesselModelMetadata = {
  format: "vrm" | "glb";
  byteSize: number;
  expressions: string[];
  visemes: VrmViseme[];
  humanoid: boolean;
  animationCount: number;
};

export class ModelInspectError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "invalid_model") {
    super(message);
    this.name = "ModelInspectError";
    this.status = status;
    this.code = code;
  }
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new ModelInspectError("Model header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true);
}

/** Parse the 20-byte GLB prefix (file header + first chunk header). */
export function locateGlbJsonChunk(prefix: Uint8Array): GlbJsonLocation {
  if (prefix.length < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
    throw new ModelInspectError("File is too small to be a GLB or VRM.");
  }
  const magic = u32(prefix, 0);
  if (magic !== GLB_MAGIC) {
    throw new ModelInspectError("Not a GLB/VRM file (missing glTF magic).");
  }
  const version = u32(prefix, 4);
  if (version !== GLB_VERSION) {
    throw new ModelInspectError(`Unsupported glTF container version ${version} (expected 2).`);
  }
  const totalLength = u32(prefix, 8);
  const jsonChunkLength = u32(prefix, 12);
  const chunkType = u32(prefix, 16);
  if (chunkType !== GLB_JSON_CHUNK) {
    throw new ModelInspectError("GLB does not start with a JSON chunk.");
  }
  if (jsonChunkLength < 2 || jsonChunkLength > MODEL_JSON_CHUNK_MAX_BYTES) {
    throw new ModelInspectError(
      jsonChunkLength > MODEL_JSON_CHUNK_MAX_BYTES
        ? "glTF JSON chunk is too large to inspect safely."
        : "GLB JSON chunk is empty.",
    );
  }
  const jsonChunkStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  if (totalLength < jsonChunkStart + jsonChunkLength) {
    throw new ModelInspectError("GLB header length does not cover the JSON chunk.");
  }
  return { totalLength, jsonChunkLength, jsonChunkStart };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function clipName(v: unknown, max = 40): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

const NAME_CAP = 64;

function uniqueNames(names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= NAME_CAP) break;
  }
  return out;
}

function expressionNamesFromGltf(gltf: Record<string, unknown>): string[] {
  const extensions = asRecord(gltf.extensions) || {};
  const vrm1 = asRecord(extensions.VRMC_vrm);
  const vrm0 = asRecord(extensions.VRM);
  const names: Array<string | null> = [];
  const vrm1Expr = vrm1 ? asRecord(vrm1.expressions) : null;
  for (const bag of [vrm1Expr ? asRecord(vrm1Expr.preset) : null, vrm1Expr ? asRecord(vrm1Expr.custom) : null]) {
    if (bag) names.push(...Object.keys(bag).map((k) => clipName(k)));
  }
  const groups = vrm0 ? asRecord(vrm0.blendShapeMaster)?.blendShapeGroups : undefined;
  if (Array.isArray(groups)) {
    for (const g of groups) names.push(clipName(asRecord(g)?.name));
  }
  return uniqueNames(names);
}

function hasHumanoid(gltf: Record<string, unknown>): boolean {
  const extensions = asRecord(gltf.extensions) || {};
  const vrm1 = asRecord(extensions.VRMC_vrm);
  const vrm0 = asRecord(extensions.VRM);
  const h = (vrm1 && asRecord(vrm1.humanoid)) || (vrm0 && asRecord(vrm0.humanoid));
  if (!h) return false;
  const bones = asRecord(h.humanBones) || asRecord(h.humanBones) || h;
  if (Array.isArray((h as { humanBones?: unknown }).humanBones)) {
    return ((h as { humanBones: unknown[] }).humanBones).length > 0;
  }
  return Boolean(asRecord(bones) && Object.keys(asRecord(bones)!).length > 0);
}

function usedExtensions(gltf: Record<string, unknown>): string[] {
  const listed = Array.isArray(gltf.extensionsUsed)
    ? gltf.extensionsUsed.filter((x): x is string => typeof x === "string")
    : [];
  const present = asRecord(gltf.extensions) ? Object.keys(asRecord(gltf.extensions)!) : [];
  return [...new Set([...listed, ...present])];
}

export function hasVrmExtension(gltf: Record<string, unknown>): boolean {
  return usedExtensions(gltf).some((e) => e === "VRMC_vrm" || e === "VRM");
}

export function parseGlbJsonChunk(jsonBytes: Uint8Array): Record<string, unknown> {
  // GLB JSON chunks are padded with 0x20 spaces to a 4-byte boundary.
  let end = jsonBytes.length;
  while (end > 0 && (jsonBytes[end - 1] === 0x20 || jsonBytes[end - 1] === 0x00)) end -= 1;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(jsonBytes.subarray(0, end));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelInspectError("GLB JSON chunk is not valid JSON.");
  }
  const rec = asRecord(parsed);
  if (!rec) throw new ModelInspectError("GLB JSON chunk must be an object.");
  return rec;
}

export function extractModelMetadata(
  gltf: Record<string, unknown>,
  args: { byteSize: number; ext: ModelExt; requireVrm: boolean },
): VesselModelMetadata {
  if (args.byteSize <= 0 || args.byteSize > MODEL_MAX_BYTES) {
    throw new ModelInspectError(`Model is too large (max ${MODEL_MAX_BYTES} bytes).`, 413, "model_too_large");
  }
  const vrm = hasVrmExtension(gltf);
  if (args.requireVrm && !vrm) {
    throw new ModelInspectError("A .vrm file must declare the VRM or VRMC_vrm glTF extension.");
  }
  const expressions = expressionNamesFromGltf(gltf);
  const visemeSet = new Set(VRM_VISEMES);
  const visemes = expressions
    .map((n) => n.toLowerCase())
    .filter((n): n is VrmViseme => visemeSet.has(n as VrmViseme));
  // Preserve canonical viseme spelling even if the file used different case.
  const visemeOut = VRM_VISEMES.filter((v) => visemes.includes(v));
  const animationCount = Array.isArray(gltf.animations) ? gltf.animations.length : 0;
  return {
    format: vrm ? "vrm" : "glb",
    byteSize: args.byteSize,
    expressions,
    visemes: visemeOut,
    humanoid: hasHumanoid(gltf),
    animationCount,
  };
}

export function modelKindFor(meta: VesselModelMetadata): "vrm" | "gltf" {
  return meta.format === "vrm" ? "vrm" : "gltf";
}

export function extFromFilename(name: unknown): ModelExt | null {
  if (typeof name !== "string") return null;
  const m = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m?.[1] || name.trim().toLowerCase().replace(/^\./, "");
  return (MODEL_EXTS as readonly string[]).includes(ext) ? (ext as ModelExt) : null;
}
