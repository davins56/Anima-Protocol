import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("web-push ESM compatibility", () => {
  it("exposes named exports and no default export (web-push@4)", async () => {
    const mod = await import("web-push");
    expect(typeof mod.sendNotification).toBe("function");
    expect(typeof mod.setVapidDetails).toBe("function");
    expect("default" in mod).toBe(false);
  });

  it("proactiveMessages uses named imports, not a default import", () => {
    const src = readFileSync(new URL("../src/lib/proactiveMessages.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/import\s+\w+\s*(,|\s+from)[^;]*from\s+"web-push"/);
    expect(src).toMatch(/import\s*\{[^}]*sendNotification[^}]*\}\s*from\s+"web-push"/);
  });
});
