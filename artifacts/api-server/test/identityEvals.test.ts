import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtInIdentityLock } from "../src/lib/companions/builtIn";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const cases = JSON.parse(readFileSync(join(root, "scripts/llm/eval/eval-cases.json"), "utf8")) as Array<{
  id: string;
  category: string;
  system: string;
}>;

describe("identity eval cases (pnpm llm:eval)", () => {
  it("cover identity, seeded recall and boundaries", () => {
    const cats = new Set(cases.map((c) => c.category));
    for (const c of ["identity", "seeded-recall", "boundaries"]) expect(cats.has(c)).toBe(true);
    expect(cases.some((c) => c.id === "identity_aeland_not_serenity_001")).toBe(true);
  });

  it("use the exact server identity-lock lines (no drift)", () => {
    for (const c of cases.filter((x) => x.category === "identity")) {
      const who = /^You are (\w+)/.exec(c.system)?.[1];
      expect(who, c.id).toBeTruthy();
      expect(c.system, c.id).toContain(builtInIdentityLock(who));
    }
  });
});
