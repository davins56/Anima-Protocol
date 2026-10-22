/**
 * Input queue for the fixed-step loop. Inputs (keyboard, taps, dial, gamepad,
 * autopilot) are buffered between frames and only applied on a tick boundary,
 * stamped with that tick. The stamped log is exactly what
 * POST /api/sim/sessions/:id/actions replays, so the queue enforces the same
 * human-rate limits as sim-core's validateLog (otherwise the server would
 * reject an honest log).
 */
import {
  MAX_ACTIONS_PER_SECOND,
  MAX_ACTIONS_PER_TICK,
  MAX_LOG_ACTIONS,
  type SimAction,
  type StampedAction,
} from "@workspace/sim-core";

/** Window used by validateLog for MAX_ACTIONS_PER_SECOND (20 ticks = 1 s). */
export const RATE_WINDOW_TICKS = 20;
/** Pending inputs beyond this are dropped (a stuck key must not build a backlog). */
export const MAX_PENDING = 12;

export class InputQueue {
  private pending: SimAction[] = [];
  private recent: number[] = [];
  /** Every action ever applied, in order, with the tick it was applied at. */
  readonly log: StampedAction[] = [];

  get size(): number {
    return this.pending.length;
  }

  /**
   * Queue an input for the next tick boundary. A newer phase target replaces a
   * pending one (the dial streams targets; only the latest matters).
   */
  push(action: SimAction): boolean {
    if (action.t === "phase") {
      const i = this.pending.findIndex((p) => p.t === "phase");
      if (i >= 0) {
        this.pending[i] = action;
        return true;
      }
    }
    if (this.pending.length >= MAX_PENDING) return false;
    this.pending.push(action);
    return true;
  }

  clear(): void {
    this.pending = [];
  }

  /** Remove and stamp the inputs that may apply at `tick` under the server's rate limits. */
  take(tick: number): StampedAction[] {
    while (this.recent.length && this.recent[0] <= tick - RATE_WINDOW_TICKS) this.recent.shift();
    const out: StampedAction[] = [];
    while (
      this.pending.length &&
      out.length < MAX_ACTIONS_PER_TICK &&
      this.recent.length < MAX_ACTIONS_PER_SECOND &&
      this.log.length < MAX_LOG_ACTIONS
    ) {
      const stamped: StampedAction = { tick, action: this.pending.shift()! };
      out.push(stamped);
      this.log.push(stamped);
      this.recent.push(tick);
    }
    return out;
  }
}
