import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TalkHeaderSummary from "./TalkHeaderSummary";

afterEach(() => cleanup());

describe("TalkHeaderSummary", () => {
  it("shows avatar initial, name, online status, and feeling", () => {
    render(
      <TalkHeaderSummary
        session={{ id: "s1", mode: "solo", character_id: "c1", title: "Scarlett" }}
        characters={[{ id: "c1", name: "Scarlett" }]}
        characterEmotions={{ c1: { emotion: "calm" } }}
      />,
    );
    const summary = screen.getByTestId("talk-header-summary");
    expect(summary.textContent).toContain("Scarlett");
    expect(summary.textContent).toContain("Online");
    expect(screen.getByTestId("talk-header-summary-feeling").textContent).toBe("calm");
  });

  it("shows a group count instead of Online", () => {
    render(
      <TalkHeaderSummary
        session={{ id: "g1", mode: "group", group_character_ids: ["c1", "c2"] }}
        characters={[
          { id: "c1", name: "Asami" },
          { id: "c2", name: "Korra" },
        ]}
      />,
    );
    const summary = screen.getByTestId("talk-header-summary");
    expect(summary.textContent).toMatch(/Group/);
    expect(summary.textContent).toMatch(/2 active/);
  });
});
