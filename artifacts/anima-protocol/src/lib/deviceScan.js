/**
 * Anima device scan — flags leftover / unnecessary data on this device.
 *
 * The companion never deletes anything on its own. Origin storage (this site's
 * localStorage, caches, IndexedDB names) can be inspected after the user grants
 * device-scan permission. A folder on disk is only read after they pick it with
 * the browser's directory picker. File contents are never uploaded.
 */

export const DEVICE_SCAN_PERMISSION_KEY = "anima_device_scan_permission";

export const LARGE_KEY_BYTES = 50 * 1024;
export const QUOTA_PRESSURE_RATIO = 0.8;
export const FOLDER_SCAN_MAX_FILES = 500;
export const FOLDER_SCAN_MAX_DEPTH = 4;

const KEEP_KEYS = new Set([
  DEVICE_SCAN_PERMISSION_KEY,
  "anima_analytics_consent",
  "ai_disclaimer_accepted",
  "anima_age_verified_mature",
  "app-color-scheme",
  "focus_mode",
  "anima_server_migration_v1",
  "anima_tutorial_seen_v1",
  "anima_photo_attempts_v1",
]);

const KEEP_PREFIXES = [
  "serenity_seen_",
  "seeded_",
  "clerk",
  "__clerk",
];

const LEFTOVER_EXACT = new Set([
  "anima_auth_user",
  "SHOW_TAP_TARGETS",
]);

const JUNK_FILE_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "ehthumbs.db",
  "desktop.ini",
  "icon\r",
]);

const JUNK_DIR_NAMES = new Set(["__macosx", ".tmp", "tmp"]);

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".svn", ".hg"]);

const SCAN_ACTION_RE =
  /\b(scan|clean(?:\s*up)?|flag|find|check|inspect|look\s+through|look\s+over)\b/i;
const SCAN_TARGET_RE =
  /\b(device|phone|computer|laptop|storage|disk|drive|junk|cache|leftover|clutter|unnecessary\s+data|temp(?:orary)?\s+files?)\b/i;
const FOLDER_RE =
  /\b(folder|directory|downloads?|files?)\b/i;
const JUNK_RE =
  /\b(junk|unnecessary|leftover|unused|stale|temp(?:orary)?|cache|clutter|cleanup|clean\s+up)\b/i;
const LORE_RE =
  /\b(lore|wiki|codex|quest|inventory|code(?:space)?|source|protocol|character|companion|message|chat)\b/i;

function none(reason) {
  return {
    isScan: false,
    shouldScan: false,
    includeFolder: false,
    confidence: "none",
    reason,
  };
}

export function compactScanRequest(value, max = 2000) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Detect a request for the Anima to scan this device for leftover data.
 * Conservative: ordinary chat about "finding" a character must not hijack.
 */
export function classifyDeviceScanRequest(raw) {
  const text = compactScanRequest(raw);
  if (!text) return none("empty");

  const hasAction = SCAN_ACTION_RE.test(text);
  const hasTarget = SCAN_TARGET_RE.test(text);
  const hasJunk = JUNK_RE.test(text);
  const hasFolder = FOLDER_RE.test(text);
  const loreOnly = LORE_RE.test(text) && !hasTarget && !hasJunk;

  if (loreOnly) return none("lore_or_story");
  if (!hasAction) return none("no_scan_action");
  if (!hasTarget && !hasJunk) return none("no_device_target");

  const explicit =
    /\bscan\b.{0,40}\b(device|storage|folder|files?|downloads?|junk|disk)\b/i.test(text) ||
    /\b(unnecessary|leftover|junk)\s+data\b/i.test(text) ||
    /\bclean(?:\s*up)?\b.{0,24}\b(device|storage|junk|files?|cache)\b/i.test(text);

  const includeFolder = hasFolder || /\b(files?|downloads?|folder|directory)\b/i.test(text);
  const confidence = explicit ? "high" : hasAction && (hasTarget || hasJunk) ? "medium" : "low";

  return {
    isScan: true,
    shouldScan: confidence === "high" || confidence === "medium",
    includeFolder,
    confidence,
    reason: explicit ? "explicit_scan" : "action_and_target",
  };
}

export function isTalkingToAnima({ activeSession, characters } = {}) {
  if (!activeSession || activeSession.mode === "group") return false;
  const id = activeSession.character_id;
  if (!id) return false;
  const active = (characters || []).find((c) => c?.id && c.id === id);
  return Boolean(active?._isAnima);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readDeviceScanPermission() {
  try {
    const raw = localStorage.getItem(DEVICE_SCAN_PERMISSION_KEY);
    if (!raw) return { granted: false, grantedAt: null, animaId: null };
    if (raw === "1" || raw === "true") {
      return { granted: true, grantedAt: null, animaId: null };
    }
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { granted: false, grantedAt: null, animaId: null };
    }
    return {
      granted: parsed.granted === true,
      grantedAt: typeof parsed.grantedAt === "string" ? parsed.grantedAt : null,
      animaId: typeof parsed.animaId === "string" ? parsed.animaId : null,
    };
  } catch {
    return { granted: false, grantedAt: null, animaId: null };
  }
}

export function hasDeviceScanPermission() {
  return readDeviceScanPermission().granted === true;
}

export function writeDeviceScanPermission(granted, animaId = null) {
  const payload = {
    granted: Boolean(granted),
    grantedAt: granted ? new Date().toISOString() : null,
    animaId: animaId || null,
  };
  try {
    if (granted) {
      localStorage.setItem(DEVICE_SCAN_PERMISSION_KEY, JSON.stringify(payload));
    } else {
      localStorage.removeItem(DEVICE_SCAN_PERMISSION_KEY);
    }
  } catch {
    /* quota / private mode */
  }
  return payload;
}

function keepByPrefix(key) {
  return KEEP_PREFIXES.some((prefix) => key.startsWith(prefix) || key.toLowerCase().startsWith(prefix));
}

/**
 * Classify a single origin localStorage key.
 * @param {string} key
 * @param {{ bytes?: number, migrated?: boolean }} [opts]
 */
export function classifyLocalStorageKey(key, opts = {}) {
  const bytes = Number(opts.bytes) || 0;
  const migrated = opts.migrated === true;

  if (!key) {
    return { status: "keep", reason: "empty_key", removable: false, severity: "none" };
  }
  if (KEEP_KEYS.has(key) || keepByPrefix(key)) {
    return { status: "keep", reason: "active_preference", removable: false, severity: "none" };
  }
  if (LEFTOVER_EXACT.has(key)) {
    return {
      status: "flag",
      reason: "legacy_leftover",
      removable: true,
      severity: "medium",
    };
  }
  if (key.startsWith("anima_entity_")) {
    return {
      status: "flag",
      reason: migrated ? "migrated_local_copy" : "legacy_entity_store",
      removable: migrated,
      severity: migrated ? "high" : "medium",
    };
  }
  if (/tmp|cache|debug|backup|\.old$|_old$|_bak$/i.test(key)) {
    return { status: "flag", reason: "temp_or_debug", removable: true, severity: "medium" };
  }
  if (bytes >= LARGE_KEY_BYTES) {
    return { status: "flag", reason: "oversized_unknown", removable: false, severity: "low" };
  }
  return { status: "keep", reason: "unknown_small", removable: false, severity: "none" };
}

export function byteLengthOf(value) {
  if (value == null) return 0;
  try {
    return new Blob([String(value)]).size;
  } catch {
    return String(value).length;
  }
}

export function formatBytes(n) {
  const bytes = Math.max(0, Number(n) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * @param {{ key: string, value?: string }[]} entries
 * @param {{ migrated?: boolean }} [opts]
 */
export function flagLocalStorageEntries(entries, opts = {}) {
  const migrated = opts.migrated === true;
  const flags = [];
  let kept = 0;
  let bytes = 0;
  for (const entry of entries || []) {
    const key = String(entry?.key || "");
    const size = byteLengthOf(entry?.value);
    bytes += size + byteLengthOf(key);
    const verdict = classifyLocalStorageKey(key, { bytes: size, migrated });
    if (verdict.status === "flag") {
      flags.push({
        id: `ls:${key}`,
        kind: "localStorage",
        label: key,
        detail: verdict.reason,
        bytes: size,
        removable: verdict.removable,
        severity: verdict.severity,
      });
    } else {
      kept += 1;
    }
  }
  return { flags, kept, bytes };
}

export function classifyJunkFile({ name, size = 0, path = "", isDirectory = false } = {}) {
  const base = String(name || "").trim();
  const lower = base.toLowerCase();
  const rel = String(path || base);

  if (!base) return { flag: false, reason: "empty", severity: "none" };
  if (isDirectory) {
    if (JUNK_DIR_NAMES.has(lower)) {
      return { flag: true, reason: "junk_folder", severity: "medium" };
    }
    return { flag: false, reason: "directory", severity: "none" };
  }
  if (JUNK_FILE_NAMES.has(lower)) {
    return { flag: true, reason: "os_cruft", severity: "high" };
  }
  if (/\.(tmp|temp|bak|old|swp|swo|part|crdownload)$/i.test(lower) || /~$/.test(base)) {
    return { flag: true, reason: "temp_backup", severity: "high" };
  }
  if (/\.log$/i.test(lower) && size >= 1024 * 1024) {
    return { flag: true, reason: "large_log", severity: "medium" };
  }
  if (size === 0 && !lower.startsWith(".")) {
    return { flag: true, reason: "empty_file", severity: "low" };
  }
  if (/copy\s*\(\d+\)|[-_ ]copy\./i.test(rel) || / \(\d+\)\.[^.]+$/.test(base)) {
    return { flag: true, reason: "duplicate_name", severity: "low" };
  }
  return { flag: false, reason: "ok", severity: "none" };
}

/**
 * @param {{ name: string, size?: number, path?: string, isDirectory?: boolean }[]} entries
 */
export function flagFolderEntries(entries) {
  const flags = [];
  let scanned = 0;
  let bytes = 0;
  for (const entry of entries || []) {
    scanned += 1;
    const size = Number(entry?.size) || 0;
    bytes += size;
    const verdict = classifyJunkFile(entry);
    if (verdict.flag) {
      flags.push({
        id: `fs:${entry.path || entry.name}`,
        kind: "file",
        label: entry.path || entry.name,
        detail: verdict.reason,
        bytes: size,
        removable: false,
        severity: verdict.severity,
      });
    }
  }
  return { flags, scanned, bytes };
}

export function emptyScanReport() {
  return {
    scannedAt: new Date().toISOString(),
    permission: false,
    origin: {
      quota: null,
      localStorage: { flags: [], kept: 0, bytes: 0 },
      sessionStorageKeys: 0,
      caches: [],
      indexedDb: [],
      serviceWorkers: 0,
    },
    folder: null,
    flags: [],
    error: null,
  };
}

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

export function collectFlags(report) {
  const flags = [
    ...(report?.origin?.localStorage?.flags || []),
    ...(report?.folder?.flags || []),
  ];
  if (report?.origin?.quota?.pressure) {
    flags.push({
      id: "quota:pressure",
      kind: "quota",
      label: "Browser storage pressure",
      detail: "This site is using most of its device quota.",
      bytes: report.origin.quota.usage || 0,
      removable: false,
      severity: "medium",
    });
  }
  flags.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return flags;
}

export function summarizeScan(report) {
  const flags = report?.flags || collectFlags(report);
  const high = flags.filter((f) => f.severity === "high").length;
  const medium = flags.filter((f) => f.severity === "medium").length;
  const low = flags.filter((f) => f.severity === "low").length;
  return {
    flagCount: flags.length,
    high,
    medium,
    low,
    removableCount: flags.filter((f) => f.removable).length,
    folderScanned: Boolean(report?.folder),
    folderFiles: report?.folder?.scanned || 0,
  };
}

export function buildScanNarrative(report, animaName = "your Anima") {
  const name = animaName || "your Anima";
  if (!report?.permission) {
    return `${name} can look through leftover data on this device, but only after you grant permission. Nothing is deleted unless you choose it.`;
  }
  const summary = summarizeScan(report);
  if (summary.flagCount === 0) {
    return report.folder
      ? `${name} scanned this site's storage and the folder you chose. Nothing unnecessary stood out.`
      : `${name} scanned this site's storage on the device. Nothing unnecessary stood out.`;
  }
  const parts = [];
  if (summary.high) parts.push(`${summary.high} high`);
  if (summary.medium) parts.push(`${summary.medium} medium`);
  if (summary.low) parts.push(`${summary.low} low`);
  const severity = parts.length ? ` (${parts.join(", ")})` : "";
  const folderNote = report.folder
    ? ` Folder scan covered ${summary.folderFiles} item${summary.folderFiles === 1 ? "" : "s"}.`
    : "";
  const clearNote = summary.removableCount
    ? ` ${summary.removableCount} leftover site ${summary.removableCount === 1 ? "item is" : "items are"} safe to clear if you want.`
    : " Flagged files are listed only — nothing was deleted.";
  return `${name} flagged ${summary.flagCount} unnecessary item${summary.flagCount === 1 ? "" : "s"}${severity}.${folderNote}${clearNote}`;
}

function listStorageEntries(storage) {
  if (!storage) return [];
  const entries = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      let value = "";
      try {
        value = storage.getItem(key) || "";
      } catch {
        value = "";
      }
      entries.push({ key, value });
    }
  } catch {
    /* storage blocked */
  }
  return entries;
}

async function listCacheNames() {
  try {
    if (typeof caches === "undefined" || !caches?.keys) return [];
    const names = await caches.keys();
    return names.map((name) => ({ name }));
  } catch {
    return [];
  }
}

async function listIndexedDbNames() {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") {
      return [];
    }
    const dbs = await indexedDB.databases();
    return (dbs || [])
      .map((db) => ({ name: db?.name || "(unnamed)", version: db?.version || null }))
      .filter((db) => db.name);
  } catch {
    return [];
  }
}

async function countServiceWorkers() {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistrations) {
      return 0;
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length;
  } catch {
    return 0;
  }
}

async function estimateQuota() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    const usage = Number(estimate?.usage) || 0;
    const quota = Number(estimate?.quota) || 0;
    const ratio = quota > 0 ? usage / quota : 0;
    return {
      usage,
      quota,
      ratio,
      pressure: quota > 0 && ratio >= QUOTA_PRESSURE_RATIO,
    };
  } catch {
    return null;
  }
}

/**
 * Scan this origin's device storage. Requires permission.
 */
export async function scanOriginStorage() {
  const report = emptyScanReport();
  report.permission = hasDeviceScanPermission();
  if (!report.permission) {
    report.error = "permission_denied";
    report.flags = [];
    return report;
  }

  let migrated = false;
  try {
    migrated = localStorage.getItem("anima_server_migration_v1") === "1";
  } catch {
    migrated = false;
  }

  const ls = flagLocalStorageEntries(listStorageEntries(globalThis.localStorage), { migrated });
  report.origin.localStorage = ls;
  try {
    report.origin.sessionStorageKeys = globalThis.sessionStorage?.length || 0;
  } catch {
    report.origin.sessionStorageKeys = 0;
  }
  report.origin.caches = await listCacheNames();
  report.origin.indexedDb = await listIndexedDbNames();
  report.origin.serviceWorkers = await countServiceWorkers();
  report.origin.quota = await estimateQuota();
  report.flags = collectFlags(report);
  return report;
}

async function walkDirectory(handle, prefix, depth, acc, limits) {
  if (!handle || acc.truncated) return;
  if (depth > limits.maxDepth) return;
  try {
    for await (const [name, child] of handle.entries()) {
      if (acc.entries.length >= limits.maxFiles) {
        acc.truncated = true;
        return;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === "directory") {
        const skip = SKIP_DIR_NAMES.has(String(name).toLowerCase());
        acc.entries.push({
          name,
          path,
          size: 0,
          isDirectory: true,
        });
        if (!skip) {
          await walkDirectory(child, path, depth + 1, acc, limits);
        }
      } else {
        let size = 0;
        try {
          const file = await child.getFile();
          size = file?.size || 0;
        } catch {
          size = 0;
        }
        acc.entries.push({
          name,
          path,
          size,
          isDirectory: false,
        });
      }
    }
  } catch {
    /* permission revoked mid-walk */
  }
}

export function canPickDirectory() {
  return typeof globalThis.showDirectoryPicker === "function";
}

/**
 * Prompt for a folder and flag junk files. Requires device-scan permission.
 * Returns the origin report merged with folder findings.
 */
export async function scanPickedDirectory(directoryHandle, originReport) {
  const report = originReport || emptyScanReport();
  report.permission = hasDeviceScanPermission();
  if (!report.permission) {
    report.error = "permission_denied";
    report.flags = collectFlags(report);
    return report;
  }
  if (!directoryHandle) {
    report.folder = { flags: [], scanned: 0, bytes: 0, truncated: false, name: null };
    report.flags = collectFlags(report);
    return report;
  }

  const acc = { entries: [], truncated: false };
  await walkDirectory(directoryHandle, "", 0, acc, {
    maxFiles: FOLDER_SCAN_MAX_FILES,
    maxDepth: FOLDER_SCAN_MAX_DEPTH,
  });
  const flagged = flagFolderEntries(acc.entries);
  report.folder = {
    ...flagged,
    truncated: acc.truncated,
    name: directoryHandle.name || "folder",
  };
  report.flags = collectFlags(report);
  return report;
}

export async function pickDirectoryHandle() {
  if (!canPickDirectory()) {
    throw Object.assign(new Error("Folder picking is not supported in this browser."), {
      code: "unsupported",
    });
  }
  return globalThis.showDirectoryPicker({ mode: "read" });
}

/**
 * Remove flagged origin localStorage keys that were marked removable.
 * Never touches files on disk.
 */
export function clearRemovableOriginFlags(flags) {
  const cleared = [];
  const skipped = [];
  for (const flag of flags || []) {
    if (!flag?.removable || flag.kind !== "localStorage") {
      skipped.push(flag);
      continue;
    }
    const key = String(flag.label || "");
    if (!key || KEEP_KEYS.has(key) || keepByPrefix(key)) {
      skipped.push(flag);
      continue;
    }
    try {
      localStorage.removeItem(key);
      cleared.push(flag);
    } catch {
      skipped.push(flag);
    }
  }
  return { cleared, skipped };
}

export const DEVICE_SCAN_PROMPT =
  "You may scan this device for leftover or unnecessary data only after they have granted device-scan permission. If they ask without permission, tell them they can grant it in Customise Anima, Settings → Data & Privacy, or on the scan card in this chat. Never claim you deleted files or uploaded their contents; you only flag findings for their review.\n";
