/**
 * Anti-cheat lite: the server never trusts client outcomes. It re-runs the
 * append-only input log through the same deterministic engine and only
 * records consequences (memory corruption/restoration, battle outcome) that
 * the replay itself produced.
 */
import { MAX_TICKS, replay, stateHash } from "./engine";
import type { EmittedEvent, SimAction, SimConfig, SimState, StampedAction } from "./types";

export const MAX_LOG_ACTIONS = 6000;
export const MAX_ACTIONS_PER_TICK = 3;
/** sustained input rate cap: N actions per 20-tick (1 s) window */
export const MAX_ACTIONS_PER_SECOND = 14;

const KINDS = new Set(["move", "phase", "buster", "chip", "custom_open", "custom_pick", "purify"]);

export function isSimAction(a: unknown): a is SimAction {
  const x = a as Record<string, unknown>;
  if (!x || typeof x !== "object" || !KINDS.has(String(x.t))) return false;
  if (x.t === "move") return Number.isInteger(x.dc) && Number.isInteger(x.dr) && Math.abs(Number(x.dc)) <= 1 && Math.abs(Number(x.dr)) <= 1;
  if (x.t === "phase") return typeof x.toW === "number" && Number.isFinite(x.toW);
  if (x.t === "custom_pick") return Array.isArray(x.picks) && x.picks.length <= 5 && x.picks.every((n) => Number.isInteger(n));
  if (x.t === "purify") return x.targetEventId === undefined || typeof x.targetEventId === "string";
  return true;
}

export type ValidationOk = { ok: true; state: SimState; events: EmittedEvent[]; hash: string; consequences: EmittedEvent[] };
export type ValidationFail = { ok: false; reason: string; index?: number };

export const CONSEQUENTIAL = new Set(["memory_corrupted", "memory_restored", "battle_end", "unit_defeated"]);

export function validateLog(
  config: SimConfig,
  actions: StampedAction[],
  claimed?: { tick: number; hash: string },
): ValidationOk | ValidationFail {
  if (!Array.isArray(actions)) return { ok: false, reason: "actions must be an array" };
  if (actions.length > MAX_LOG_ACTIONS) return { ok: false, reason: "log too long" };
  let prev = -1;
  let sameTick = 0;
  const window: number[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || !Number.isInteger(a.tick) || a.tick < 0 || a.tick > MAX_TICKS) return { ok: false, reason: "bad tick", index: i };
    if (a.tick < prev) return { ok: false, reason: "ticks must be non-decreasing", index: i };
    if (!isSimAction(a.action)) return { ok: false, reason: "malformed action", index: i };
    sameTick = a.tick === prev ? sameTick + 1 : 1;
    if (sameTick > MAX_ACTIONS_PER_TICK) return { ok: false, reason: "too many inputs in one tick", index: i };
    window.push(a.tick);
    while (window.length && window[0] <= a.tick - 20) window.shift();
    if (window.length > MAX_ACTIONS_PER_SECOND) return { ok: false, reason: "input rate exceeds human limits", index: i };
    prev = a.tick;
  }
  const until = claimed ? Math.max(claimed.tick, prev) : undefined;
  if (until !== undefined && until > MAX_TICKS) return { ok: false, reason: "bad claimed tick" };
  const { state, events } = replay(config, actions, until);
  const hash = stateHash(state);
  if (claimed && claimed.hash !== hash) return { ok: false, reason: `state hash mismatch (server ${hash})` };
  return { ok: true, state, events, hash, consequences: events.filter((e) => CONSEQUENTIAL.has(e.type)) };
}
