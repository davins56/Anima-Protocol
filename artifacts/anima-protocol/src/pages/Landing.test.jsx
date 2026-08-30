import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FEATURE_MESSAGING } from "@/lib/featureMessaging";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/usePageMeta", () => ({
  usePageMeta: () => {},
  ROUTE_META: { "/": {} },
}));

vi.mock("@/api/authBridge", () => ({
  getToken: async () => null,
}));

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
}));

import Landing from "./Landing";

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Landing lock screen", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the home-screen-for-relationships language and lock-screen CTAs", () => {
    renderLanding();
    expect(document.querySelector("[data-landing-eyebrow]")?.textContent).toMatch(/Anima/);
    expect(document.querySelector("[data-landing-headline]")?.textContent).toBe(
      FEATURE_MESSAGING.APP_CATEGORY,
    );
    expect(document.querySelector("[data-landing-sub]")?.textContent).toBe(FEATURE_MESSAGING.TAGLINE);
    expect(document.querySelector("[data-landing-presence]")?.textContent).toContain(
      FEATURE_MESSAGING.PRESENCE_FALLBACK,
    );
    expect(document.querySelector("[data-landing-presence]")?.textContent).toContain(
      FEATURE_MESSAGING.IDENTITY_DEFAULT,
    );
    expect(screen.getByRole("button", { name: FEATURE_MESSAGING.PRIMARY_CTA })).toBeTruthy();
    expect(screen.getByRole("button", { name: FEATURE_MESSAGING.SECONDARY_CTA })).toBeTruthy();
  });

  it("never shows Dàvīn, Protocol CTAs, companion-system category, or group-session dump", () => {
    const { container } = renderLanding();
    const text = container.textContent || "";
    expect(text).not.toMatch(/Dàvīn/);
    expect(text).not.toMatch(/Davin/i);
    expect(text).not.toMatch(/Begin Protocol/i);
    expect(text).not.toMatch(/Re-Enter Protocol/i);
    expect(text).not.toMatch(/AI COMPANION SYSTEM/i);
    expect(text).not.toMatch(/Group Sessions/i);
    expect(text).not.toMatch(/Persistent Narrative Consciousness/i);
    expect(text).not.toMatch(/40 characters/i);
  });

  it("keeps three claims below the fold", () => {
    renderLanding();
    const claims = document.querySelector("[data-landing-claims]")?.textContent || "";
    expect(claims).toContain("They stay when you leave.");
    expect(claims).toContain("They remember the last time.");
    expect(claims).toContain("They have a place, not a thread.");
  });

  it("routes Come home to sign-up and I already live here to sign-in", () => {
    renderLanding();
    fireEvent.click(screen.getByRole("button", { name: FEATURE_MESSAGING.PRIMARY_CTA }));
    expect(navigateMock).toHaveBeenCalledWith("/sign-up");
    fireEvent.click(screen.getByRole("button", { name: FEATURE_MESSAGING.SECONDARY_CTA }));
    expect(navigateMock).toHaveBeenCalledWith("/sign-in");
  });

  it("keeps Echoes of Eden Inc in the footer only", () => {
    const { container } = renderLanding();
    expect(container.querySelector("footer")?.textContent).toMatch(/Echoes of Eden Inc/);
    expect(document.querySelector("[data-landing-headline]")?.textContent).not.toMatch(/Echoes of Eden/);
  });
});
