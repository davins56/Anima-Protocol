import { describe, it, expect, beforeEach, vi } from "vitest";

// The page handlers persist changes through base44. Back it with a simple
// in-memory store so the confirm/trim flow can be tested without a server or
// auth token. update() acts as an upsert, mirroring the real client.
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
import { rewindToMessageFlow, regenerateMessageFlow } from "@/lib/chatRewindHandlers";

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

describe("rewindToMessageFlow (confirm-and-trim to a chosen message)", () => {
  it("does nothing when there is no active session", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();

    await rewindToMessageFlow(2, { confirm, activeSession: null, setActiveSession });

    expect(confirm).not.toHaveBeenCalled();
    expect(setActiveSession).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels the confirm dialog", async () => {
    const session = await makeSession();
    const confirm = vi.fn().mockResolvedValue(false);
    const setActiveSession = vi.fn();

    await rewindToMessageFlow(2, { confirm, activeSession: session, setActiveSession });

    // Confirm was asked, but nothing was changed.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setActiveSession).not.toHaveBeenCalled();
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((m) => m.content)).toEqual(
      sampleMessages().map((m) => m.content)
    );
  });

  it("trims messages to the chosen index (inclusive) when confirmed", async () => {
    const session = await makeSession();
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();

    await rewindToMessageFlow(2, { confirm, activeSession: session, setActiveSession });

    // Index 2 is kept; everything after it is removed, in the store...
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
    ]);
    // ...the last_message preview reflects the new tail...
    expect(stored.last_message).toBe("tell me a story");
    // ...and the page view was updated to match.
    expect(setActiveSession).toHaveBeenCalledTimes(1);
    const updater = setActiveSession.mock.calls[0][0];
    const next = updater({ ...session });
    expect(next.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
    ]);
    expect(next.last_message).toBe("tell me a story");
  });
});

describe("regenerateMessageFlow (confirm-and-rewrite a reply)", () => {
  it("does nothing when there is no active session", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();

    await regenerateMessageFlow(3, {
      confirm,
      activeSession: null,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(setActiveSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does nothing when a request is already in flight", async () => {
    const session = await makeSession();
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();

    await regenerateMessageFlow(3, {
      confirm,
      activeSession: session,
      isLoading: true,
      setActiveSession,
      sendMessage,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(setActiveSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toHaveLength(5);
  });

  it("does nothing when the user cancels the confirm dialog", async () => {
    const session = await makeSession();
    const confirm = vi.fn().mockResolvedValue(false);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();

    await regenerateMessageFlow(3, {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setActiveSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toHaveLength(5);
  });

  it("discards the reply and everything after it, then re-sends the last user message", async () => {
    const session = await makeSession();
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    // Regenerate the assistant reply at index 3.
    await regenerateMessageFlow(3, {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    // The store keeps only the messages before index 3...
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
    ]);
    // ...the page view was updated to match...
    expect(setActiveSession).toHaveBeenCalledTimes(1);
    const next = setActiveSession.mock.calls[0][0]({ ...session });
    expect(next.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
    ]);
    // ...and the most recent preceding user message was sent again.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("tell me a story");
  });

  it("trims without re-sending when there is no preceding user message", async () => {
    // A session that opens with an assistant (narrator) message and no user turn.
    const session = await makeSession([
      { role: "assistant", content: "The stage is set." },
      { role: "assistant", content: "A second narration." },
    ]);
    const confirm = vi.fn().mockResolvedValue(true);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();

    await regenerateMessageFlow(1, {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((m) => m.content)).toEqual(["The stage is set."]);
    expect(setActiveSession).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
