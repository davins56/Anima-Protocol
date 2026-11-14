import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const continuityLoad = vi.fn();
vi.mock("@/api/animaApi", () => ({ animaApi: { continuity: { load: (...a) => continuityLoad(...a) } } }));
vi.mock("@/api/animaClient", () => ({ animaClient: { functions: { invoke: vi.fn() } } }));
vi.mock("@/components/vessel/VesselPortrait", () => ({ default: () => null }));
vi.mock("@/components/memory/MemoryHealth", () => ({ default: () => null }));

import ChatHeader from "./ChatHeader";
import { characterEmotionFromAffect, parseCompanionAffectSnapshot } from "@/lib/companionAffect";

const asami = { id: "asami", name: "Asami Sato" };
const korra = { id: "korra", name: "Korra" };

function felt(raw) {
  return characterEmotionFromAffect(
    parseCompanionAffectSnapshot({ updated_at: new Date().toISOString(), ...raw }),
  );
}

function header(props) {
  return (
    <MemoryRouter>
      <ChatHeader characters={[asami, korra]} {...props} />
    </MemoryRouter>
  );
}

describe("ChatHeader Feeling / Level follow the conversation", () => {
  it("re-renders Feeling, Level and Arousal when a new turn's felt state arrives", () => {
    continuityLoad.mockResolvedValue(null);
    const session = { id: "s1", mode: "solo", character_id: "asami", messages: [] };
    const first = { asami: felt({ primary: "neutral", intensity: 22, energy: 48, mood: "quiet-watchful" }) };
    const { rerender } = render(header({ session, characterEmotions: first }));
    expect(screen.getByTestId("header-feeling").textContent).toBe("neutral");
    expect(screen.getByTestId("header-level").textContent).toBe("quiet-watchful");
    expect(screen.getByTestId("header-arousal").textContent).toBe("48%");

    const next = { asami: felt({ primary: "curious", intensity: 41, energy: 53, mood: "curious" }) };
    rerender(header({ session, characterEmotions: next }));
    expect(screen.getByTestId("header-feeling").textContent).toBe("curious");
    expect(screen.getByTestId("header-level").textContent).toBe("curious");
    expect(screen.getByTestId("header-arousal").textContent).toBe("53%");

    const third = { asami: felt({ primary: "tender", intensity: 58, energy: 46, mood: "tender-aching" }) };
    rerender(header({ session, characterEmotions: third }));
    expect(screen.getByTestId("header-feeling").textContent).toBe("tender");
    expect(screen.getByTestId("header-level").textContent).toBe("tender-aching");
  });

  it("group chats show each companion's own Feeling and update them independently", () => {
    continuityLoad.mockResolvedValue(null);
    const session = { id: "g1", mode: "group", group_character_ids: ["asami", "korra"], messages: [] };
    const before = {
      asami: felt({ primary: "neutral", intensity: 22, energy: 48, mood: "quiet-watchful" }),
      korra: felt({ primary: "playful", intensity: 40, energy: 62, mood: "light-hearted" }),
    };
    const { rerender } = render(header({ session, characterEmotions: before }));
    expect(screen.getByTestId("header-felt-asami").textContent).toContain("neutral");
    expect(screen.getByTestId("header-felt-korra").textContent).toContain("playful");

    // Asami spoke: only her entry changes.
    const after = { ...before, asami: felt({ primary: "tender", intensity: 50, energy: 45, mood: "tender" }) };
    rerender(header({ session, characterEmotions: after }));
    expect(screen.getByTestId("header-felt-asami").textContent).toContain("tender");
    expect(screen.getByTestId("header-felt-korra").textContent).toContain("playful");
    expect(screen.getByTestId("header-felt-korra").textContent).toContain("light-hearted");
  });

  it("does not say she is dreaming while she is online and replying", async () => {
    continuityLoad.mockResolvedValue({ presence: "dreaming", presence_label: "Asami Sato is dreaming", greeting: null });
    const session = {
      id: "s2",
      mode: "solo",
      character_id: "asami",
      messages: [{ role: "user", content: "hey", timestamp: new Date().toISOString() }],
    };
    render(header({ session, characterEmotions: {}, replying: true }));
    await waitFor(() => expect(screen.getByTestId("presence-indicator")).toBeTruthy());
    expect(screen.queryByText(/is dreaming/i)).toBeNull();
    expect(screen.getByText("Asami Sato is here")).toBeTruthy();
  });

  it("still shows dreaming when the chat has been quiet for a long time", async () => {
    continuityLoad.mockResolvedValue({ presence: "dreaming", presence_label: "Asami Sato is dreaming", greeting: null });
    const session = {
      id: "s3",
      mode: "solo",
      character_id: "asami",
      messages: [{ role: "user", content: "night", timestamp: new Date(Date.now() - 5 * 3600_000).toISOString() }],
    };
    render(header({ session, characterEmotions: {} }));
    await waitFor(() => expect(screen.getByText("Asami Sato is dreaming")).toBeTruthy());
  });
});
