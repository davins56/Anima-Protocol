import { describe, expect, it } from "vitest";
import { withOpenAiV1Suffix } from "../src/openaiBaseUrl";

describe("withOpenAiV1Suffix", () => {
  it("appends /v1 on the pathname and keeps the query and hash", () => {
    expect(withOpenAiV1Suffix("https://host/proxy?token=x")).toBe(
      "https://host/proxy/v1?token=x",
    );
    expect(withOpenAiV1Suffix("https://host/proxy?token=x#frag")).toBe(
      "https://host/proxy/v1?token=x#frag",
    );
    expect(withOpenAiV1Suffix("https://host?token=x#h")).toBe(
      "https://host/v1?token=x#h",
    );
  });

  it("treats an existing /v1 suffix as case-insensitive and does not double it", () => {
    expect(withOpenAiV1Suffix("https://host/V1")).toBe("https://host/V1");
    expect(withOpenAiV1Suffix("https://host/V1/")).toBe("https://host/V1");
    expect(withOpenAiV1Suffix("https://host/proxy/V1?token=x")).toBe(
      "https://host/proxy/V1?token=x",
    );
    expect(withOpenAiV1Suffix("https://host/v1?token=x")).toBe(
      "https://host/v1?token=x",
    );
  });

  it("leaves the live anima-chat URL unchanged", () => {
    expect(withOpenAiV1Suffix("https://llm.anima-protocol.com/v1")).toBe(
      "https://llm.anima-protocol.com/v1",
    );
    expect(withOpenAiV1Suffix("https://llm.anima-protocol.com/v1/")).toBe(
      "https://llm.anima-protocol.com/v1",
    );
  });

  it("appends /v1 to a bare origin", () => {
    expect(withOpenAiV1Suffix("https://anima-chat-llm.fly.dev")).toBe(
      "https://anima-chat-llm.fly.dev/v1",
    );
    expect(withOpenAiV1Suffix("https://anima-chat-llm.fly.dev/")).toBe(
      "https://anima-chat-llm.fly.dev/v1",
    );
  });
});
