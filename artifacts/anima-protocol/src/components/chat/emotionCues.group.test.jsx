import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/animaApi", () => ({ animaApi: { continuity: { load: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/api/animaClient", () => ({ animaClient: { functions: { invoke: vi.fn() } } }));
vi.mock("@/components/vessel/VesselPortrait", () => ({ default: () => null }));
vi.mock("@/components/memory/MemoryHealth", () => ({ default: () => null }));

import ChatHeader from "./ChatHeader";
import AffectCue from "./AffectCue";
import { EMOTION_CUES_OFF, EmotionCuesContext } from "./EmotionCuesContext";
import { groupCuesFromPayload, sanitizeAffectCue } from "@/lib/emotionCues";
import { groupEmotionFixtures } from "@/lib/emotionCues.group.fixtures";

const F = groupEmotionFixtures();
const chars = [
  { id: "c_nat", name: "Natasha" },
  { id: "c_ser", name: "Serenity" },
];
const group = { id: "g1", mode: "group", group_character_ids: ["c_nat", "c_ser"], messages: [] };
const castIds = group.group_character_ids;

function header(value) {
  const tree = (
    <MemoryRouter>
      <ChatHeader session={group} characters={chars} mood="neutral" moodIntensity={0} characterEmotions={{}} />
    </MemoryRouter>
  );
  return value ? <EmotionCuesContext.Provider value={value}>{tree}</EmotionCuesContext.Provider> : tree;
}

const valueFor = (cues, reunionIds = []) => ({ enabled: true, cueFor: (id) => cues[id] || null, reunionIds });

describe("#765 group header from shared fixtures", () => {
  it("before a public update: settled baseline-only cue per member, no private grief, no reunion", () => {
    const cues = groupCuesFromPayload(F.context.group_before_public_update.group_affect, { castIds });
    const { container } = render(header(valueFor(cues)));
    expect(screen.getByTestId("header-affect-cue-c_nat").getAttribute("aria-label")).toBe("Natasha seems settled");
    expect(screen.getByTestId("header-affect-cue-c_ser").getAttribute("aria-label")).toBe("Serenity seems settled");
    expect(container.querySelector("[data-reunion]")).toBeNull();
    expect(container.textContent.toLowerCase()).not.toMatch(/grief|sad|\d+%/);
  });

  it("a group whose payload is not public renders settled (fail closed), not the composed tint", () => {
    const cues = groupCuesFromPayload(F.context.group_layer_missing_or_composed.group_affect, { castIds });
    expect(cues).toEqual({});
    const { container } = render(header(valueFor(cues)));
    expect(screen.getByTestId("header-affect-cue-c_nat").getAttribute("aria-label")).toBe("Natasha seems settled");
    expect(container.innerHTML).not.toMatch(/hurt|grief/);
  });

  it("flag off: identical markup with no provider and the off value, and no cue", () => {
    const a = render(header()).container.innerHTML;
    const b = render(header(EMOTION_CUES_OFF)).container.innerHTML;
    expect(b).toBe(a);
    expect(b).not.toMatch(/affect-cue/);
  });

  it("after a public update the cue follows the public snapshot", () => {
    const cues = groupCuesFromPayload(F.context.group_after_public_update.group_affect, { castIds });
    render(header(valueFor(cues)));
    expect(screen.getByTestId("header-affect-cue-c_nat").getAttribute("aria-label")).not.toBe("Natasha seems settled");
    expect(screen.getByTestId("header-affect-cue-c_ser").getAttribute("aria-label")).toBe("Serenity seems settled");
  });
});

describe("accessible prose cue and reduced motion", () => {
  it("prose aria text, motion only under motion-safe, still under motion-reduce", () => {
    const cue = sanitizeAffectCue(F.done.solo_committed_reunion.companion_affect);
    const { container } = render(<AffectCue cue={cue} name="Natasha" reunion />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/^Natasha /);
    expect(img.getAttribute("aria-label")).not.toMatch(/\d/);
    const animated = [...container.querySelectorAll("[class*='animate-']")];
    expect(animated.length).toBeGreaterThan(0);
    for (const el of animated) {
      expect(el.className).not.toMatch(/(^|\s)animate-/);
      expect(el.className).toMatch(/motion-safe:animate-/);
    }
    expect(container.querySelector("[class*='motion-reduce:']")).not.toBeNull();
    expect(screen.getByTestId("affect-cue-announce").textContent.length).toBeGreaterThan(0);
  });
});
