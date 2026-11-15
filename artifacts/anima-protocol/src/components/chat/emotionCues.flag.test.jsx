import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const continuityLoad = vi.fn().mockResolvedValue(null);
vi.mock("@/api/animaApi", () => ({ animaApi: { continuity: { load: (...a) => continuityLoad(...a) } } }));
vi.mock("@/api/animaClient", () => ({ animaClient: { functions: { invoke: vi.fn() } } }));
const portraitProps = [];
vi.mock("@/components/vessel/VesselPortrait", () => ({
  default: (props) => {
    portraitProps.push(props);
    return null;
  },
}));
vi.mock("@/components/memory/MemoryHealth", () => ({ default: () => null }));

import ChatHeader from "./ChatHeader";
import TalkHeaderSummary from "./TalkHeaderSummary";
import MoodWhyPanel from "./MoodWhyPanel";
import AffectCue from "./AffectCue";
import { EMOTION_CUES_OFF, EmotionCuesContext } from "./EmotionCuesContext";
import { characterEmotionFromAffect, parseCompanionAffectSnapshot } from "@/lib/companionAffect";
import { sanitizeAffectCue } from "@/lib/emotionCues";
import { COMPANION_PRIMARY_EMOTIONS_FOR_TEST, FLAG_ON_SNAPSHOT } from "@/lib/emotionCues.fixtures";

const scarlet = { id: "scarlet", name: "Scarlet" };
const aeland = { id: "aeland", name: "Aeland" };
const solo = { id: "s1", mode: "solo", character_id: "scarlet", messages: [] };
const group = { id: "g1", mode: "group", group_character_ids: ["scarlet", "aeland"], messages: [] };
const emotions = {
  scarlet: characterEmotionFromAffect(parseCompanionAffectSnapshot({ ...FLAG_ON_SNAPSHOT, updated_at: new Date().toISOString() })),
  aeland: characterEmotionFromAffect(parseCompanionAffectSnapshot({ primary: "watchful", intensity: 40, energy: 40, updated_at: new Date().toISOString() })),
};
const cue = sanitizeAffectCue(FLAG_ON_SNAPSHOT);
const on = (cues = { scarlet: cue, aeland: cue }, reunionIds = []) => ({
  enabled: true,
  cueFor: (id) => cues[id] || null,
  reunionIds,
});

function header(session, value) {
  const tree = (
    <MemoryRouter>
      <ChatHeader session={session} characters={[scarlet, aeland]} mood="sad" moodIntensity={48} characterEmotions={emotions} />
    </MemoryRouter>
  );
  return value ? <EmotionCuesContext.Provider value={value}>{tree}</EmotionCuesContext.Provider> : tree;
}

function visibleText(container) {
  return container.textContent.toLowerCase();
}

describe("emotions flag off: parity", () => {
  it("ChatHeader renders identically with no provider and with the off value", () => {
    for (const session of [solo, group]) {
      const a = render(header(session)).container.innerHTML;
      const b = render(header(session, EMOTION_CUES_OFF)).container.innerHTML;
      expect(b).toBe(a);
    }
  });

  it("ChatHeader keeps today's Feeling / Level / mood chip when off", () => {
    render(header(solo, EMOTION_CUES_OFF));
    expect(screen.getByTestId("header-feeling").textContent).toBe("sad");
    expect(screen.queryByTestId("header-affect-cue")).toBeNull();
  });

  it("TalkHeaderSummary and MoodWhyPanel are unchanged when off", () => {
    const a = render(<TalkHeaderSummary session={solo} characters={[scarlet]} characterEmotions={emotions} />).container.innerHTML;
    const b = render(
      <EmotionCuesContext.Provider value={EMOTION_CUES_OFF}>
        <TalkHeaderSummary session={solo} characters={[scarlet]} characterEmotions={emotions} />
      </EmotionCuesContext.Provider>,
    ).container.innerHTML;
    expect(b).toBe(a);
    render(<MoodWhyPanel affect={null} fallbackMood="neutral" />);
    expect(screen.getByText("Mood: neutral")).toBeTruthy();
  });
});

describe("emotions flag on", () => {
  it("solo header shows a cue, no emotion labels or numbers, with prose aria text", () => {
    const { container } = render(header(solo, on()));
    const cueEl = screen.getByTestId("header-affect-cue");
    expect(cueEl.getAttribute("aria-label")).toBe("Scarlet seems to have missed you");
    expect(cueEl.getAttribute("title")).toBe("Scarlet seems to have missed you");
    expect(screen.queryByTestId("header-felt-state")).toBeNull();
    const text = visibleText(container);
    for (const label of COMPANION_PRIMARY_EMOTIONS_FOR_TEST) expect(text).not.toMatch(new RegExp(`\\b${label}\\b`));
    expect(text).not.toMatch(/feeling:|level:|arousal:|\d+%/);
  });

  it("feeds dims to the vessel portrait", () => {
    portraitProps.length = 0;
    render(header(solo, on()));
    expect(portraitProps.at(-1).dims).toEqual(FLAG_ON_SNAPSHOT.dims);
  });

  it("group header shows one cue per cast member and no labels", () => {
    const { container } = render(header(group, on({ aeland: cue })));
    expect(screen.getByTestId("header-affect-cue-scarlet").getAttribute("aria-label")).toBe("Scarlet seems settled");
    expect(screen.getByTestId("header-affect-cue-aeland").getAttribute("aria-label")).toBe("Aeland seems to have missed you");
    expect(screen.queryByTestId("header-group-felt-states")).toBeNull();
    expect(visibleText(container)).not.toMatch(/\bsad\b|\bwatchful\b/);
  });

  it("reunion cue is restrained: announced once to screen readers, no timestamp", () => {
    render(header(solo, on(undefined, ["scarlet"])));
    expect(screen.getByTestId("header-affect-cue").getAttribute("data-reunion")).toBe("true");
    const announce = screen.getByTestId("header-affect-cue-announce");
    expect(announce.textContent).toBe("It's been a while since you two talked.");
    expect(announce.textContent).not.toMatch(/\d/);
  });

  it("TalkHeaderSummary swaps the feeling label for the cue", () => {
    render(
      <EmotionCuesContext.Provider value={on()}>
        <TalkHeaderSummary session={solo} characters={[scarlet]} characterEmotions={emotions} />
      </EmotionCuesContext.Provider>,
    );
    expect(screen.queryByTestId("talk-header-summary-feeling")).toBeNull();
    expect(screen.getByTestId("talk-header-summary-cue")).toBeTruthy();
  });

  it("MoodWhyPanel is prose from the phrase table, never server free text", () => {
    render(
      <EmotionCuesContext.Provider value={on()}>
        <MoodWhyPanel
          name="Scarlet"
          characterId="scarlet"
          affect={{ primary: "sad", mood: "aching", intensity: 48, energy: 40, focus: "her brother", intent: "withdraw" }}
        />
      </EmotionCuesContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("mood-chip"));
    const text = screen.getByTestId("mood-why-panel").textContent;
    expect(text).toContain("Scarlet seems to have missed you.");
    expect(text).not.toMatch(/brother|withdraw|aching|\bsad\b|\d/);
  });

  it("AffectCue renders a settled cue when there is no snapshot yet", () => {
    render(<AffectCue cue={null} name="Aeland" />);
    expect(screen.getByTestId("affect-cue").getAttribute("aria-label")).toBe("Aeland seems settled");
  });
});
