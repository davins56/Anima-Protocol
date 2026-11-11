import { describe, expect, it } from "vitest";
import { mindLabel } from "./mindLabel";

describe("mindLabel", () => {
  it("maps known mind ids and passes through unknown ones", () => {
    expect(mindLabel("kimi")).toBe("Kimi");
    expect(mindLabel("xai")).toBe("Grok");
    expect(mindLabel("openai")).toBe("ChatGPT");
    expect(mindLabel("anima")).toBe("anima");
    expect(["Kimi", "Grok"].join(" · ")).toBe("Kimi · Grok");
  });
});
