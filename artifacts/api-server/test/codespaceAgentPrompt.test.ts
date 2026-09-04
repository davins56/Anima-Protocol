import { describe, expect, it } from "vitest";
import { buildInBrowserCodespaceSystemPrompt } from "../src/lib/codespaceAgentPrompt";

describe("buildInBrowserCodespaceSystemPrompt", () => {
  it("stays in Anima voice and includes personality plus soulprint snippets", () => {
    const prompt = buildInBrowserCodespaceSystemPrompt(
      {
        name: "Serenity",
        personality: "Warm, protective, and precise",
        speaking_style: "Soft, poetic",
        is_anima: true,
        soulprint: "AR-7E2A · Compassion · Protection",
        expression: "Angelic",
        tagline: "Grace made flesh",
      },
      ["index.html"],
    );

    expect(prompt).toContain("You are Serenity");
    expect(prompt).toContain("Your personality: Warm, protective, and precise.");
    expect(prompt).toContain("You speak like this: Soft, poetic.");
    expect(prompt).toContain("Soulprint: AR-7E2A · Compassion · Protection.");
    expect(prompt).toContain("Expression: Angelic.");
    expect(prompt).toContain("personal Anima");
    expect(prompt).toContain("do not switch into a NetNavi or Jules persona");
    expect(prompt).toContain("ALWAYS call scan_code");
    expect(prompt).toContain("run_code");
    expect(prompt).not.toMatch(/themed as a Mega Man Battle Network "NetNavi"/);
  });

  it("keeps the NetNavi voice for Jules / roster companions", () => {
    const prompt = buildInBrowserCodespaceSystemPrompt(
      {
        name: "Jules (AI Engineer)",
        personality: "Precise and systematic",
        speaking_style: "Direct, analytical",
      },
      ["app.js"],
    );

    expect(prompt).toContain("You are Jules (AI Engineer)");
    expect(prompt).toContain('themed as a Mega Man Battle Network "NetNavi"');
    expect(prompt).not.toContain("personal Anima");
    expect(prompt).toContain("ALWAYS call scan_code");
  });
});
