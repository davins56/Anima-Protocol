import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NetworkMap2D from "./NetworkMap2D";
import { chooseDialogue, corridorProgress, isTerminal, panelFor, startDialogue } from "./flow";
import type { DeepnetMap, QuestView } from "./types";

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  map: vi.fn(),
  enter: vi.fn(),
  quest: vi.fn(),
  step: vi.fn(),
}));
vi.mock("./api", () => ({ deepnetApi: apiMock }));
vi.mock("@/lib/listPersonalAnimas", () => ({ listPersonalAnimas: vi.fn(async () => [{ id: "char-a", name: "Companion A" }]) }));

import DeepnetPage from "./DeepnetPage";

const MAP: DeepnetMap = {
  version: "v",
  nodes: [
    { id: "gate", kind: "gate", label_key: "place.gate.name", label: "Entry gate", band: "data", pos: [-8, 0], locked: false },
    { id: "grey-corridor", kind: "corridor", label_key: "k", label: "Grey Corridor", band: "ambient", pos: [-2, 0], locked: false },
    { id: "relay-1", kind: "relay", label_key: "k2", label: "Relay (unnamed)", band: "rare", pos: [4, -3], locked: true },
  ],
  edges: [
    { from: "gate", to: "grey-corridor", state: "open" },
    { from: "grey-corridor", to: "relay-1", state: "locked" },
  ],
};

const VIEW: QuestView = {
  quest_id: "grey-corridor",
  content_version: "v",
  bond_tier: "distant",
  state: { step: null, seq: 0, outcome: null, events: [] },
  corridor: {
    id: "grey-corridor",
    name: "Grey Corridor",
    description: "desc",
    ambient_band: "ambient",
    segments: [
      { id: "entry", kind: "entry", label: "Entry", at: 0, requires: null },
      { id: "encounter", kind: "encounter", label: "Encounter", at: 0.35, requires: "entered" },
      { id: "gate", kind: "gate", label: "Gate", at: 0.7, requires: "encounter_met" },
      { id: "exit", kind: "exit", label: "Exit", at: 1, requires: "decision_made" },
    ],
  },
  dialogue: {
    id: "d",
    start: "open",
    nodes: [
      { id: "open", speaker: "S", line: "<img src=x onerror=alert(1)>", choices: [{ id: "ask", label: "Ask", next: "close" }] },
      { id: "close", speaker: "S", line: "Bye", choices: [] },
    ],
  },
  gate: {
    id: "g",
    band: "rare",
    prompt: "Tune",
    options: [
      { id: "hold", label: "Hold", min_tier: "distant", available: true },
      { id: "trust", label: "Trust", min_tier: "bonded", available: false },
    ],
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("flow helpers", () => {
  it("maps quest steps to panels", () => {
    expect([null, "entered", "encounter_met", "decision_made", "resolved"].map((s) => panelFor(s as never))).toEqual([
      "enter",
      "encounter",
      "gate",
      "resolve",
      "done",
    ]);
  });

  it("walks dialogue only along authored choices", () => {
    const c0 = startDialogue(VIEW.dialogue);
    expect(chooseDialogue(VIEW.dialogue, c0, "made-up")).toBe(c0);
    const c1 = chooseDialogue(VIEW.dialogue, c0, "ask");
    expect(c1).toEqual({ nodeId: "close", choices: ["ask"] });
    expect(isTerminal(VIEW.dialogue, c0)).toBe(false);
    expect(isTerminal(VIEW.dialogue, c1)).toBe(true);
  });

  it("tracks corridor progress from the recorded step", () => {
    expect(corridorProgress(VIEW)).toBe(0);
    expect(corridorProgress({ ...VIEW, state: { ...VIEW.state, step: "encounter_met" } })).toBe(0.7);
    expect(corridorProgress({ ...VIEW, state: { ...VIEW.state, step: "resolved" } })).toBe(1);
  });
});

describe("NetworkMap2D", () => {
  it("renders nodes and edges and only selects unlocked nodes", () => {
    const onSelect = vi.fn();
    render(<NetworkMap2D map={MAP} onSelect={onSelect} />);
    expect(screen.getByTestId("edge-grey-corridor-relay-1").getAttribute("stroke-dasharray")).toBeTruthy();
    fireEvent.click(screen.getByTestId("node-relay-1"));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("node-grey-corridor"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("grey-corridor");
    expect(screen.getByLabelText("Relay (unnamed) (locked)")).toBeTruthy();
  });
});

describe("DeepnetPage", () => {
  it("shows nothing but 'not available' when the server says no (flag off = 404), and fetches nothing else", async () => {
    apiMock.status.mockResolvedValue({ ok: false, status: 404, data: null });
    render(<DeepnetPage />);
    await screen.findByTestId("deepnet-unavailable");
    expect(apiMock.map).not.toHaveBeenCalled();
    expect(apiMock.enter).not.toHaveBeenCalled();
  });

  it("renders the map, enters the corridor and shows server text as plain text", async () => {
    apiMock.status.mockResolvedValue({ ok: true, status: 200, data: { enabled: true, allowed: true, display_name: "Deepnet (working name)" } });
    apiMock.map.mockResolvedValue({ ok: true, status: 200, data: MAP });
    apiMock.enter.mockResolvedValue({ ok: true, status: 200, data: { quest_id: "grey-corridor" } });
    apiMock.quest.mockResolvedValue({ ok: true, status: 200, data: VIEW });
    apiMock.step.mockResolvedValue({ ok: true, status: 200, data: { ...VIEW, state: { ...VIEW.state, step: "entered", seq: 1 } } });

    const { container } = render(<DeepnetPage />);
    await screen.findByText("Deepnet (working name)");
    await waitFor(() => expect(apiMock.map).toHaveBeenCalledWith("char-a"));
    fireEvent.click(await screen.findByTestId("node-grey-corridor"));
    fireEvent.click(await screen.findByText("Step inside"));
    await waitFor(() => expect(apiMock.step).toHaveBeenCalledWith("char-a", "grey-corridor", 0, { step: "entered" }));
    await screen.findByTestId("deepnet-dialogue");
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("module hygiene", () => {
  it("uses no franchise names and never injects HTML", () => {
    const sources = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5);
    for (const text of Object.values(sources)) {
      expect(text).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
      expect(text.toLowerCase()).not.toMatch(/megaman|mega man|netnavi|battle chip|mettaur|undernet|\bpet\b/);
    }
  });
});
