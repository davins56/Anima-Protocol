import { describe, expect, it } from "vitest";
import { normalizeMessages } from "../src/services/promptService.js";

describe("chat service context", () => {
  it("keeps only the bounded recent context", () => {
    expect(normalizeMessages([
      { role: "user", content: "old" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "latest" },
    ], 2, 20)).toEqual([
      { role: "assistant", content: "reply" },
      { role: "user", content: "latest" },
    ]);
  });

  it("rejects empty and unsupported messages", () => {
    expect(normalizeMessages([
      { role: "user", content: "  " },
      { role: "system", content: "persona" },
      { role: "tool" as "user", content: "not allowed" },
    ], 10, 20)).toEqual([{ role: "system", content: "persona" }]);
  });
});
