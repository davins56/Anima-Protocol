import { inflateRawSync } from "node:zlib";

// Matches client IMPORT_LIMITS / PULL_LIMITS archive ceiling (50MB).
// Pull downloads from GitHub on the Worker; this is not a user zip POST, so
// Cloudflare's ~100MB incoming request-body cap is not the constraint.
export const GITHUB_ARCHIVE_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxFiles: 400,
  maxTotalBytes: 3 * 1024 * 1024,
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vercel",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  "__macosx",
]);

const SKIP_FILES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "composer.lock",
]);

const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif",
  "pdf", "zip", "gz", "tgz", "7z", "rar", "wasm",
  "exe", "dll", "so", "dylib", "bin", "class", "jar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "webm", "wav", "ogg", "mov",
]);

const REF_RE = /^[\w.-]+$/;
const BRANCH_RE = /^[\w./-]+$/;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

export type GithubArchiveRef = {
  owner: string;
  repo: string;
  branch: string;
};

export type UnpackedTextFile = { path: string; content: string };
export type SkippedPath = { path: string; reason: string };

export function validateGithubArchiveRef(input: {
  owner?: unknown;
  repo?: unknown;
  branch?: unknown;
}): { ok: true; ref: GithubArchiveRef } | { ok: false; error: string } {
  const owner = String(input.owner || "").trim();
  const repo = String(input.repo || "").trim().replace(/\.git$/i, "");
  const branch = String(input.branch || "main").trim() || "main";
  if (!REF_RE.test(owner) || !REF_RE.test(repo)) {
    return { ok: false, error: "GitHub owner and repo must be simple names." };
  }
  if (!BRANCH_RE.test(branch) || branch.includes("..") || branch.startsWith("/")) {
    return { ok: false, error: "GitHub branch name is invalid." };
  }
  return { ok: true, ref: { owner, repo, branch } };
}

export function githubCodeloadUrls(ref: GithubArchiveRef): string[] {
  const { owner, repo, branch } = ref;
  const urls = [
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`,
    `https://codeload.github.com/${owner}/${repo}/zip/${branch}`,
  ];
  if (branch === "main") {
    urls.push(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/master`);
  }
  return urls;
}

export function archivePathIsHeavy(raw = ""): boolean {
  const p = String(raw).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return true;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === "..")) return true;
  const lower = parts.map((s) => s.toLowerCase());
  if (lower.some((s) => SKIP_DIRS.has(s))) return true;
  const name = lower[lower.length - 1] || "";
  if (SKIP_FILES.has(name)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (lower.includes(".sessions")) return true;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  if (BINARY_EXTS.has(ext)) return true;
  return false;
}

function stripCommonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0];
  if (!first) return "";
  const allShare = paths.every((p) => p === first || p.startsWith(`${first}/`));
  const hasNested = paths.some((p) => p.includes("/"));
  if (allShare && hasNested && paths.some((p) => p.startsWith(`${first}/`))) return first;
  return "";
}

function findEocd(view: DataView): number {
  const len = view.byteLength;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue;
    const commentLen = view.getUint16(i + 20, true);
    if (i + 22 + commentLen === len) return i;
  }
  throw new Error("Not a zip archive.");
}

function isLikelyText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  const n = Math.min(bytes.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious += 1;
  }
  return suspicious / n < 0.12;
}

export function unpackZipToTextFiles(
  buffer: ArrayBuffer,
  limits = GITHUB_ARCHIVE_LIMITS,
): { files: UnpackedTextFile[]; skipped: SkippedPath[]; errors: string[] } {
  const errors: string[] = [];
  const skipped: SkippedPath[] = [];
  const files: UnpackedTextFile[] = [];

  if (!buffer || buffer.byteLength < 22) {
    return { files: [], skipped: [], errors: ["Zip is empty."] };
  }
  if (buffer.byteLength > limits.maxZipBytes) {
    return {
      files: [],
      skipped: [],
      errors: [`Zip is larger than ${Math.round(limits.maxZipBytes / (1024 * 1024))}MB.`],
    };
  }

  const view = new DataView(buffer);
  let eocd: number;
  try {
    eocd = findEocd(view);
  } catch (err) {
    return { files: [], skipped: [], errors: [err instanceof Error ? err.message : String(err)] };
  }

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > view.byteLength) {
    return { files: [], skipped: [], errors: ["Zip central directory is truncated."] };
  }

  type Raw = { path: string; bytes: Uint8Array };
  const rawEntries: Raw[] = [];
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) {
      errors.push("Zip central directory is corrupt.");
      break;
    }
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const uncompSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = new Uint8Array(buffer, cursor + 46, nameLen);
    const path = new TextDecoder("utf-8").decode(nameBytes);
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!path || path.endsWith("/")) continue;
    if (archivePathIsHeavy(path)) {
      skipped.push({ path, reason: "ignored folder or binary" });
      continue;
    }
    if (uncompSize > limits.maxFileBytes) {
      skipped.push({ path, reason: `larger than ${Math.round(limits.maxFileBytes / 1024)}KB` });
      continue;
    }
    totalUncompressed += uncompSize;
    if (totalUncompressed > limits.maxZipBytes * 2) break;

    if (localOffset + 30 > view.byteLength) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > view.byteLength) continue;
    const raw = new Uint8Array(buffer, dataStart, compSize);

    let bytes: Uint8Array;
    try {
      if (method === 0) bytes = raw.slice();
      else if (method === 8) bytes = new Uint8Array(inflateRawSync(raw));
      else {
        skipped.push({ path, reason: `unsupported compression ${method}` });
        continue;
      }
    } catch {
      skipped.push({ path, reason: "could not inflate" });
      continue;
    }
    rawEntries.push({ path, bytes });
  }

  const root = stripCommonRoot(rawEntries.map((e) => e.path));
  let total = 0;
  for (const entry of rawEntries) {
    if (files.length >= limits.maxFiles) {
      errors.push(`Import capped at ${limits.maxFiles} files — extra paths were not added.`);
      break;
    }
    let rel = entry.path;
    if (root && rel.startsWith(`${root}/`)) rel = rel.slice(root.length + 1);
    if (!rel || archivePathIsHeavy(rel)) continue;
    if (!isLikelyText(entry.bytes)) {
      skipped.push({ path: rel, reason: "binary file the editor cannot open" });
      continue;
    }
    total += entry.bytes.length;
    if (total > limits.maxTotalBytes) {
      errors.push(`Import exceeded the ${Math.round(limits.maxTotalBytes / 1024)}KB text budget.`);
      break;
    }
    files.push({ path: rel, content: new TextDecoder("utf-8").decode(entry.bytes) });
  }

  return { files, skipped, errors };
}

export async function fetchGithubArchiveFiles(
  ref: GithubArchiveRef,
  fetchImpl: typeof fetch = fetch,
  limits = GITHUB_ARCHIVE_LIMITS,
): Promise<{ files: UnpackedTextFile[]; skipped: SkippedPath[]; errors: string[] }> {
  const urls = githubCodeloadUrls(ref);
  let lastStatus = 0;
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      lastStatus = 0;
      continue;
    }
    lastStatus = res.status;
    if (!res.ok) continue;
    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > limits.maxZipBytes) {
      return {
        files: [],
        skipped: [],
        errors: [`Zip is larger than ${Math.round(limits.maxZipBytes / (1024 * 1024))}MB.`],
      };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > limits.maxZipBytes) {
      return {
        files: [],
        skipped: [],
        errors: [`Zip is larger than ${Math.round(limits.maxZipBytes / (1024 * 1024))}MB.`],
      };
    }
    const magic = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (magic[0] !== 0x50 || magic[1] !== 0x4b) continue;
    return unpackZipToTextFiles(buf, limits);
  }
  return {
    files: [],
    skipped: [],
    errors: [
      lastStatus === 404
        ? `GitHub repo ${ref.owner}/${ref.repo} (${ref.branch}) was not found.`
        : `Could not download ${ref.owner}/${ref.repo} from GitHub.`,
    ],
  };
}

export function buildStoreZip(files: { path: string; content: string | Uint8Array }[]): ArrayBuffer {
  // Test helper: uncompressed (STORE) zip so unit tests don't need inflate.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);
    const localOffset = offset;
    offset += local.length + data.length;
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of centrals) {
    parts.push(c);
    cdSize += c.length;
    offset += c.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  parts.push(eocd);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}
