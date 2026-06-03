import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  setAuthTokenGetter,
  startStoreSync,
  stopStoreSync,
} from './base44Client';

// Regression coverage for the live-sync lifecycle. The dangerous case is the
// teardown race: startStoreSync() opens the SSE stream (an async fetch), then
// stopStoreSync() runs while that fetch is still in flight. When the fetch
// finally settles, connectSse()'s finally block runs — and must NOT resurrect
// the polling interval after sync was explicitly stopped (sign-out / account
// switch), or the app keeps hammering /revision forever with no session.

const tick = async (n = 8) => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

describe('store sync lifecycle', () => {
  let revisionFetches;
  let resolveEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    revisionFetches = 0;
    resolveEvents = null;
    setAuthTokenGetter(() => 'test-token');
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/events')) {
        // A controllable SSE connect that stays pending until we settle it.
        return new Promise((resolve) => {
          resolveEvents = resolve;
        });
      }
      if (u.includes('/revision')) {
        revisionFetches += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ revision: `r${revisionFetches}` }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    stopStoreSync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('stops polling after stopStoreSync() even if SSE settles afterward', async () => {
    startStoreSync();
    await tick(); // let the initial pollRevision + SSE connect get going

    stopStoreSync();

    // The in-flight SSE fetch settles AFTER stop — drives connectSse()'s finally.
    resolveEvents?.({ ok: false, status: 503, body: null });
    await tick();

    const pollsAfterStop = revisionFetches;
    // If a poll interval were still alive it would fire many times over 2 min.
    vi.advanceTimersByTime(120000);
    await tick();

    expect(revisionFetches).toBe(pollsAfterStop);
  });

  it('keeps polling as a fallback while SSE is connecting', async () => {
    startStoreSync();
    await tick();
    const initial = revisionFetches;

    // SSE never connects (fetch stays pending); the fallback poll must keep
    // firing at the fast cadence so changes are still detected.
    vi.advanceTimersByTime(15000);
    await tick();

    expect(revisionFetches).toBeGreaterThan(initial);
  });
});
