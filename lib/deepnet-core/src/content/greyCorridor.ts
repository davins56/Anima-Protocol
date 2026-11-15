/**
 * Slice-1 content. EVERY string is a LORE_TBD placeholder with neutral
 * stand-in text. Serenity drafts the real names, lines and stakes from
 * Shadow Walker and Fallen Circuit; Dàvīn reviews (#757). Do not add canon
 * here without that review, and never use franchise names (see names.ts).
 */
import { LORE_TBD } from "../lore";
import type { Corridor } from "../corridor";
import type { DecisionGate } from "../decision";
import type { Dialogue } from "../dialogue";
import type { MapSpec } from "../map";
import type { QuestDefinition } from "../quest";
import { DEEPNET_CONTENT_VERSION } from "../names";

export const GREY_CORRIDOR_QUEST_ID = "grey-corridor";
export const GATE_NODE_ID = "gate";
export const CORRIDOR_NODE_ID = "grey-corridor";

export const GREY_CORRIDOR_DIALOGUE: Dialogue = {
  id: "grey-corridor.encounter",
  start: "open",
  nodes: [
    {
      id: "open",
      speaker: LORE_TBD("encounter.speaker", "A figure in the static"),
      line: LORE_TBD("encounter.open", "[Placeholder line: the figure notices you and your companion.]"),
      choices: [
        { id: "ask", label: LORE_TBD("encounter.choice.ask", "Ask who they are"), next: "ask" },
        { id: "wait", label: LORE_TBD("encounter.choice.wait", "Wait and listen"), next: "wait" },
      ],
    },
    {
      id: "ask",
      speaker: LORE_TBD("encounter.speaker", "A figure in the static"),
      line: LORE_TBD("encounter.ask", "[Placeholder line: an answer that hints at the gate ahead.]"),
      choices: [{ id: "continue", label: LORE_TBD("encounter.choice.continue", "Continue"), next: "close" }],
    },
    {
      id: "wait",
      speaker: LORE_TBD("encounter.speaker", "A figure in the static"),
      line: LORE_TBD("encounter.wait", "[Placeholder line: the silence says something about the gate.]"),
      choices: [{ id: "continue", label: LORE_TBD("encounter.choice.continue", "Continue"), next: "close" }],
    },
    {
      id: "close",
      speaker: LORE_TBD("encounter.speaker", "A figure in the static"),
      line: LORE_TBD("encounter.close", "[Placeholder line: the figure steps aside. The gate hums at one frequency.]"),
      choices: [],
    },
  ],
};

export const GREY_CORRIDOR_GATE: DecisionGate = {
  id: "grey-corridor.gate",
  band: "rare",
  prompt: LORE_TBD("gate.prompt", "[Placeholder: what is at stake at the gate.] Tune to its frequency, then choose."),
  options: [
    { id: "hold", label: LORE_TBD("gate.option.hold", "Hold back and observe"), minTier: "distant" },
    { id: "reach", label: LORE_TBD("gate.option.reach", "Reach through together"), minTier: "attuned" },
    { id: "trust", label: LORE_TBD("gate.option.trust", "Let your companion lead"), minTier: "bonded" },
  ],
};

export const GREY_CORRIDOR: Corridor = {
  id: "grey-corridor",
  nodeId: CORRIDOR_NODE_ID,
  questId: GREY_CORRIDOR_QUEST_ID,
  name: LORE_TBD("place.grey-corridor.name", "Grey Corridor"),
  description: LORE_TBD("place.grey-corridor.description", "[Placeholder description of the corridor.]"),
  ambientBand: "ambient",
  segments: [
    { id: "entry", kind: "entry", label: LORE_TBD("corridor.entry", "Entry"), at: 0, requires: null },
    { id: "encounter", kind: "encounter", label: LORE_TBD("corridor.encounter", "Encounter"), at: 0.35, requires: "entered" },
    { id: "gate", kind: "gate", label: LORE_TBD("corridor.gate", "Resonance gate"), at: 0.7, requires: "encounter_met" },
    { id: "exit", kind: "exit", label: LORE_TBD("corridor.exit", "Beyond the gate"), at: 1, requires: "decision_made" },
  ],
};

export const DEEPNET_MAP_SPEC: MapSpec = {
  version: DEEPNET_CONTENT_VERSION,
  nodes: [
    { id: GATE_NODE_ID, kind: "gate", label: LORE_TBD("place.gate.name", "Entry gate"), band: "data", pos: [-8, 0], unlock: { kind: "always" } },
    {
      id: CORRIDOR_NODE_ID,
      kind: "corridor",
      label: LORE_TBD("place.grey-corridor.name", "Grey Corridor"),
      band: "ambient",
      pos: [-2, 0],
      unlock: { kind: "always" },
    },
    {
      id: "relay-1",
      kind: "relay",
      label: LORE_TBD("place.relay-1.name", "Relay (unnamed)"),
      band: "rare",
      pos: [4, -3],
      unlock: { kind: "quest_resolved", questId: GREY_CORRIDOR_QUEST_ID },
    },
    {
      id: "signal-lost-1",
      kind: "signal_lost",
      label: LORE_TBD("place.signal-lost-1.name", "Signal lost"),
      band: "noise",
      pos: [4, 3],
      unlock: { kind: "never" },
    },
  ],
  edges: [
    { from: GATE_NODE_ID, to: CORRIDOR_NODE_ID },
    { from: CORRIDOR_NODE_ID, to: "relay-1" },
    { from: CORRIDOR_NODE_ID, to: "signal-lost-1" },
  ],
};

export const GREY_CORRIDOR_QUEST: QuestDefinition = {
  id: GREY_CORRIDOR_QUEST_ID,
  dialogue: GREY_CORRIDOR_DIALOGUE,
  gate: GREY_CORRIDOR_GATE,
};

/** Every quest in the slice, by id. */
export const QUESTS: Readonly<Record<string, QuestDefinition>> = { [GREY_CORRIDOR_QUEST_ID]: GREY_CORRIDOR_QUEST };
