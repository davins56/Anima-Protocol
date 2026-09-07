import { afterEach, describe, it, expect, vi } from "vitest";
import {
  beginOpenSession,
  loadOpenChatSession,
  rememberCreatedSession,
  resolveOpenSessionFetch,
  takeCreatedSession,
} from "./chatSessionLoad";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sessionA = { id: "A", title: "Alpha", mode: "solo" };
const sessionB = { id: "B", title: "Beta", mode: "solo" };
const messagesA = [{ id: "m-a", role: "user", content: "from A" }];
const messagesB = [{ id: "m-b", role: "user", content: "from B" }];
const primedSolo = { id: "sess-new", title: "T'Challa", mode: "solo", messages: [] };
const primedGroup = {
  id: "sess-group",
  title: "A, B",
  mode: "group",
  messages: [{ role: "assistant", character_name: "Narrator", content: "The stage is set." }],
};

describe("loadOpenChatSession", () => {
  it("returns the session plus its messages when the request is still current", async () => {
    const result = await loadOpenChatSession({
      id: "A",
      isCurrent: () => true,
      fetchSession: async () => [sessionA],
      fetchMessages: async () => messagesA,
    });

    expect(result).toEqual({
      status: "ready",
      session: { ...sessionA, messages: messagesA },
    });
  });

  it("treats literal undefined/null route ids as missing", async () => {
    expect(
      await loadOpenChatSession({
        id: "undefined",
        isCurrent: () => true,
        fetchSession: vi.fn(),
        fetchMessages: vi.fn(),
      }),
    ).toEqual({ status: "missing" });
  });

  it("retries fetchSession once when the first read misses a just-created id", async () => {
    const fetchSession = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sessionA]);

    const result = await loadOpenChatSession({
      id: "A",
      isCurrent: () => true,
      fetchSession,
      fetchMessages: async () => messagesA,
    });

    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ready");
    expect(result.session.id).toBe("A");
  });

  it("returns missing when the id is unknown", async () => {
    const result = await loadOpenChatSession({
      id: "gone",
      isCurrent: () => true,
      fetchSession: async () => [],
      fetchMessages: vi.fn(),
    });

    expect(result).toEqual({ status: "missing" });
  });

  it("returns error when the store throws, so the UI can leave the loader", async () => {
    const error = new Error("store timeout");
    const result = await loadOpenChatSession({
      id: "A",
      isCurrent: () => true,
      fetchSession: async () => {
        throw error;
      },
      fetchMessages: vi.fn(),
    });

    expect(result).toEqual({ status: "error", error });
  });

  it("ignores a slower first fetch when the user has already opened another thread", async () => {
    let currentId = "A";
    const fetchA = deferred();
    const fetchB = deferred();

    const first = loadOpenChatSession({
      id: "A",
      isCurrent: () => currentId === "A",
      fetchSession: () => fetchA.promise,
      fetchMessages: async () => messagesA,
    });
    currentId = "B";
    const second = loadOpenChatSession({
      id: "B",
      isCurrent: () => currentId === "B",
      fetchSession: () => fetchB.promise,
      fetchMessages: async () => messagesB,
    });

    fetchB.resolve([sessionB]);
    fetchA.resolve([sessionA]);

    const [stale, ready] = await Promise.all([first, second]);
    expect(stale).toEqual({ status: "stale" });
    expect(ready.status).toBe("ready");
    expect(ready.session.id).toBe("B");
    expect(ready.session.messages).toEqual(messagesB);
  });

  it("treats a message-list race the same way (metadata resolved, then navigation)", async () => {
    let currentId = "A";
    const messagesWait = deferred();

    const first = loadOpenChatSession({
      id: "A",
      isCurrent: () => currentId === "A",
      fetchSession: async () => [sessionA],
      fetchMessages: () => messagesWait.promise,
    });

    currentId = "B";
    messagesWait.resolve(messagesA);

    expect(await first).toEqual({ status: "stale" });
  });
});

describe("primed Init session across remount", () => {
  afterEach(() => {
    rememberCreatedSession(null);
  });

  it("beginOpenSession keeps a just-created id ready instead of spinning", () => {
    rememberCreatedSession(primedSolo);

    expect(beginOpenSession({ sessionId: primedSolo.id })).toEqual({
      status: "ready",
      primed: primedSolo,
    });
    expect(beginOpenSession({ sessionId: "other" }).status).toBe("loading");
  });

  it("rehydrates from location.state when Chat remounts without the ref", () => {
    rememberCreatedSession(null);

    const opened = beginOpenSession({
      sessionId: primedSolo.id,
      locationState: { primedSession: primedSolo },
    });

    expect(opened.status).toBe("ready");
    expect(opened.primed.id).toBe(primedSolo.id);
    expect(takeCreatedSession(primedSolo.id).title).toBe("T'Challa");
  });

  it("keeps the primed POST body when the follow-up GET is missing", () => {
    rememberCreatedSession(primedSolo);
    const next = resolveOpenSessionFetch({
      sessionId: primedSolo.id,
      result: { status: "missing" },
    });
    expect(next).toEqual({ status: "ready", keepPrimed: true });
  });

  it("keeps the primed POST body when the follow-up GET errors or times out", () => {
    rememberCreatedSession(primedSolo);
    const timeout = Object.assign(new Error("store timeout"), { code: "timeout" });
    expect(
      resolveOpenSessionFetch({
        sessionId: primedSolo.id,
        result: { status: "error", error: timeout },
      }),
    ).toEqual({ status: "ready", keepPrimed: true });
  });

  it("does not clobber opening narrator messages when GET returns an empty list", () => {
    rememberCreatedSession(primedGroup);
    const next = resolveOpenSessionFetch({
      sessionId: primedGroup.id,
      result: {
        status: "ready",
        session: { ...primedGroup, messages: [] },
      },
    });
    expect(next).toEqual({ status: "ready", keepPrimed: true });
    expect(takeCreatedSession(primedGroup.id).messages).toHaveLength(1);
  });

  it("still reports missing/error for a session the user did not just create", () => {
    rememberCreatedSession(null);
    expect(
      resolveOpenSessionFetch({
        sessionId: "gone",
        result: { status: "missing" },
      }),
    ).toEqual({ status: "missing" });

    const error = new Error("Couldn't open this conversation.");
    expect(
      resolveOpenSessionFetch({
        sessionId: "gone",
        result: { status: "error", error },
      }),
    ).toEqual({
      status: "error",
      message: "Couldn't open this conversation.",
    });
  });

  it("beginOpenSession still spins for a normal open of an unknown id", () => {
    rememberCreatedSession(null);
    expect(beginOpenSession({ sessionId: "unknown" })).toEqual({
      status: "loading",
      primed: null,
    });
  });
});
