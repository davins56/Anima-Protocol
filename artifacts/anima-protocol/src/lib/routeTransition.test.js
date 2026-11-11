import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shell = readFileSync(join(import.meta.dirname, "..", "ProtocolApp.jsx"), "utf8");

describe("route transition", () => {
  it("does not hold navigations behind an exit animation", () => {
    expect(shell).not.toMatch(/AnimatePresence mode="wait"/);
  });

  it("keeps the shell mounted and fades only the route panel", () => {
    expect(shell).toMatch(/<motion\.div\s+key=\{routeSection\}/);
    expect(shell).not.toMatch(/<motion\.div\s+key=\{location\.pathname\.split/);
    expect(shell).toMatch(/ref=\{appContainerRef\}\s+className="app-shell-main/);
  });

  it("skips the fade under prefers-reduced-motion", () => {
    expect(shell).toContain("useReducedMotion()");
    expect(shell).toMatch(/initial=\{reduceMotion \? false/);
  });
});
