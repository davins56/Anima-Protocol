/**
 * React bindings for the fixed-step loop: tick-rate snapshots for structure
 * (which units/panels/portals exist, HUD numbers) via useSyncExternalStore,
 * while per-frame motion reads loop.prev/curr/alpha directly inside useFrame.
 */
import { useSyncExternalStore } from "react";
import type { SimState } from "@workspace/sim-core";
import { deriveFx, flinchUpdates, pruneFx, type Fx } from "@/lib/simClient/fx";
import type { FixedStepLoop, TickInfo } from "@/lib/simClient/fixedStepLoop";

export function useLoopState(loop: FixedStepLoop): SimState {
  return useSyncExternalStore(
    (cb) => loop.subscribe(cb),
    () => loop.curr,
    () => loop.curr,
  );
}

/** Transient effects + flinch timers derived from each tick's events. */
export class SimFxStore {
  fx: Fx[] = [];
  readonly flinchUntil = new Map<string, number>();
  readonly defeatedAt = new Map<string, number>();
  private listeners = new Set<() => void>();
  private unsub: () => void;

  constructor(loop: FixedStepLoop) {
    this.unsub = loop.subscribe((info) => this.onTick(info));
  }

  dispose(): void {
    this.unsub();
    this.listeners.clear();
  }

  private onTick({ events, state, tick }: TickInfo): void {
    const added = deriveFx(events, state);
    for (const [id, until] of flinchUpdates(events)) this.flinchUntil.set(id, until);
    for (const f of added) if (f.kind === "defeat") this.defeatedAt.set(f.unitId, f.tick);
    const kept = pruneFx(this.fx, tick);
    if (added.length || kept.length !== this.fx.length) {
      this.fx = added.length ? kept.concat(added) : kept;
      for (const l of this.listeners) l();
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.fx;

  flinching(id: string, tick: number): number {
    return tick < (this.flinchUntil.get(id) ?? -1) ? 1 : 0;
  }
}

export function useFx(store: SimFxStore): Fx[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
