import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ExtraPage from "./extraPages";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(srcRoot, rel), "utf8");
}

describe("ExtraPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a fallback instead of a blank screen for unknown pages", () => {
    render(<ExtraPage name="DefinitelyNotAPage" />);
    expect(screen.getByText(/this screen is not available/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /go home/i })).toBeTruthy();
  });

  it("every ExtraPage name in ProtocolApp exists in the extraPages map", () => {
    const shell = readSrc("ProtocolApp.jsx");
    const extra = readSrc("app/extraPages.jsx");
    const names = [
      ...shell.matchAll(/<ExtraPage name="([^"]+)"/g),
    ].map((match) => match[1]);
    const pageKeys = [
      ...extra.matchAll(/^\s+([A-Za-z0-9]+):\s*lazy\(/gm),
    ].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(10);
    expect([...new Set(names)].filter((name) => !pageKeys.includes(name))).toEqual(
      [],
    );
  });

  it("does not return null for a missing page name", () => {
    const extra = readSrc("app/extraPages.jsx");
    expect(extra).not.toMatch(/if\s*\(\s*!Comp\s*\)\s*\{\s*return null/);
    expect(extra).toContain("This screen is not available");
    expect(extra).toContain("<Comp {...props} />");
  });
});
