// Client-side Codespace import: local files, a folder picker, or a zip of a
// repo, unpacked into the in-memory project file tree (then persisted through
// the existing CodespaceProject store path). Session snapshots under
// `.sessions/` are never replaced by an import.

import { isSessionPath } from "./projectModel";
import { unzipToEntries } from "./zipCodec";

export const IMPORT_LIMITS = {
  maxFileBytes: 512 * 1024,
  maxFiles: 250,
  maxZipBytes: 8 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
};

// GitHub monorepo pulls are larger on the wire; the editor still caps how
// much text lands in the tree after skipping node_modules / dist / lockfiles.
export const PULL_LIMITS = {
  maxFileBytes: 512 * 1024,
  maxFiles: 400,
  maxZipBytes: 32 * 1024 * 1024,
  maxTotalBytes: 3 * 1024 * 1024,
};

export const DEFAULT_PULL_REPO = {
  owner: "davins56",
  repo: "Anima-Protocol",
  branch: "main",
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
  "psd", "ai", "sketch", "fig",
]);

const TEXT_EXTS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "json", "jsonc", "html", "htm", "css", "scss", "sass", "less",
  "py", "pyi", "md", "mdx", "txt", "svg", "xml", "yml", "yaml",
  "toml", "ini", "cfg", "conf", "sh", "bash", "zsh", "fish",
  "vue", "svelte", "astro", "graphql", "gql", "sql", "csv",
  "rs", "go", "java", "kt", "kts", "rb", "php",
  "c", "h", "cpp", "hpp", "cc", "hh", "cs", "swift",
  "r", "lua", "pl", "pm", "zig", "nim",
  "gitignore", "gitattributes", "editorconfig",
  "prettierrc", "prettierignore", "eslintignore", "npmrc", "nvmrc",
  "browserslist", "babelrc", "dockerignore",
]);

const TEXT_BASENAMES = new Set([
  "makefile",
  "dockerfile",
  "license",
  "licence",
  "readme",
  "gemfile",
  "procfile",
  "rakefile",
  "vagrantfile",
  "jenkinsfile",
  "cmakelists.txt",
]);

export function extensionOf(path = "") {
  const base = String(path).split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function basenameOf(path = "") {
  return (String(path).split("/").pop() || "").toLowerCase();
}

export function sanitizeImportPath(raw = "") {
  let p = String(raw).replace(/\\/g, "/").trim();
  p = p.replace(/^\.\/+/, "");
  p = p.replace(/^\/+/, "");
  if (!p) return { ok: false, reason: "empty path" };

  const parts = p.split("/").filter((s) => s && s !== ".");
  if (parts.length === 0) return { ok: false, reason: "empty path" };
  if (parts.some((s) => s === "..")) return { ok: false, reason: "path traversal" };

  const joined = parts.join("/");
  if (joined === ".sessions" || isSessionPath(joined) || parts[0] === ".sessions") {
    return { ok: false, reason: "session folder is reserved" };
  }

  const lowerParts = parts.map((s) => s.toLowerCase());
  if (lowerParts.some((s) => SKIP_DIRS.has(s))) {
    return { ok: false, reason: "ignored folder" };
  }

  const name = parts[parts.length - 1];
  const lowerName = name.toLowerCase();
  if (SKIP_FILES.has(lowerName)) return { ok: false, reason: "ignored file" };
  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return { ok: false, reason: "secret file skipped" };
  }

  return { ok: true, path: joined };
}

// True when a raw zip path (including GitHub's wrapping folder) should not
// even be inflated — node_modules, dist, lockfiles, secrets, binaries, etc.
export function archivePathIsSkipped(raw = "") {
  const p = String(raw).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return true;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === "..")) return true;
  const lowerParts = parts.map((s) => s.toLowerCase());
  if (lowerParts.some((s) => SKIP_DIRS.has(s))) return true;
  const name = lowerParts[lowerParts.length - 1] || "";
  if (SKIP_FILES.has(name)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (parts[0] === ".sessions" || lowerParts.includes(".sessions")) return true;
  const ext = extensionOf(p);
  if (BINARY_EXTS.has(ext)) return true;
  return false;
}

export function stripCommonRoot(paths = []) {
  if (!paths.length) return "";
  const first = String(paths[0]).split("/")[0];
  if (!first) return "";
  const allShare = paths.every((p) => p === first || String(p).startsWith(`${first}/`));
  const hasNested = paths.some((p) => String(p).includes("/"));
  if (allShare && hasNested && paths.some((p) => String(p).startsWith(`${first}/`))) {
    return first;
  }
  return "";
}

export function isLikelyTextBytes(bytes) {
  if (!bytes || !bytes.length) return true;
  const n = Math.min(bytes.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious += 1;
  }
  return suspicious / n < 0.12;
}

export function isImportableTextPath(path) {
  const ext = extensionOf(path);
  if (BINARY_EXTS.has(ext)) return false;
  if (TEXT_EXTS.has(ext)) return true;
  const base = basenameOf(path);
  if (TEXT_BASENAMES.has(base)) return true;
  // Extensionless or unknown: let the byte sniff decide later.
  return ext === "";
}

function decodeText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function toUint8(entry) {
  const b = entry?.bytes;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (b && typeof b.byteLength === "number" && typeof b.length === "number") {
    return b instanceof Uint8Array ? b : Uint8Array.from(b);
  }
  if (typeof entry?.content === "string") return new TextEncoder().encode(entry.content);
  return new Uint8Array();
}

function classifyEntry(path, bytes, limits = IMPORT_LIMITS) {
  const sanitized = sanitizeImportPath(path);
  if (!sanitized.ok) return { skip: true, path, reason: sanitized.reason };

  if (bytes.length > limits.maxFileBytes) {
    return { skip: true, path: sanitized.path, reason: `larger than ${Math.round(limits.maxFileBytes / 1024)}KB` };
  }

  const ext = extensionOf(sanitized.path);
  if (BINARY_EXTS.has(ext)) {
    return { skip: true, path: sanitized.path, reason: "binary file the editor cannot open" };
  }

  if (!isImportableTextPath(sanitized.path) && ext) {
    return { skip: true, path: sanitized.path, reason: "binary file the editor cannot open" };
  }

  if (!isLikelyTextBytes(bytes)) {
    return { skip: true, path: sanitized.path, reason: "binary file the editor cannot open" };
  }

  return { skip: false, path: sanitized.path, content: decodeText(bytes) };
}

// Turn raw { path, bytes } entries into project files + skip/error reports.
export function filesFromEntries(rawEntries = [], { stripRoot = true, limits = IMPORT_LIMITS } = {}) {
  const errors = [];
  const skipped = [];
  let working = rawEntries.map((e) => ({
    path: String(e.path || ""),
    bytes: toUint8(e),
  }));

  if (stripRoot) {
    const root = stripCommonRoot(working.map((e) => e.path));
    if (root) {
      working = working
        .filter((e) => e.path !== root && e.path.startsWith(`${root}/`))
        .map((e) => ({ ...e, path: e.path.slice(root.length + 1) }));
    }
  }

  const files = [];
  let total = 0;
  for (const entry of working) {
    if (files.length >= limits.maxFiles) {
      errors.push(`Import capped at ${limits.maxFiles} files — extra paths were not added.`);
      break;
    }
    const classified = classifyEntry(entry.path, entry.bytes, limits);
    if (classified.skip) {
      skipped.push({ path: classified.path, reason: classified.reason });
      continue;
    }
    total += entry.bytes.length;
    if (total > limits.maxTotalBytes) {
      errors.push(`Import exceeded the ${Math.round(limits.maxTotalBytes / 1024)}KB text budget.`);
      break;
    }
    files.push({ path: classified.path, content: classified.content });
  }

  return { files, skipped, errors };
}

// Always keep existing `.sessions/` snapshots. `replaceWorkspace` swaps the
// visible project files for a repo/folder import; merge overwrites same paths.
export function mergeImportedFiles(existing = [], incoming = [], { replaceWorkspace = false } = {}) {
  const sessions = existing.filter((f) => isSessionPath(f.path));
  const incomingClean = (incoming || []).filter((f) => f && f.path && !isSessionPath(f.path));

  if (replaceWorkspace) {
    return [...incomingClean, ...sessions];
  }

  const byPath = new Map();
  for (const f of existing) {
    if (!isSessionPath(f.path)) byPath.set(f.path, f);
  }
  for (const f of incomingClean) {
    byPath.set(f.path, { path: f.path, content: f.content ?? "" });
  }
  return [...byPath.values(), ...sessions];
}

function relativePathFromFile(file) {
  const rel = file.webkitRelativePath || file.relativePath || "";
  if (rel && rel !== file.name) return rel;
  return file.name || "";
}

async function readFileBytes(file) {
  if (file.arrayBuffer) {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (typeof FileReader !== "undefined") {
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Could not read file."));
      reader.readAsArrayBuffer(file);
    });
    return bytes;
  }
  throw new Error("This browser cannot read local files.");
}

export async function importFromBrowserFiles(fileList, { mode = "files", limits = IMPORT_LIMITS } = {}) {
  const list = Array.from(fileList || []).filter(Boolean);
  if (!list.length) {
    return { files: [], skipped: [], errors: ["No files were selected."] };
  }

  const entries = [];
  const skipped = [];
  for (const file of list) {
    const path = relativePathFromFile(file);
    if (typeof file.size === "number" && file.size > limits.maxFileBytes && mode === "files") {
      skipped.push({ path: path || file.name, reason: `larger than ${Math.round(limits.maxFileBytes / 1024)}KB` });
      continue;
    }
    try {
      const bytes = await readFileBytes(file);
      entries.push({ path, bytes });
    } catch (err) {
      skipped.push({ path: path || file.name, reason: err?.message || "could not read" });
    }
  }

  const result = filesFromEntries(entries, { stripRoot: mode === "folder", limits });
  return {
    files: result.files,
    skipped: [...skipped, ...result.skipped],
    errors: result.errors,
  };
}

export async function importFromZipBuffer(buffer, { limits = IMPORT_LIMITS } = {}) {
  const size = buffer?.byteLength ?? 0;
  if (size === 0) {
    return { files: [], skipped: [], errors: ["Zip is empty."] };
  }
  if (size > limits.maxZipBytes) {
    return {
      files: [],
      skipped: [],
      errors: [`Zip is larger than ${Math.round(limits.maxZipBytes / (1024 * 1024))}MB.`],
    };
  }
  try {
    const raw = await unzipToEntries(buffer, {
      maxUncompressedBytes: limits.maxZipBytes,
      skipPath: archivePathIsSkipped,
    });
    return filesFromEntries(raw, { stripRoot: true, limits });
  } catch (err) {
    return { files: [], skipped: [], errors: [err?.message || "Could not unpack zip."] };
  }
}

export async function importFromZipFile(file, { limits = IMPORT_LIMITS } = {}) {
  if (!file) return { files: [], skipped: [], errors: ["No zip selected."] };
  if (typeof file.size === "number" && file.size > limits.maxZipBytes) {
    return {
      files: [],
      skipped: [],
      errors: [`Zip is larger than ${Math.round(limits.maxZipBytes / (1024 * 1024))}MB.`],
    };
  }
  try {
    const buffer = file.arrayBuffer ? await file.arrayBuffer() : (await readFileBytes(file)).buffer;
    return importFromZipBuffer(buffer, { limits });
  } catch (err) {
    return { files: [], skipped: [], errors: [err?.message || "Could not read zip."] };
  }
}

export function parseGithubRepoUrl(input = "") {
  const raw = String(input).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^git\+/i, "").replace(/\.git$/i, "");
  const hosted = cleaned.match(/(?:github\.com[/:]|git@github\.com:)([\w.-]+)\/([\w.-]+)/i);
  if (hosted) return { owner: hosted[1], repo: hosted[2].replace(/\.git$/i, "") };
  const short = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  return null;
}

export function githubDownloadZipUrl(owner, repo, branch = "main") {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
}

export function githubCodeloadZipUrl(owner, repo, branch = "main") {
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
}

export function normalizePullSpec(input = {}) {
  if (typeof input === "string") {
    const parsed = parseGithubRepoUrl(input);
    if (!parsed) return null;
    return { owner: parsed.owner, repo: parsed.repo, branch: "main" };
  }
  const parsed = parseGithubRepoUrl(
    input.owner && input.repo ? `${input.owner}/${input.repo}` : input.url || "",
  );
  if (!parsed) return null;
  const branch = String(input.branch || DEFAULT_PULL_REPO.branch || "main").trim() || "main";
  if (branch.includes("..") || branch.startsWith("/") || branch.includes("\\")) return null;
  return { owner: parsed.owner, repo: parsed.repo, branch };
}

export function summarizeImport(result) {
  const n = result?.files?.length || 0;
  const skipped = result?.skipped?.length || 0;
  const parts = [`Imported ${n} file${n === 1 ? "" : "s"} into the weave.`];
  if (skipped) {
    const preview = result.skipped
      .slice(0, 6)
      .map((s) => `${s.path} (${s.reason})`)
      .join("; ");
    parts.push(`Skipped ${skipped}: ${preview}`);
  }
  return parts.join(" ");
}
