import { describe, it, expect } from "vitest";
import { buildStoreZip, unzipToEntries, crc32 } from "./zipCodec.js";
import {
  sanitizeImportPath,
  stripCommonRoot,
  isLikelyTextBytes,
  filesFromEntries,
  mergeImportedFiles,
  importFromZipBuffer,
  importFromBrowserFiles,
  parseGithubRepoUrl,
  githubDownloadZipUrl,
  summarizeImport,
  IMPORT_LIMITS,
} from "./importProject.js";

function enc(text) {
  return new TextEncoder().encode(text);
}

describe("sanitizeImportPath", () => {
  it("normalizes slashes and strips a leading ./ or /", () => {
    expect(sanitizeImportPath("./src\\app.js")).toEqual({ ok: true, path: "src/app.js" });
    expect(sanitizeImportPath("/readme.md")).toEqual({ ok: true, path: "readme.md" });
  });

  it("rejects traversal and empty paths", () => {
    expect(sanitizeImportPath("../secret.js").ok).toBe(false);
    expect(sanitizeImportPath("foo/../../etc/passwd").ok).toBe(false);
    expect(sanitizeImportPath("   ").ok).toBe(false);
    expect(sanitizeImportPath(".").ok).toBe(false);
  });

  it("rejects .sessions paths so imports cannot clobber snapshots", () => {
    expect(sanitizeImportPath(".sessions/old.session.json").ok).toBe(false);
    expect(sanitizeImportPath(".sessions").ok).toBe(false);
    expect(sanitizeImportPath("./.sessions/x.json").reason).toMatch(/session/i);
  });

  it("skips node_modules, .git, lockfiles, and .env secrets", () => {
    expect(sanitizeImportPath("node_modules/lodash/index.js").ok).toBe(false);
    expect(sanitizeImportPath("pkg/.git/config").ok).toBe(false);
    expect(sanitizeImportPath("pnpm-lock.yaml").ok).toBe(false);
    expect(sanitizeImportPath(".env").ok).toBe(false);
    expect(sanitizeImportPath(".env.local").ok).toBe(false);
  });
});

describe("stripCommonRoot", () => {
  it("strips a single wrapping folder (GitHub-style zip)", () => {
    expect(stripCommonRoot([
      "my-repo-main/index.html",
      "my-repo-main/src/app.js",
    ])).toBe("my-repo-main");
  });

  it("does not strip when files already sit at the zip root", () => {
    expect(stripCommonRoot(["index.html", "src/app.js"])).toBe("");
  });

  it("does not strip a lone file with no folder", () => {
    expect(stripCommonRoot(["README.md"])).toBe("");
  });
});

describe("isLikelyTextBytes", () => {
  it("accepts source and rejects null-byte blobs", () => {
    expect(isLikelyTextBytes(enc("export const x = 1;\n"))).toBe(true);
    expect(isLikelyTextBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]))).toBe(false);
  });
});

describe("filesFromEntries — zip-like map + sanitization", () => {
  it("maps a wrapped zip tree into a clean files list", () => {
    const html = ["<", "h1", ">", "hi", "</", "h1", ">"].join("");
    const result = filesFromEntries([
      { path: "demo-main/index.html", content: html },
      { path: "demo-main/src/app.js", bytes: enc("console.log(1)") },
      { path: "demo-main/node_modules/x/index.js", bytes: enc("ignored") },
      { path: "demo-main/photo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { path: "demo-main/.sessions/hack.session.json", bytes: enc("{}") },
    ]);
    expect(result.files.map((f) => f.path).sort()).toEqual(["index.html", "src/app.js"]);
    expect(result.files.find((f) => f.path === "index.html").content).toContain(html);
    expect(result.skipped.some((s) => /node_modules|ignored folder/.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /binary/.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /session/.test(s.reason))).toBe(true);
  });

  it("rejects oversize text files with a clear reason", () => {
    const big = new Uint8Array(IMPORT_LIMITS.maxFileBytes + 10);
    big.fill(65);
    const result = filesFromEntries([{ path: "huge.js", bytes: big }]);
    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/larger than/i);
  });
});

describe("mergeImportedFiles", () => {
  const session = { path: ".sessions/keep.session.json", content: '{"kind":"anima-codespace-session"}' };
  const starter = [
    { path: "index.html", content: "old" },
    { path: "styles.css", content: "body{}" },
    session,
  ];

  it("merges uploaded files without touching .sessions", () => {
    const next = mergeImportedFiles(starter, [
      { path: "src/new.js", content: "ok" },
      { path: "index.html", content: "replaced" },
      { path: ".sessions/evil.session.json", content: "nope" },
    ]);
    expect(next.find((f) => f.path === "index.html").content).toBe("replaced");
    expect(next.find((f) => f.path === "styles.css").content).toBe("body{}");
    expect(next.find((f) => f.path === "src/new.js").content).toBe("ok");
    expect(next.filter((f) => f.path.startsWith(".sessions/"))).toEqual([session]);
  });

  it("replace-workspace swaps project files but keeps sessions", () => {
    const next = mergeImportedFiles(
      starter,
      [{ path: "main.py", content: "print(1)" }],
      { replaceWorkspace: true },
    );
    expect(next.map((f) => f.path).sort()).toEqual([
      ".sessions/keep.session.json",
      "main.py",
    ]);
    expect(next.find((f) => f.path === session.path)).toEqual(session);
  });
});

describe("zip → files map", () => {
  it("round-trips a STORE zip through unzip + filesFromEntries", async () => {
    const zip = buildStoreZip([
      { path: "repo-main/index.html", content: "<!doctype html><title>x</title>" },
      { path: "repo-main/script.js", content: "console.log('pong')" },
      { path: "repo-main/assets/logo.png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]) },
    ]);
    expect(new DataView(zip).getUint32(0, true)).toBe(0x04034b50);

    const raw = await unzipToEntries(zip);
    expect(raw.map((e) => e.path)).toContain("repo-main/script.js");

    const imported = await importFromZipBuffer(zip);
    expect(imported.errors).toEqual([]);
    expect(imported.files.map((f) => f.path).sort()).toEqual(["index.html", "script.js"]);
    expect(imported.files.find((f) => f.path === "script.js").content).toContain("pong");
    expect(imported.skipped.some((s) => s.path === "assets/logo.png")).toBe(true);
  });

  it("crc32 is stable for a known vector", () => {
    // CRC-32 of "123456789" is 0xcbf43926
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });

  it("rejects a huge zip before unpacking", async () => {
    const imported = await importFromZipBuffer(new ArrayBuffer(IMPORT_LIMITS.maxZipBytes + 1));
    expect(imported.files).toEqual([]);
    expect(imported.errors[0]).toMatch(/larger than/i);
  });

  it("reports a clear error for non-zip bytes", async () => {
    const imported = await importFromZipBuffer(enc("not a zip").buffer);
    expect(imported.files).toEqual([]);
    expect(imported.errors[0]).toMatch(/zip/i);
  });
});

describe("importFromBrowserFiles", () => {
  it("uses webkitRelativePath so a folder lands as a tree", async () => {
    const file = new File(["export default 1"], "app.js", { type: "text/javascript" });
    Object.defineProperty(file, "webkitRelativePath", { value: "my-app/src/app.js" });
    const result = await importFromBrowserFiles([file], { mode: "folder" });
    expect(result.files).toEqual([{ path: "src/app.js", content: "export default 1" }]);
  });

  it("keeps uploaded single files at the given name", async () => {
    const file = new File(["print('hi')"], "main.py", { type: "text/x-python" });
    const result = await importFromBrowserFiles([file], { mode: "files" });
    expect(result.files).toEqual([{ path: "main.py", content: "print('hi')" }]);
  });
});

describe("GitHub URL helper", () => {
  it("parses common GitHub repo URL shapes", () => {
    expect(parseGithubRepoUrl("https://github.com/davins56/Anima-Protocol")).toEqual({
      owner: "davins56",
      repo: "Anima-Protocol",
    });
    const sshUrl = ["git", "@github.com:", "davins56", "/", "Anima-Protocol.git"].join("");
    expect(parseGithubRepoUrl(sshUrl)).toEqual({
      owner: "davins56",
      repo: "Anima-Protocol",
    });
    expect(parseGithubRepoUrl("davins56/Anima-Protocol")).toEqual({
      owner: "davins56",
      repo: "Anima-Protocol",
    });
    expect(parseGithubRepoUrl("not a repo")).toBeNull();
  });

  it("builds the Download ZIP link GitHub already serves", () => {
    expect(githubDownloadZipUrl("davins56", "Anima-Protocol")).toBe(
      "https://github.com/davins56/Anima-Protocol/archive/refs/heads/main.zip",
    );
  });
});

describe("summarizeImport", () => {
  it("describes imported + skipped counts", () => {
    const text = summarizeImport({
      files: [{ path: "a.js", content: "1" }],
      skipped: [{ path: "b.png", reason: "binary file the editor cannot open" }],
    });
    expect(text).toMatch(/Imported 1 file/);
    expect(text).toMatch(/Skipped 1/);
    expect(text).toContain("b.png");
  });
});
