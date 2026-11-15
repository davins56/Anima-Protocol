/**
 * Pure UI flow for the Grey Corridor: which panel to show for a quest state,
 * and a local walk through the authored dialogue (the server re-validates the
 * whole choice list when the encounter is submitted).
 */
import type { QuestStep, QuestView } from "./types";

export type Panel = "enter" | "encounter" | "gate" | "resolve" | "done";

export function panelFor(step: QuestStep | null): Panel {
  switch (step) {
    case null:
      return "enter";
    case "entered":
      return "encounter";
    case "encounter_met":
      return "gate";
    case "decision_made":
      return "resolve";
    case "resolved":
      return "done";
  }
}

export type DialogueCursor = { nodeId: string; choices: string[] };

export function startDialogue(d: QuestView["dialogue"]): DialogueCursor {
  return { nodeId: d.start, choices: [] };
}

export function chooseDialogue(d: QuestView["dialogue"], cur: DialogueCursor, choiceId: string): DialogueCursor {
  const node = d.nodes.find((n) => n.id === cur.nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice || !d.nodes.some((n) => n.id === choice.next)) return cur;
  return { nodeId: choice.next, choices: [...cur.choices, choiceId] };
}

export function isTerminal(d: QuestView["dialogue"], cur: DialogueCursor): boolean {
  return (d.nodes.find((n) => n.id === cur.nodeId)?.choices.length ?? 1) === 0;
}

/** Corridor progress 0..1: the furthest segment the recorded step has unlocked. */
export function corridorProgress(view: QuestView): number {
  const order: (QuestStep | null)[] = [null, "entered", "encounter_met", "decision_made", "resolved"];
  const rank = order.indexOf(view.state.step);
  let at = 0;
  for (const s of view.corridor.segments) if (order.indexOf(s.requires) <= rank) at = Math.max(at, s.at);
  return at;
}

export const OUTCOME_TEXT: Record<string, string> = {
  clean: "The signal held clean.",
  partial: "The signal held, but frayed at the edges.",
  dissonant: "The signal went dissonant. (Memory effects are not active in this build.)",
};
