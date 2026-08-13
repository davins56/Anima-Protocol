import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy({}, { get: () => passthrough }),
    AnimatePresence: ({ children }) => children,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { Character: { update: vi.fn() } }, messages: { append: vi.fn() } },
}));
vi.mock("@/lib/appendAmbientMessage", () => ({ appendAmbientMessage: vi.fn() }));

vi.mock("./ChoiceGenerator", () => ({ default: () => null }));
vi.mock("./LocationDialogueHints", () => ({ default: () => null }));
vi.mock("@/components/inventory/InventoryStatDisplay", () => ({ default: () => null }));
vi.mock("@/components/inventory/InventoryNarrativePanel", () => ({ default: () => null }));
vi.mock("@/components/inventory/InventoryTradePanel", () => ({ default: () => null }));
vi.mock("@/components/network/SessionRelationshipGraph", () => ({ default: () => null }));
vi.mock("@/components/network/RelationshipEvolutionMap", () => ({ default: () => null }));
vi.mock("@/components/narrative/NarrativeArcPanel", () => ({ default: () => null }));
vi.mock("@/components/world/WorldStateMonitor", () => ({ default: () => null }));
vi.mock("./NarrativeSuggestions", () => ({ default: () => null }));
vi.mock("./CharacterEvolutionPanel", () => ({ default: () => null }));
vi.mock("@/components/insights/AIInsightsPanel", () => ({ default: () => null }));
vi.mock("@/components/group/GroupDynamicsPanel", () => ({ default: () => null }));
vi.mock("@/components/world/WorldEvolutionStatus", () => ({ default: () => null }));
vi.mock("@/components/quests/SideQuestSuggestions", () => ({ default: () => null }));
vi.mock("./CalendarDisplay", () => ({ default: () => null }));
vi.mock("./EmotionIndicator", () => ({ default: () => null }));
vi.mock("@/components/world/WorldPulseFeed", () => ({ default: () => null }));
vi.mock("@/components/world/AtmosphericDescription", () => ({ default: () => null }));
vi.mock("./SystemAlert", () => ({ default: () => null }));
vi.mock("@/components/dashboard/NarrativeImpactDashboard", () => ({ default: () => null }));

import ChatWidgetsArea from "./ChatWidgetsArea";

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

const props = {
  activeSession: { id: "s1", mode: "solo", character_id: "c1", messages: [] },
  characters: [{ id: "c1", name: "Korra" }],
  narrativeArcs: [],
  arcsLoading: false,
  worldStateEvents: [],
  worldElements: [],
  eventSuggestions: [],
  analyzingNarrative: false,
  characterEvolutions: {},
  characterEmotions: {},
  insights: [],
  insightsLoading: false,
  relationships: {},
  currentLocationContext: null,
  inventoryItems: [],
  loreEntries: [],
  calendar: null,
  pulseHeadlines: [],
  atmosphericDesc: null,
  loadingAtmosphere: false,
  generatedContent: null,
  worldEvent: null,
  analyzeNow: () => {},
  handleSendMessage: () => {},
  handleApplyEvent: () => {},
  loadInventory: () => {},
  setCharacterEvolutions: () => {},
  setActiveSession: () => {},
  setPulseHeadlines: () => {},
  setGeneratedContent: () => {},
  setWorldEvent: () => {},
};

describe("ChatWidgetsArea", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles Story Feed on tap without a horizontal drag wrapper", () => {
    const { container } = render(<ChatWidgetsArea {...props} />);
    const feed = container.querySelector("[data-story-feed]");
    expect(feed).toBeTruthy();
    expect(feed.getAttribute("drag")).toBeNull();
    expect(feed.style.transform || "").not.toMatch(/translate/i);

    const toggle = container.querySelector('button[aria-expanded]');
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toMatch(/Story Feed/i);
    expect(toggle.textContent).toMatch(/Show/i);

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toMatch(/Hide/i);

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses Story Feed from the close button, not a swipe", () => {
    const { container } = render(<ChatWidgetsArea {...props} />);
    const close = container.querySelector('button[aria-label="Hide Story Feed"]');
    expect(close).toBeTruthy();
    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-story-feed]")).toBeNull();
  });
});
