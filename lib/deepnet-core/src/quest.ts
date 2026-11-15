/**
 * Persistent quest state as an append-only event list per (user, character,
 * quest). The server is authoritative: it validates each requested step with
 * `nextQuestEvent`, computing every outcome itself (bond tier is server input,
 * the decision outcome is recomputed from tuned W). `replayQuest` rebuilds and
 * re-validates a stored list, so a tampered log is detected.
 */
import type { BandKey } from "@workspace/sim-core";
import { isBondTier, type BondTier } from "./bond";
import { resolveDecision, type DecisionGate, type DecisionOutcome } from "./decision";
import { walkDialogue, type Dialogue } from "./dialogue";

export const QUEST_STEPS = ["entered", "encounter_met", "decision_made", "resolved"] as const;
export type QuestStep = (typeof QUEST_STEPS)[number];

export type QuestEvent = {
  seq: number;
  step: QuestStep;
  contentVersion: string;
  at: string;
  /** encounter_met: the dialogue choices taken. */
  dialogueChoices?: string[];
  /** decision_made */
  optionId?: string;
  tunedW?: number;
  band?: BandKey;
  bandGap?: number;
  bondTier?: BondTier;
  outcome?: DecisionOutcome;
  corruptionEligible?: boolean;
};

export type QuestState = {
  questId: string;
  step: QuestStep | null;
  seq: number;
  outcome: DecisionOutcome | null;
  events: QuestEvent[];
};

export type QuestDefinition = {
  readonly id: string;
  readonly dialogue: Dialogue;
  readonly gate: DecisionGate;
};

export type QuestRequest =
  | { step: "entered" }
  | { step: "encounter_met"; dialogueChoices: unknown }
  | { step: "decision_made"; optionId: unknown; tunedW: unknown }
  | { step: "resolved" };

export type QuestError =
  | "bad_step"
  | "out_of_order"
  | "already_resolved"
  | "bad_choice"
  | "encounter_incomplete"
  | "unknown_option"
  | "option_locked"
  | "invalid_w"
  | "bad_tier"
  | "bad_log";

export function emptyQuestState(questId: string): QuestState {
  return { questId, step: null, seq: 0, outcome: null, events: [] };
}

function expectedNext(step: QuestStep | null): QuestStep | null {
  if (step === null) return "entered";
  const i = QUEST_STEPS.indexOf(step);
  return i >= 0 && i < QUEST_STEPS.length - 1 ? QUEST_STEPS[i + 1] : null;
}

export function isQuestStep(v: unknown): v is QuestStep {
  return typeof v === "string" && (QUEST_STEPS as readonly string[]).includes(v);
}

/** Validates a requested step and returns the event the server should append. */
export function nextQuestEvent(
  def: QuestDefinition,
  state: QuestState,
  req: QuestRequest,
  ctx: { bondTier: BondTier; contentVersion: string; now: string },
): { ok: true; event: QuestEvent } | { ok: false; code: QuestError } {
  if (!req || !isQuestStep((req as { step?: unknown }).step)) return { ok: false, code: "bad_step" };
  if (state.step === "resolved") return { ok: false, code: "already_resolved" };
  if (req.step !== expectedNext(state.step)) return { ok: false, code: "out_of_order" };
  if (!isBondTier(ctx.bondTier)) return { ok: false, code: "bad_tier" };
  const base = { seq: state.seq + 1, step: req.step, contentVersion: ctx.contentVersion, at: ctx.now } as const;

  switch (req.step) {
    case "entered":
    case "resolved":
      return { ok: true, event: { ...base } };
    case "encounter_met": {
      const raw = req.dialogueChoices;
      if (!Array.isArray(raw) || !raw.every((c) => typeof c === "string")) return { ok: false, code: "bad_choice" };
      const walked = walkDialogue(def.dialogue, raw as string[]);
      if (!walked.ok) return { ok: false, code: "bad_choice" };
      if (!walked.terminal) return { ok: false, code: "encounter_incomplete" };
      return { ok: true, event: { ...base, dialogueChoices: [...(raw as string[])] } };
    }
    case "decision_made": {
      const r = resolveDecision(def.gate, { optionId: String(req.optionId ?? ""), tunedW: req.tunedW, tier: ctx.bondTier });
      if (!r.ok) return { ok: false, code: r.code };
      return {
        ok: true,
        event: {
          ...base,
          optionId: r.optionId,
          tunedW: r.tunedW,
          band: r.band,
          bandGap: r.bandGap,
          bondTier: ctx.bondTier,
          outcome: r.outcome,
          corruptionEligible: r.corruptionEligible,
        },
      };
    }
  }
}

export function applyQuestEvent(state: QuestState, event: QuestEvent): QuestState {
  return {
    questId: state.questId,
    step: event.step,
    seq: event.seq,
    outcome: event.outcome ?? state.outcome,
    events: [...state.events, event],
  };
}

/** Rebuilds state from a stored log, re-validating every step against the definition. */
export function replayQuest(def: QuestDefinition, events: readonly QuestEvent[]): { ok: true; state: QuestState } | { ok: false; code: "bad_log"; at: number } {
  let state = emptyQuestState(def.id);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const req: QuestRequest =
      e.step === "encounter_met"
        ? { step: e.step, dialogueChoices: e.dialogueChoices }
        : e.step === "decision_made"
          ? { step: e.step, optionId: e.optionId, tunedW: e.tunedW }
          : ({ step: e.step } as QuestRequest);
    const tier = e.step === "decision_made" ? (e.bondTier as BondTier) : "distant";
    const r = nextQuestEvent(def, state, req, { bondTier: tier, contentVersion: e.contentVersion, now: e.at });
    if (!r.ok || r.event.seq !== e.seq || r.event.outcome !== e.outcome) return { ok: false, code: "bad_log", at: i };
    state = applyQuestEvent(state, r.event);
  }
  return { ok: true, state };
}
