/**
 * Fixed-timestep driver for sim-core. Rendering runs at display rate; the
 * simulation advances in exact TICK_MS (50 ms) steps from an accumulator, and
 * the renderer interpolates between the previous and current state with
 * `alpha` (0–1). sim-core stays the single source of truth: nothing here
 * changes engine semantics, it only decides *when* to call advance()/step().
 *
 * Tick N is produced by: advance(curr, N) then step(·, {tick: N, action}) for
 * each input stamped N — exactly what sim-core's replay() does with the log,
 * so live play and server replay reach the same stateHash.
 */
import {
  advance,
  createSim,
  MAX_TICKS,
  replay,
  stateHash,
  step,
  TICK_MS,
  type EmittedEvent,
  type SimAction,
  type SimConfig,
  type SimState,
} from "@workspace/sim-core";
import { InputQueue } from "./inputQueue";

export type LoopOptions = {
  /** Max ticks simulated per update() call; the rest of a long stall is dropped. */
  maxCatchUpSteps?: number;
  /** Frame deltas above this are clamped (tab switch, debugger pause). */
  maxFrameMs?: number;
};

export type TickInfo = { tick: number; state: SimState; prev: SimState; events: EmittedEvent[] };
export type TickListener = (info: TickInfo) => void;
/** Runs on the tick boundary before inputs are drained (autopilot, dial commit). */
export type BeforeTick = (curr: SimState, loop: FixedStepLoop) => void;

export class FixedStepLoop {
  readonly config: SimConfig;
  readonly input = new InputQueue();
  prev: SimState;
  curr: SimState;
  /** ms of real time not yet simulated */
  accumulator = 0;
  /** render interpolation factor between prev (0) and curr (1) */
  alpha = 0;
  paused = false;
  /** ticks dropped because a frame needed more than maxCatchUpSteps */
  droppedTicks = 0;
  private readonly maxCatchUpSteps: number;
  private readonly maxFrameMs: number;
  private listeners = new Set<TickListener>();
  private hooks = new Set<BeforeTick>();

  constructor(config: SimConfig, opts: LoopOptions = {}) {
    this.config = config;
    this.curr = createSim(config);
    this.prev = this.curr;
    this.maxCatchUpSteps = Math.max(1, opts.maxCatchUpSteps ?? 5);
    this.maxFrameMs = Math.max(TICK_MS, opts.maxFrameMs ?? 250);
  }

  get done(): boolean {
    return !!this.curr.outcome || this.curr.tick >= MAX_TICKS;
  }

  /** Render time in ticks (fractional), for interpolating effects. */
  get renderTick(): number {
    return this.prev.tick + (this.curr.tick - this.prev.tick) * this.alpha;
  }

  enqueue(action: SimAction): boolean {
    if (this.done) return false;
    return this.input.push(action);
  }

  subscribe(fn: TickListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  beforeTick(fn: BeforeTick): () => void {
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // Never "catch up" on time spent hidden/paused.
    this.accumulator = 0;
  }

  /** Feed real elapsed time; returns the number of ticks simulated. */
  update(dtMs: number): number {
    if (this.paused || this.done) {
      if (this.done) this.alpha = 1;
      return 0;
    }
    this.accumulator += Math.min(Math.max(0, Number.isFinite(dtMs) ? dtMs : 0), this.maxFrameMs);
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < this.maxCatchUpSteps && !this.done) {
      this.tickOnce();
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (this.accumulator >= TICK_MS) {
      const drop = Math.floor(this.accumulator / TICK_MS);
      this.droppedTicks += drop;
      this.accumulator -= drop * TICK_MS;
    }
    this.alpha = this.done ? 1 : this.accumulator / TICK_MS;
    return steps;
  }

  /** Advance exactly one tick, applying inputs stamped for it. */
  tickOnce(): TickInfo | null {
    if (this.done) return null;
    for (const hook of this.hooks) hook(this.curr, this);
    const tick = this.curr.tick + 1;
    const adv = advance(this.curr, tick);
    let state = adv.state;
    const events = adv.events.slice();
    for (const stamped of this.input.take(tick)) {
      const r = step(state, stamped);
      state = r.state;
      events.push(...r.events);
    }
    const info: TickInfo = { tick, state, prev: this.curr, events };
    this.prev = this.curr;
    this.curr = state;
    for (const fn of this.listeners) fn(info);
    return info;
  }

  hash(): string {
    return stateHash(this.curr);
  }

  /** Re-run the stamped log from scratch (what the server does) and compare hashes. */
  verifyReplay(): { ok: boolean; local: string; replayed: string } {
    const r = replay(this.config, this.input.log, this.curr.tick);
    const replayed = stateHash(r.state);
    const local = this.hash();
    return { ok: replayed === local, local, replayed };
  }
}
