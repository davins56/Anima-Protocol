import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyDeviceScanRequest,
  isTalkingToAnima,
  classifyLocalStorageKey,
  flagLocalStorageEntries,
  classifyJunkFile,
  flagFolderEntries,
  summarizeScan,
  buildScanNarrative,
  collectFlags,
  writeDeviceScanPermission,
  hasDeviceScanPermission,
  readDeviceScanPermission,
  scanOriginStorage,
  DEVICE_SCAN_PERMISSION_KEY,
  LARGE_KEY_BYTES,
} from "./deviceScan";

describe("classifyDeviceScanRequest", () => {
  it("detects explicit device scans", () => {
    expect(classifyDeviceScanRequest("scan my device for unnecessary data").shouldScan).toBe(
      true,
    );
    expect(classifyDeviceScanRequest("Can you scan this device for junk?").shouldScan).toBe(
      true,
    );
    expect(classifyDeviceScanRequest("flag leftover data on my laptop").shouldScan).toBe(true);
    expect(classifyDeviceScanRequest("clean up junk files on my phone").includeFolder).toBe(
      true,
    );
    expect(classifyDeviceScanRequest("scan my device for leftover data").includeFolder).toBe(
      false,
    );
  });

  it("detects folder / downloads wording", () => {
    const result = classifyDeviceScanRequest("scan my Downloads folder for temp files");
    expect(result.shouldScan).toBe(true);
    expect(result.includeFolder).toBe(true);
  });

  it("does not hijack ordinary chat", () => {
    expect(classifyDeviceScanRequest("I missed you tonight.").isScan).toBe(false);
    expect(classifyDeviceScanRequest("scan the lore for that prophecy").shouldScan).toBe(
      false,
    );
    expect(classifyDeviceScanRequest("find my character in the roster").isScan).toBe(false);
    expect(classifyDeviceScanRequest("check my inventory").shouldScan).toBe(false);
  });
});

describe("isTalkingToAnima", () => {
  it("is true for a solo Anima session", () => {
    expect(
      isTalkingToAnima({
        activeSession: { mode: "solo", character_id: "a1" },
        characters: [{ id: "a1", name: "Lumen", _isAnima: true }],
      }),
    ).toBe(true);
  });

  it("is false for group or roster characters", () => {
    expect(
      isTalkingToAnima({
        activeSession: { mode: "group", character_id: "a1", group_character_ids: ["a1"] },
        characters: [{ id: "a1", _isAnima: true }],
      }),
    ).toBe(false);
    expect(
      isTalkingToAnima({
        activeSession: { mode: "solo", character_id: "c2" },
        characters: [{ id: "c2", name: "Korra", _isAnima: false }],
      }),
    ).toBe(false);
  });
});

describe("classifyLocalStorageKey", () => {
  it("keeps live preferences", () => {
    expect(classifyLocalStorageKey("anima_analytics_consent").status).toBe("keep");
    expect(classifyLocalStorageKey("ai_disclaimer_accepted").status).toBe("keep");
    expect(classifyLocalStorageKey("app-color-scheme").status).toBe("keep");
    expect(classifyLocalStorageKey("serenity_seen_first_day").status).toBe("keep");
    expect(classifyLocalStorageKey("seeded_user_123").status).toBe("keep");
    expect(classifyLocalStorageKey(DEVICE_SCAN_PERMISSION_KEY).status).toBe("keep");
  });

  it("flags leftover entity copies after migration", () => {
    const leftover = classifyLocalStorageKey("anima_entity_Character", {
      migrated: true,
      bytes: 1200,
    });
    expect(leftover.status).toBe("flag");
    expect(leftover.removable).toBe(true);
    expect(leftover.severity).toBe("high");
  });

  it("flags legacy auth and debug keys", () => {
    expect(classifyLocalStorageKey("anima_auth_user").removable).toBe(true);
    expect(classifyLocalStorageKey("SHOW_TAP_TARGETS").status).toBe("flag");
  });

  it("flags oversized unknown keys without marking them removable", () => {
    const oversized = classifyLocalStorageKey("mystery_blob", {
      bytes: LARGE_KEY_BYTES,
    });
    expect(oversized.status).toBe("flag");
    expect(oversized.removable).toBe(false);
    expect(oversized.severity).toBe("low");
  });
});

describe("flagLocalStorageEntries", () => {
  it("returns flags for leftover keys only", () => {
    const { flags, kept } = flagLocalStorageEntries(
      [
        { key: "app-color-scheme", value: "dark" },
        { key: "anima_entity_ChatSession", value: "[{}]" },
        { key: "anima_auth_user", value: "{}" },
      ],
      { migrated: true },
    );
    expect(kept).toBe(1);
    expect(flags.map((f) => f.label).sort()).toEqual([
      "anima_auth_user",
      "anima_entity_ChatSession",
    ]);
  });
});

describe("classifyJunkFile", () => {
  it("flags OS cruft and temp backups", () => {
    expect(classifyJunkFile({ name: ".DS_Store" }).flag).toBe(true);
    expect(classifyJunkFile({ name: "Thumbs.db" }).reason).toBe("os_cruft");
    expect(classifyJunkFile({ name: "notes.tmp" }).reason).toBe("temp_backup");
    expect(classifyJunkFile({ name: "draft.bak" }).flag).toBe(true);
    expect(classifyJunkFile({ name: "video.mp4.crdownload" }).flag).toBe(true);
    expect(classifyJunkFile({ name: "notes~" }).flag).toBe(true);
  });

  it("flags empty files and duplicate names, not ordinary files", () => {
    expect(classifyJunkFile({ name: "empty.txt", size: 0 }).reason).toBe("empty_file");
    expect(classifyJunkFile({ name: "Report (1).pdf", size: 12 }).reason).toBe(
      "duplicate_name",
    );
    expect(classifyJunkFile({ name: "photo.jpg", size: 2048 }).flag).toBe(false);
  });

  it("flags junk folders but not regular directories", () => {
    expect(classifyJunkFile({ name: "__MACOSX", isDirectory: true }).flag).toBe(true);
    expect(classifyJunkFile({ name: "Photos", isDirectory: true }).flag).toBe(false);
  });
});

describe("flagFolderEntries + narrative", () => {
  it("summarizes mixed findings", () => {
    const folder = flagFolderEntries([
      { name: ".DS_Store", path: "Downloads/.DS_Store", size: 6 },
      { name: "keep.pdf", path: "Downloads/keep.pdf", size: 1000 },
    ]);
    const report = {
      permission: true,
      origin: {
        localStorage: {
          flags: [
            {
              id: "ls:anima_entity_Character",
              kind: "localStorage",
              label: "anima_entity_Character",
              detail: "migrated_local_copy",
              bytes: 80,
              removable: true,
              severity: "high",
            },
          ],
        },
        quota: null,
      },
      folder: { ...folder, truncated: false, name: "Downloads" },
    };
    report.flags = collectFlags(report);
    const summary = summarizeScan(report);
    expect(summary.flagCount).toBe(2);
    expect(summary.high).toBe(2);
    expect(summary.removableCount).toBe(1);
    expect(buildScanNarrative(report, "Lumen")).toMatch(/flagged 2 unnecessary items/i);
  });

  it("explains a clean scan and a denied scan", () => {
    expect(
      buildScanNarrative({ permission: true, flags: [], folder: null }, "Lumen"),
    ).toMatch(/nothing unnecessary/i);
    expect(buildScanNarrative({ permission: false }, "Lumen")).toMatch(/grant permission/i);
  });
});

describe("device scan permission", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts denied and persists a grant", () => {
    expect(hasDeviceScanPermission()).toBe(false);
    const written = writeDeviceScanPermission(true, "anima-1");
    expect(written.granted).toBe(true);
    expect(hasDeviceScanPermission()).toBe(true);
    expect(readDeviceScanPermission().animaId).toBe("anima-1");
    writeDeviceScanPermission(false);
    expect(hasDeviceScanPermission()).toBe(false);
  });

  it("refuses an origin scan until permission is granted", async () => {
    const denied = await scanOriginStorage();
    expect(denied.permission).toBe(false);
    expect(denied.error).toBe("permission_denied");
    writeDeviceScanPermission(true);
    localStorage.setItem("anima_server_migration_v1", "1");
    localStorage.setItem("anima_entity_Character", "[{}]");
    const allowed = await scanOriginStorage();
    expect(allowed.permission).toBe(true);
    expect(allowed.flags.some((f) => f.label === "anima_entity_Character")).toBe(true);
  });
});
