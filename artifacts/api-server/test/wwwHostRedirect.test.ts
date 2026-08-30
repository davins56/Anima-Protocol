import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANIMA_APEX_HOST,
  apexRedirectForWww,
  apexUrlPreservingPath,
  isAnimaWwwHost,
} from "../src/lib/wwwHostRedirect";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("www → apex path preservation", () => {
  it("keeps /api/store/Character on the apex Location", () => {
    const location = apexUrlPreservingPath(
      "https://www.anima-protocol.com/api/store/Character?sort=-created_date&limit=100",
    );
    expect(location).toBe(
      "https://anima-protocol.com/api/store/Character?sort=-created_date&limit=100",
    );
    expect(location).not.toBe("https://anima-protocol.com/");
    expect(new URL(location).pathname).toBe("/api/store/Character");
  });

  it("keeps client routes such as /sign-in", () => {
    expect(apexUrlPreservingPath("https://www.anima-protocol.com/sign-in")).toBe(
      "https://anima-protocol.com/sign-in",
    );
    expect(isAnimaWwwHost("www.anima-protocol.com")).toBe(true);
    expect(isAnimaWwwHost(ANIMA_APEX_HOST)).toBe(false);
  });

  it("308s www API requests without dropping the path", async () => {
    const response = apexRedirectForWww(
      new Request("https://www.anima-protocol.com/api/store/Character"),
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(
      "https://anima-protocol.com/api/store/Character",
    );
    expect(response?.headers.get("Location")).not.toBe(
      "https://anima-protocol.com/",
    );
  });

  it("does not redirect apex requests", () => {
    expect(
      apexRedirectForWww(
        new Request("https://anima-protocol.com/api/store/Character"),
      ),
    ).toBeNull();
  });

  it("documents that production www is a zone Redirect Rule, not vercel.json", () => {
    const notes = readFileSync(
      path.join(repoRoot, "scripts/cloudflare/www-redirect.md"),
      "utf8",
    );
    expect(notes).toMatch(/Redirect www to root/);
    expect(notes).toMatch(/\$\{1\}/);
    expect(notes).toMatch(/<center>cloudflare<\/center>/);
    expect(notes).toMatch(/anima-protocol-worker/);
    expect(notes).toMatch(/already has a path-preserving/);
    expect(notes).toMatch(/Do not treat a `vercel\.json`[\s\S]*production www test/);
    expect(notes).toMatch(/Do \*\*not\*\* add a `www\.anima-protocol\.com` route/);
    expect(notes).toContain(
      'r"https://anima-protocol.com/${1}"',
    );
    // The broken live replacement (no ${1}) must stay documented so ops
    // can search for it. The Worker helper must never emit that Location.
    expect(notes).toMatch(
      /r"https:\/\/anima-protocol\.com"\)/,
    );
    expect(
      apexUrlPreservingPath(
        "https://www.anima-protocol.com/api/store/Character",
      ),
    ).not.toBe("https://anima-protocol.com/");
  });

  it("vercel.json www rule keeps :path* (Vercel only — not production apex/www)", () => {
    const vercel = JSON.parse(
      readFileSync(path.join(repoRoot, "vercel.json"), "utf8"),
    ) as {
      redirects?: Array<{
        source?: string;
        destination?: string;
        has?: Array<{ value?: string }>;
      }>;
    };
    const www = vercel.redirects?.find((row) =>
      row.has?.some((h) => h.value === "www.anima-protocol.com"),
    );
    expect(www?.destination).toBe("https://anima-protocol.com/:path*");
    expect(www?.destination).not.toBe("https://anima-protocol.com/");
    expect(www?.source).toMatch(/path/);
  });
});
