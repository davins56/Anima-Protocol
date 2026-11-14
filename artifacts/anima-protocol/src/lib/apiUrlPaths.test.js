import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiUrl } from "./apiOrigin";

// apiUrl(path) returns `${origin}/api${path}`. A literal apiUrl("/api/...")
// doubles the prefix (/api/api/...) and 404s. Guard the whole web app.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("apiUrl paths", () => {
  it("prefixes /api exactly once", () => {
    expect(new URL(apiUrl("/media/capabilities"), "http://localhost").pathname).toBe("/api/media/capabilities");
  });

  it("no source file calls apiUrl with a path that already starts with /api", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      const re = /apiUrl\(\s*[`"']\/api(\/|[`"'])/g;
      let m;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
