/**
 * Demand-rendering gate for R3F hosts. The canvas renders continuously only
 * while something holds it (a drag, live speech, a playing clip) or a pulse
 * (emotion shift, mood change, model load, pointer move) is still running;
 * otherwise it falls back to frameloop="demand" and renders on invalidate().
 */
export type FrameloopGate = {
  /** Keep the loop running until release(key). */
  hold(key: string): void;
  release(key: string): void;
  /** Keep the loop running for at least `ms` from now. */
  pulse(ms: number): void;
  isActive(): boolean;
  subscribe(fn: () => void): () => void;
  dispose(): void;
};

type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const defaultClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createFrameloopGate(clock: Clock = defaultClock): FrameloopGate {
  const holds = new Set<string>();
  const listeners = new Set<() => void>();
  let until = 0;
  let timer: unknown = null;
  let active = false;

  const compute = () => holds.size > 0 || clock.now() < until;
  const sync = () => {
    const next = compute();
    if (next === active) return;
    active = next;
    listeners.forEach((fn) => fn());
  };
  const arm = () => {
    if (timer != null) clock.clearTimeout(timer);
    timer = null;
    const left = until - clock.now();
    if (left > 0) {
      timer = clock.setTimeout(() => {
        timer = null;
        sync();
        if (clock.now() < until) arm();
      }, left);
    }
  };

  return {
    hold(key) {
      holds.add(key);
      sync();
    },
    release(key) {
      holds.delete(key);
      sync();
    },
    pulse(ms) {
      if (!(ms > 0)) return;
      const end = clock.now() + ms;
      if (end > until) {
        until = end;
        arm();
      }
      sync();
    },
    isActive: () => active,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      if (timer != null) clock.clearTimeout(timer);
      timer = null;
      holds.clear();
      listeners.clear();
      until = 0;
      active = false;
    },
  };
}

export type FrameloopMode = "always" | "demand" | "never";

/** Pure frameloop choice: hidden → never; held/pulsed → always; idle → demand. */
export function frameloopFor({ visible, active }: { visible: boolean; active: boolean }): FrameloopMode {
  if (!visible) return "never";
  return active ? "always" : "demand";
}
