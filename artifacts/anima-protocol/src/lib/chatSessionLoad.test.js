import { describe, it, expect, vi } from "vitest";
import { loadOpenChatSession } from "./chatSessionLoad";

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
