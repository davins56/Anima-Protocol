#!/usr/bin/env node
/**
 * Populate public/mediapipe/ for the on-device photo-to-vessel lab:
 *  - wasm/: copied from node_modules/@mediapipe/tasks-vision (Apache 2.0)
 *  - models/: Google's published .task files, checksum-verified
 * The folder is gitignored; run once per checkout:  node scripts/fetch-mediapipe-assets.mjs
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@mediapipe/tasks-vision"));

const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

mkdirSync(join(out, "wasm"), { recursive: true });
mkdirSync(join(out, "models"), { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  copyFileSync(join(pkgDir, "wasm", f), join(out, "wasm", f));
}
for (const m of MODELS) {
  const dest = join(out, "models", m.file);
  if (existsSync(dest) && sha(readFileSync(dest)) === m.sha256) continue;
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== m.sha256) throw new Error(`${m.file}: checksum mismatch`);
  writeFileSync(dest, buf);
}
console.log(`mediapipe assets ready in ${out}`);
