/**
 * Client side of the vessel model upload contract (docs/vessel-model-uploads.md):
 * validate → POST .../model/sign → PUT file straight to storage → POST .../model/complete.
 * The file never goes through the Worker.
 */
import { completeVesselModel, signVesselModel, type VesselModelUploadSign } from "./vesselApi";
import { MODEL_MAX_BYTES } from "./vesselModelAsset";

export type ModelExt = "vrm" | "glb";
export type ModelValidation = { ok: true; ext: ModelExt } | { ok: false; code: "ext" | "size" | "empty" | "magic"; message: string };

export function modelExtOf(name: string): ModelExt | null {
  const m = String(name || "").toLowerCase().match(/\.(vrm|glb)$/);
  return m ? (m[1] as ModelExt) : null;
}

/** GLB container: "glTF" magic, version 2 (little-endian), declared length ≥ 20. */
export function isGlbHeader(head: ArrayBuffer | Uint8Array): boolean {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head);
  if (b.byteLength < 12) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return dv.getUint32(0, true) === 0x46546c67 && dv.getUint32(4, true) === 2 && dv.getUint32(8, true) >= 20;
}

async function readHead(file: Blob, n: number): Promise<ArrayBuffer> {
  const part = file.slice(0, n);
  if (typeof part.arrayBuffer === "function") return part.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(part);
  });
}

/** Cheap client checks; the server repeats them (and reads the JSON chunk) on complete. */
export async function validateModelFile(file: File, maxBytes = MODEL_MAX_BYTES): Promise<ModelValidation> {
  const ext = modelExtOf(file.name);
  if (!ext) {
    const fbx = /\.(fbx|gltf|obj)$/i.test(file.name);
    return { ok: false, code: "ext", message: fbx ? "Only single-file .vrm or .glb models are supported (export FBX/glTF to GLB or VRM first)." : "Choose a .vrm or .glb file." };
  }
  if (!file.size) return { ok: false, code: "empty", message: "That file is empty." };
  if (file.size > maxBytes) return { ok: false, code: "size", message: `Model is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB.` };
  const head = await readHead(file, 12);
  if (!isGlbHeader(head)) return { ok: false, code: "magic", message: "This isn't a binary glTF (GLB/VRM) file." };
  return { ok: true, ext };
}

export type UploadPhase = "validating" | "signing" | "uploading" | "processing" | "done";

type XhrLike = Pick<XMLHttpRequest, "open" | "setRequestHeader" | "send" | "abort" | "status" | "responseText"> & {
  upload: { onprogress: ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
};

/** PUT the file to the signed storage URL with upload progress (fetch has no upload progress). */
export function putToSignedUrl(
  sign: Pick<VesselModelUploadSign, "uploadUrl" | "token" | "contentType">,
  file: Blob,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal; xhr?: () => XhrLike } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = (opts.xhr ?? (() => new XMLHttpRequest() as unknown as XhrLike))();
    xhr.open("PUT", sign.uploadUrl);
    // Supabase signed upload URLs carry `?token=` already; only add the Bearer
    // header when the token isn't in the URL (contract: "Bearer token").
    if (sign.token && !/[?&]token=/.test(sign.uploadUrl)) xhr.setRequestHeader("Authorization", `Bearer ${sign.token}`);
    xhr.setRequestHeader("Content-Type", sign.contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve();
      } else {
        let msg = `Upload failed (HTTP ${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (body?.message || body?.error) msg = `Upload failed: ${body.message || body.error}`;
        } catch {
          /* not JSON */
        }
        reject(Object.assign(new Error(msg), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error (check storage CORS for this origin)."));
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { name: "AbortError" }));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export type UploadDeps = {
  sign?: typeof signVesselModel;
  complete?: typeof completeVesselModel;
  put?: typeof putToSignedUrl;
};

/** Full upload flow. Resolves with the new vessel version from /complete. */
export async function uploadVesselModel(
  characterId: string,
  file: File,
  opts: { onPhase?: (p: UploadPhase) => void; onProgress?: (fraction: number) => void; signal?: AbortSignal; deps?: UploadDeps } = {},
) {
  const sign = opts.deps?.sign ?? signVesselModel;
  const complete = opts.deps?.complete ?? completeVesselModel;
  const put = opts.deps?.put ?? putToSignedUrl;
  if (!characterId) throw new Error("Choose a companion first.");
  opts.onPhase?.("validating");
  const v = await validateModelFile(file);
  if (v.ok === false) throw Object.assign(new Error(v.message), { code: `invalid_${v.code}` });
  opts.onPhase?.("signing");
  const signed = await sign(characterId, { byteSize: file.size, filename: file.name, ext: v.ext });
  if (signed.maxBytes && file.size > signed.maxBytes) throw Object.assign(new Error("Model is too large."), { code: "model_too_large" });
  opts.onPhase?.("uploading");
  await put(signed, file, { onProgress: opts.onProgress, signal: opts.signal });
  opts.onPhase?.("processing");
  const out = await complete(characterId, { path: signed.path });
  opts.onPhase?.("done");
  return out;
}

/** Human message for server error codes from sign/complete. */
export function uploadErrorMessage(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string };
  switch (e?.code) {
    case "model_storage_unconfigured":
      return "Model storage isn't set up on the server yet.";
    case "model_too_large":
      return "Model is larger than 50 MB.";
    case "invalid_model_ext":
      return "Only .vrm or .glb files are accepted.";
    case "model_not_found":
      return "The upload didn't reach storage; try again.";
    default:
      return e?.message || "Upload failed.";
  }
}
