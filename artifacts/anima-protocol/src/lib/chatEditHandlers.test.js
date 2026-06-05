import { describe, it, expect, beforeEach, vi } from "vitest";

// The page handler persists changes through base44. Back it with a simple
// in-memory store so the edit flow can be tested without a server or auth
// token. update() acts as an upsert, mirroring the real client.
vi.mock("@/api/base44Client", () => {
  const stores = new Map();
  let counter = 0;
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const entity = (name) => ({
    async create(data) {
      const id = data?.id || `id-${++counter}`;
      const rec = { ...data, id };
      store(name).set(id, rec);
      return { ...rec };
    },
    async get(id) {
      const rec = store(name).get(id);
      return rec ? { ...rec } : null;
    },
    async update(id, data) {
      const existing = store(name).get(id) || { id };
      const rec = { ...existing, ...data, id };
      store(name).set(id, rec);
      return { ...rec };
    },
    async delete(id) {
      store(name).delete(id);
    },
    async list() {
      return [...store(name).values()].map((r) => ({ ...r }));
    },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(name) });
  return { base44: { entities }, default: { entities } };
});

import { base44 } from "@/api/base44Client";
import { editMessageFlow } from "@/lib/chatEditHandlers";

// A short conversation reused across tests:
//   0 user, 1 assistant, 2 user, 3 assistant, 4 user
function sampleMessages() {
  return [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
    { role: "user", content: "tell me a story" },
    { role: "assistant", content: "once upon a time" },
    { role: "user", content: "go on" },
  ];
}

async function makeSession(messages = sampleMessages()) {
  return base44.entities.ChatSession.create({ title: "Story", messages });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editMessageFlow (rewrite a single message in place)", () => {
  it("does nothing when there is no active session", async () => {
    const setActiveSession = vi.fn();

    await editMessageFlow(2, "edited", { activeSession: null, setActiveSession });

    expect(setActiveSession).not.toHaveBeenCalled();
  });

  it("replaces only the message at the given index and leaves the rest untouched", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();

    await editMessageFlow(2, "tell me a different story", {
      activeSession: session,
      setActiveSession,
    });

    // The store reflects the edit at index 2 only; every other message and its
    // role are unchanged.
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "tell me a different story" },
      { role: "assistant", content: "once upon a time" },
      { role: "user", content: "go on" },
    ]);
    // The message count is preserved (no messages dropped or added).
    expect(stored.messages).toHaveLength(5);
  });

  it("reflects the change in the page view", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();

    await editMessageFlow(3, "the end", {
      activeSession: session,
      setActiveSession,
    });

    expect(setActiveSession).toHaveBeenCalledTimes(1);
    const updater = setActiveSession.mock.calls[0][0];
    const next = updater({ ...session });
    expect(next.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
      "the end",
      "go on",
    ]);
  });

  it("does not mutate the original session's messages array", async () => {
    const original = sampleMessages();
    const session = await makeSession(original);
    const setActiveSession = vi.fn();

    await editMessageFlow(0, "HELLO", {
      activeSession: session,
      setActiveSession,
    });

    // The array passed in as activeSession.messages is not mutated in place.
    expect(session.messages[0].content).toBe("hello");
    expect(original[0].content).toBe("hello");
  });

  it("is a no-op edit when the index is out of range", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();

    await editMessageFlow(99, "nowhere", {
      activeSession: session,
      setActiveSession,
    });

    // Nothing in range to change, so all messages remain exactly as before.
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((m) => m.content)).toEqual(
      sampleMessages().map((m) => m.content)
    );
  });
});
