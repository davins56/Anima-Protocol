import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CollapsibleTalkSection, { TalkSectionToggle } from "./CollapsibleTalkSection";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CollapsibleTalkSection", () => {
  it("toggles the section, updates aria attributes, and shows the summary line when collapsed", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleTalkSection
        section="header"
        label="Companion header"
        collapsed={false}
        onToggle={onToggle}
        summary={<span>Scarlett · Online</span>}
      >
        <div data-testid="full-header">Full header</div>
      </CollapsibleTalkSection>,
    );

    const toggle = screen.getByTestId("talk-section-header-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("talk-section-header-panel");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse Companion header");
    expect(toggle.className).toMatch(/motion-reduce:transition-none/);
    expect(screen.getByTestId("full-header")).toBeTruthy();
    expect(screen.queryByTestId("talk-section-header-summary")).toBeNull();
    expect(document.getElementById("talk-section-header-panel").hidden).toBe(false);

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <CollapsibleTalkSection
        section="header"
        label="Companion header"
        collapsed
        onToggle={onToggle}
        summary={<span>Scarlett · Online</span>}
      >
        <div data-testid="full-header">Full header</div>
      </CollapsibleTalkSection>,
    );

    const collapsedToggle = screen.getByTestId("talk-section-header-toggle");
    expect(collapsedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(collapsedToggle.getAttribute("aria-label")).toBe("Expand Companion header");
    expect(screen.getByTestId("talk-section-header-summary").textContent).toContain("Scarlett · Online");
    expect(screen.getByTestId("full-header")).toBeTruthy();
    expect(document.getElementById("talk-section-header-panel").hidden).toBe(true);

    fireEvent.keyDown(collapsedToggle, { key: "Enter" });
    fireEvent.click(collapsedToggle);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("is keyboard-focusable as a native button", () => {
    render(
      <TalkSectionToggle section="resonance" label="Resonance Field" collapsed={false} onToggle={() => {}} />,
    );
    const toggle = screen.getByTestId("talk-section-resonance-toggle");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
  });
});
