import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = { user: { id: "user_clerk123" } };

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("@/components/intimacy/IntimacyDock", () => ({
  default: () => <div data-testid="intimacy-dock-stub">Synchro</div>,
}));

import TalkResonanceSection from "./TalkResonanceSection";

beforeEach(() => {
  localStorage.clear();
  authState.user = { id: "user_clerk123" };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSection(props = {}) {
  return render(
    <TalkResonanceSection
      characterId="char-1"
      conversationId="sess-1"
      resonance={{ value: 28, label: "ATTUNED", source: "bond" }}
      liveSynchroStrength={22}
      livePulseHeat={10}
      {...props}
    />,
  );
}

describe("TalkResonanceSection", () => {
  it("collapses to a compact summary with resonance percent and persists per user", () => {
    renderSection();

    const meter = screen.getByRole("meter", { name: "Resonance Field" });
    expect(meter.getAttribute("aria-valuenow")).toBe("28");
    expect(screen.getByTestId("intimacy-dock-stub")).toBeTruthy();
    expect(screen.queryByTestId("talk-section-resonance-summary")).toBeNull();

    const toggle = screen.getByTestId("talk-section-resonance-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);

    const summary = screen.getByTestId("talk-section-resonance-summary");
    expect(summary.textContent).toMatch(/Resonance\s+ATTUNED\s+·\s+28%/);
    expect(summary.textContent).toMatch(/Synchro\s+Linked\s+·\s+22/);
    expect(summary.textContent).toMatch(/Heat\s+10/);
    expect(screen.getByTestId("talk-section-resonance-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("anima:talk:collapse:user_clerk123:resonance")).toBe("1");

    cleanup();

    renderSection();
    expect(screen.getByTestId("talk-section-resonance-summary").textContent).toMatch(/28%/);
    expect(screen.getByTestId("talk-section-resonance-toggle").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps header and resonance collapse state independent", () => {
    localStorage.setItem("anima:talk:collapse:user_clerk123:header", "1");
    renderSection();
    expect(screen.getByTestId("talk-section-resonance-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId("talk-section-resonance-summary")).toBeNull();
  });
});
