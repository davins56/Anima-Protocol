import { describe, it, expect, beforeEach, vi } from "vitest";

// The sync handlers fetch the open thread's messages through base44. Back it with
// a controllable in-memory mock so we can drive the exact timing of the
// cross-device race without a server or auth token. `messages.list` is the only
// surface the handlers touch.
vi.mock("@/api/base44Client", () => {
  return { base44: { messages: { list: vi.fn() } } };
});

import { base44 } from "@/api/base44Client";
import {
  syncActiveMessages,
  syncFromRemote,
  settleDeferredSync,
} from "@/lib/chatSyncHandlers";

// Let microtasks/timers drain so awaited fetches and their `.then` chains run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A manually-resolved promise so a fetch can be left "in flight" mid-test.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const SESSION_ID = "s1";
const userMsg = { role: "user", content: "hi" };
const thinkingBubble = { character_name: "__thinking__", content: "" };
const typingBubble = { character_name: "__typing__", content: "" };

// The remote messages another device produced, as the server would return them.
function remoteMessages() {
  return [
    { role: "user", content: "hi" },
    { role: "assistant", content: "remote reply" },
  ];
}

// A tiny harness mirroring the page's activeSession state + ref and setter.
function makeHarness(initialMessages) {
  let activeSession = { id: SESSION_ID, messages: initialMessages };
  const activeSessionRef = {
    get current() {
      return activeSession;
    },
  };
  const setActiveSession = vi.fn((updater) => {
    activeSession =
      typeof updater === "function" ? updater(activeSession) : updater;
  });
  return {
    activeSessionRef,
    setActiveSession,
    get session() {
      return activeSession;
    },
    set session(next) {
      activeSession = next;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncActiveMessages (apply remote messages, never over an in-flight reply)", () => {
  it("applies fetched messages when the thread is idle", async () => {
    const h = makeHarness([userMsg]);
    base44.messages.list.mockResolvedValueOnce(remoteMessages());

    const applied = await syncActiveMessages({
      sessionId: SESSION_ID,
      activeSessionRef: h.activeSessionRef,
      setActiveSession: h.setActiveSession,
    });

    expect(applied).toBe(true);
    expect(base44.messages.list).toHaveBeenCalledWith(SESSION_ID);
    expect(h.session.messages.map((m) => m.content)).toEqual([
      "hi",
      "remote reply",
    ]);
  });

  it.each([
    ["__thinking__", thinkingBubble],
    ["__typing__", typingBubble],
  ])(
    "never clobbers a thread with an optimistic %s bubble and asks to retry",
    async (_label, bubble) => {
      const h = makeHarness([userMsg, bubble]);
      base44.messages.list.mockResolvedValueOnce(remoteMessages());

      const applied = await syncActiveMessages({
        sessionId: SESSION_ID,
        activeSessionRef: h.activeSessionRef,
        setActiveSession: h.setActiveSession,
      });

      expect(applied).toBe(false);
      expect(h.setActiveSession).not.toHaveBeenCalled();
      // The in-progress bubble is still present, untouched.
      expect(h.session.messages).toContain(bubble);
    },
  );

  it("reads the LATEST committed session after the await (a reply that started during the fetch is not clobbered)", async () => {
    // Starts idle, so the pending-bubble check would pass on the render-closure
    // snapshot — but a reply begins while the fetch is in flight.
    const h = makeHarness([userMsg]);
    const d = deferred();
    base44.messages.list.mockReturnValueOnce(d.promise);

    const promise = syncActiveMessages({
      sessionId: SESSION_ID,
      activeSessionRef: h.activeSessionRef,
      setActiveSession: h.setActiveSession,
    });

    // A new reply starts mid-fetch: the committed session now has a bubble.
    h.session = { id: SESSION_ID, messages: [userMsg, thinkingBubble] };
    d.resolve(remoteMessages());

    const applied = await promise;
    expect(applied).toBe(false);
    expect(h.setActiveSession).not.toHaveBeenCalled();
    expect(h.session.messages).toContain(thinkingBubble);
  });

  it("returns true (nothing to apply) when the user navigated to another thread", async () => {
    const h = makeHarness([userMsg]);
    h.session = { id: "other", messages: [userMsg] };
    base44.messages.list.mockResolvedValueOnce(remoteMessages());

    const applied = await syncActiveMessages({
      sessionId: SESSION_ID,
      activeSessionRef: h.activeSessionRef,
      setActiveSession: h.setActiveSession,
    });

    expect(applied).toBe(true);
    expect(h.setActiveSession).not.toHaveBeenCalled();
  });

  it("returns false on a transient fetch error so the caller re-arms a retry", async () => {
    const h = makeHarness([userMsg]);
    base44.messages.list.mockRejectedValueOnce(new Error("network"));

    const applied = await syncActiveMessages({
      sessionId: SESSION_ID,
      activeSessionRef: h.activeSessionRef,
      setActiveSession: h.setActiveSession,
    });

    expect(applied).toBe(false);
    expect(h.setActiveSession).not.toHaveBeenCalled();
  });

  it("returns true without fetching when no thread is open", async () => {
    const applied = await syncActiveMessages({
      sessionId: null,
      activeSessionRef: { current: null },
      setActiveSession: vi.fn(),
    });
    expect(applied).toBe(true);
    expect(base44.messages.list).not.toHaveBeenCalled();
  });
});

describe("syncFromRemote (react to a remote change)", () => {
  // The sidebar session list is metadata-only and can't corrupt an in-progress
  // reply, so it must refresh on EVERY remote change — the loading-flag deferral
  // only holds back the open thread's refetch, never the list. This guards
  // against a regression that gates loadSessions behind isLoading and makes new
  // conversations from another device not show up until generation finishes.
  it.each([
    ["idle", false],
    ["a reply is generating", true],
  ])(
    "always refreshes the sidebar when %s (deferral never gates the list)",
    (_label, isLoading) => {
      const loadSessions = vi.fn();
      const pendingRemoteSyncRef = { current: false };
      // runSync is irrelevant to the list guarantee; never let it touch state.
      const runSync = vi.fn(() => Promise.resolve(true));

      syncFromRemote({
        isLoading,
        loadSessions,
        pendingRemoteSyncRef,
        runSync,
      });

      expect(loadSessions).toHaveBeenCalledTimes(1);
    },
  );

  it("refreshes the sidebar and applies immediately when idle", async () => {
    const h = makeHarness([userMsg]);
    const loadSessions = vi.fn();
    const pendingRemoteSyncRef = { current: false };
    base44.messages.list.mockResolvedValueOnce(remoteMessages());
    const runSync = () =>
      syncActiveMessages({
        sessionId: SESSION_ID,
        activeSessionRef: h.activeSessionRef,
        setActiveSession: h.setActiveSession,
      });

    syncFromRemote({
      isLoading: false,
      loadSessions,
      pendingRemoteSyncRef,
      runSync,
    });
    await flush();

    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(pendingRemoteSyncRef.current).toBe(false);
    expect(h.session.messages.map((m) => m.content)).toEqual([
      "hi",
      "remote reply",
    ]);
  });

  it("defers (refreshes sidebar only) while a reply is generating", () => {
    const loadSessions = vi.fn();
    const pendingRemoteSyncRef = { current: false };
    const runSync = vi.fn();

    syncFromRemote({
      isLoading: true,
      loadSessions,
      pendingRemoteSyncRef,
      runSync,
    });

    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(pendingRemoteSyncRef.current).toBe(true);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("re-arms the pending flag when an idle apply is skipped (bubble present)", async () => {
    const h = makeHarness([userMsg, thinkingBubble]);
    const loadSessions = vi.fn();
    const pendingRemoteSyncRef = { current: false };
    base44.messages.list.mockResolvedValueOnce(remoteMessages());
    const runSync = () =>
      syncActiveMessages({
        sessionId: SESSION_ID,
        activeSessionRef: h.activeSessionRef,
        setActiveSession: h.setActiveSession,
      });

    syncFromRemote({
      isLoading: false,
      loadSessions,
      pendingRemoteSyncRef,
      runSync,
    });
    await flush();

    expect(pendingRemoteSyncRef.current).toBe(true);
    expect(h.setActiveSession).not.toHaveBeenCalled();
  });
});

describe("settleDeferredSync (catch up once generation settles)", () => {
  it("does nothing while still loading", () => {
    const pendingRemoteSyncRef = { current: true };
    const runSync = vi.fn();
    settleDeferredSync({ isLoading: true, pendingRemoteSyncRef, runSync });
    expect(runSync).not.toHaveBeenCalled();
    expect(pendingRemoteSyncRef.current).toBe(true);
  });

  it("does nothing when no remote change is pending", () => {
    const pendingRemoteSyncRef = { current: false };
    const runSync = vi.fn();
    settleDeferredSync({ isLoading: false, pendingRemoteSyncRef, runSync });
    expect(runSync).not.toHaveBeenCalled();
  });

  it("applies the deferred change and clears the flag once idle", async () => {
    const h = makeHarness([userMsg]);
    const pendingRemoteSyncRef = { current: true };
    base44.messages.list.mockResolvedValueOnce(remoteMessages());
    const runSync = () =>
      syncActiveMessages({
        sessionId: SESSION_ID,
        activeSessionRef: h.activeSessionRef,
        setActiveSession: h.setActiveSession,
      });

    settleDeferredSync({ isLoading: false, pendingRemoteSyncRef, runSync });
    await flush();

    expect(pendingRemoteSyncRef.current).toBe(false);
    expect(h.session.messages.map((m) => m.content)).toEqual([
      "hi",
      "remote reply",
    ]);
  });
});

// The end-to-end timeline the review caught: a remote change arrives mid-reply,
// then a SECOND local send starts before the deferred catch-up resolves. The
// deferred change must be retried and eventually applied after the device
// settles, and the optimistic bubbles must never be clobbered along the way.
describe("the dropped-update race (remote change mid-reply, second send mid-catch-up)", () => {
  it("retries the deferred remote change and applies it only after the device finally settles", async () => {
    // First reply is generating: the open thread shows an optimistic bubble.
    const h = makeHarness([userMsg, thinkingBubble]);
    const loadSessions = vi.fn();
    const pendingRemoteSyncRef = { current: false };
    const runSync = () =>
      syncActiveMessages({
        sessionId: SESSION_ID,
        activeSessionRef: h.activeSessionRef,
        setActiveSession: h.setActiveSession,
      });

    // 1) A remote change fires while the reply is generating → deferred.
    syncFromRemote({
      isLoading: true,
      loadSessions,
      pendingRemoteSyncRef,
      runSync,
    });
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(pendingRemoteSyncRef.current).toBe(true);
    expect(h.session.messages).toContain(thinkingBubble);

    // 2) The first reply settles (generation replaces the bubble with the real
    //    reply). The settle effect fires, but its fetch is left in flight.
    h.session = {
      id: SESSION_ID,
      messages: [userMsg, { role: "assistant", content: "first reply" }],
    };
    const fetch1 = deferred();
    base44.messages.list.mockReturnValueOnce(fetch1.promise);
    const cleanup1 = settleDeferredSync({
      isLoading: false,
      pendingRemoteSyncRef,
      runSync,
    });
    expect(base44.messages.list).toHaveBeenCalledTimes(1);
    expect(pendingRemoteSyncRef.current).toBe(true); // not cleared yet

    // 3) A SECOND send starts before that catch-up resolves: a new optimistic
    //    bubble appears, isLoading flips true, and the effect cleanup runs.
    h.session = {
      id: SESSION_ID,
      messages: [
        userMsg,
        { role: "assistant", content: "first reply" },
        { role: "user", content: "again" },
        thinkingBubble,
      ],
    };
    cleanup1();

    // 4) The first catch-up's fetch now resolves (stale). It must NOT clobber
    //    the in-progress reply and must NOT clear the still-pending flag.
    fetch1.resolve(remoteMessages());
    await flush();
    expect(pendingRemoteSyncRef.current).toBe(true);
    expect(h.setActiveSession).not.toHaveBeenCalled();
    expect(h.session.messages).toContain(thinkingBubble);

    // 5) The second reply settles (bubble replaced). The settle effect fires
    //    again and now the deferred remote change is finally applied.
    h.session = {
      id: SESSION_ID,
      messages: [
        userMsg,
        { role: "assistant", content: "first reply" },
        { role: "user", content: "again" },
        { role: "assistant", content: "second reply" },
      ],
    };
    base44.messages.list.mockResolvedValueOnce(remoteMessages());
    settleDeferredSync({ isLoading: false, pendingRemoteSyncRef, runSync });
    await flush();

    expect(pendingRemoteSyncRef.current).toBe(false);
    expect(h.setActiveSession).toHaveBeenCalledTimes(1);
    expect(h.session.messages.map((m) => m.content)).toEqual([
      "hi",
      "remote reply",
    ]);
  });
});
