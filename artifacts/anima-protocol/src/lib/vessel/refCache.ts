/**
 * Ref-counted cache for GPU resources shared between vessel instances
 * (materials keyed by colour+mode, dev/blob GLTF scenes). get() creates on
 * demand without taking a reference; retain()/release() run in effects. An
 * entry whose count reaches 0 is disposed after a grace period, so StrictMode
 * double effects, Suspense retries and quick remounts reuse it instead of
 * thrashing the GPU.
 */
export type RefCache<V> = {
  get(key: string, create: () => V): V;
  retain(key: string): void;
  release(key: string): void;
  refs(key: string): number;
  has(key: string): boolean;
  size(): number;
  /** Dispose every unreferenced entry now. */
  sweep(): void;
  /** Dispose everything (tests / teardown). */
  clear(): void;
};

type Entry<V> = { value: V; count: number; idleSince: number };

export function createRefCache<V>(
  dispose: (value: V, key: string) => void,
  opts: { graceMs?: number; now?: () => number; schedule?: (fn: () => void, ms: number) => unknown } = {},
): RefCache<V> {
  const graceMs = opts.graceMs ?? 1000;
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const map = new Map<string, Entry<V>>();
  let pending = false;

  const drop = (key: string, e: Entry<V>) => {
    map.delete(key);
    try {
      dispose(e.value, key);
    } catch {
      /* disposal must never break rendering */
    }
  };
  const collect = (force: boolean) => {
    const t = now();
    for (const [key, e] of map) if (e.count <= 0 && (force || t - e.idleSince >= graceMs)) drop(key, e);
  };
  const later = () => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      collect(false);
      for (const e of map.values()) if (e.count <= 0) return later();
    }, graceMs);
  };

  return {
    get(key, create) {
      let e = map.get(key);
      if (!e) {
        e = { value: create(), count: 0, idleSince: now() };
        map.set(key, e);
        later(); // created by a render that might never commit
      }
      return e.value;
    },
    retain(key) {
      const e = map.get(key);
      if (e) e.count += 1;
    },
    release(key) {
      const e = map.get(key);
      if (!e) return;
      e.count = Math.max(0, e.count - 1);
      if (e.count === 0) {
        e.idleSince = now();
        later();
      }
    },
    refs: (key) => map.get(key)?.count ?? 0,
    has: (key) => map.has(key),
    size: () => map.size,
    sweep: () => collect(true),
    clear() {
      for (const [key, e] of map) drop(key, e);
    },
  };
}
