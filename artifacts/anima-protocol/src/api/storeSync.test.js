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

// Hardening for hostile networks (strict proxies / CDNs): the live push stream
// must survive proxy newline normalization (\r\n\r\n blocks), recover from a
// silently stalled stream via the heartbeat watchdog, and surface a signal that
// distinguishes "push connected" from "polling fallback".
describe('store sync push transport hardening', () => {
  let revisionFetches;
  let eventsConnects;
  let currentStream;

  // A controllable mock of a fetch streaming body. read() resolves as chunks
  // are pushed; abort() (wired to the request signal) unwinds the read loop the
  // way a real aborted fetch would.
  const makeStream = (signal) => {
    const queue = [];
    let waiting = null;
    let done = false;
    const encoder = new TextEncoder();
    const deliver = () => {
      if (!waiting) return;
      if (queue.length) {
        const r = waiting;
        waiting = null;
        r({ value: queue.shift(), done: false });
      } else if (done) {
        const r = waiting;
        waiting = null;
        r({ value: undefined, done: true });
      }
    };
    if (signal) {
      signal.addEventListener('abort', () => {
        done = true;
        deliver();
      });
    }
    return {
      push(text) {
        queue.push(encoder.encode(text));
        deliver();
      },
      getReader() {
        return {
          read() {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => {
              waiting = resolve;
            });
          },
        };
      },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    revisionFetches = 0;
    eventsConnects = 0;
    currentStream = null;
    setAuthTokenGetter(() => 'test-token');
    global.fetch = vi.fn((url, options) => {
      const u = String(url);
      if (u.includes('/events')) {
        eventsConnects += 1;
        const stream = makeStream(options?.signal);
        currentStream = stream;
        return Promise.resolve({ ok: true, status: 200, body: stream });
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

  it('parses change blocks separated by \\r\\n\\r\\n (proxy newline normalization)', async () => {
    startStoreSync();
    await tick();
    const before = revisionFetches;

    // Deliver a change event using CRLF line endings, as a normalizing proxy
    // would rewrite it. The block separator is \r\n\r\n, not \n\n.
    currentStream.push('event: change\r\ndata: 1\r\n\r\n');
    await tick();
    // onServerPush debounces the revision recheck.
    vi.advanceTimersByTime(300);
    await tick();

    expect(revisionFetches).toBeGreaterThan(before);
  });

  it('reconnects when the heartbeat watchdog fires on a silent stream', async () => {
    startStoreSync();
    await tick();
    expect(eventsConnects).toBe(1);

    // No bytes at all (a proxy holding the stream open but delivering nothing):
    // after the watchdog timeout the stream is aborted and a backoff reconnect
    // is scheduled, producing a second /events connect.
    vi.advanceTimersByTime(60000); // watchdog fires
    await tick();
    vi.advanceTimersByTime(1000); // backoff reconnect delay
    await tick();

    expect(eventsConnects).toBeGreaterThan(1);
  });

  it('emits a sync-mode signal for push connected then polling fallback', async () => {
    const modes = [];
    const onMode = (e) => modes.push(e.detail.mode);
    window.addEventListener('anima:sync-mode', onMode);

    startStoreSync();
    await tick();
    expect(modes).toContain('push');

    // A heartbeat-less stream drops; the transport must announce the fallback.
    vi.advanceTimersByTime(60000);
    await tick();

    expect(modes).toContain('polling');
    window.removeEventListener('anima:sync-mode', onMode);
  });
});
