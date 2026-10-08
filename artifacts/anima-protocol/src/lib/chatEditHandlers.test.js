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
      const next = { ...data };
      if (next.keep_arrivals && Array.isArray(next.messages)) {
        const ids = new Set(
          next.messages
            .map((message) => (message?.id ? String(message.id) : ""))
            .filter(Boolean),
        );
        const extras = (Array.isArray(existing.messages) ? existing.messages : []).filter(
          (message) => message?.id && !ids.has(String(message.id)),
        );
        if (extras.length > 0) next.messages = [...next.messages, ...extras];
        delete next.keep_arrivals;
      }
      const rec = { ...existing, ...next, id };
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

describe("editMessageFlow (rewrite his message and request a new reply)", () => {
  it("does nothing when there is no active session", async () => {
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();

    const result = await editMessageFlow(2, "edited", {
      activeSession: null,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("blocked");
    expect(setActiveSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("requests a new reply instead of rewriting the stored text in place", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await editMessageFlow(2, "tell me a different story", {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("sent");
    // Her reply and anything after his message are gone before the send.
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((message) => message.content)).toEqual(["hello", "hi there"]);
    expect(stored.messages.some((message) => message.content === "once upon a time")).toBe(false);
    // Exactly one send, marked so mood/memory are not counted again, and the
    // new wording is the only user line the send path should append.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const payload = sendMessage.mock.calls[0][0];
    expect(payload).toMatchObject({
      text: "tell me a different story",
      replyAction: "edit",
    });
    expect(payload.history.map((message) => message.content)).toEqual(["hello", "hi there"]);
    expect(typeof payload).not.toBe("string");
  });

  it("blocks an empty edit without sending or changing the thread", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await editMessageFlow(2, "   ", {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("empty");
    expect(confirm).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toHaveLength(5);
  });

  it("does nothing when the rewrite is cancelled", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);

    const result = await editMessageFlow(2, "a different story", {
      confirm,
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("cancelled");
    expect(sendMessage).not.toHaveBeenCalled();
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toHaveLength(5);
  });

  it("does not send while she is answering or a message is waiting", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await editMessageFlow(2, "a different story", {
      confirm,
      activeSession: session,
      isLoading: () => true,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("blocked");
    expect(confirm).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("truncates from an older user message, not only the latest one", async () => {
    const session = await makeSession();
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await editMessageFlow(0, "HELLO", {
      confirm: vi.fn().mockResolvedValue(true),
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "HELLO", replyAction: "edit", history: [] }),
    );
  });

  it("keeps a message that arrived after the snapshot when the send cannot start", async () => {
    const session = await makeSession([
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi there" },
    ]);
    const setActiveSession = vi.fn();
    const sendMessage = vi.fn().mockImplementation(async () => {
      const current = await base44.entities.ChatSession.get(session.id);
      await base44.entities.ChatSession.update(session.id, {
        messages: [
          ...(current.messages || []),
          { id: "fresh", role: "user", content: "from another device" },
        ],
      });
      return { started: false };
    });

    const result = await editMessageFlow(0, "HELLO", {
      confirm: vi.fn().mockResolvedValue(true),
      activeSession: session,
      isLoading: false,
      setActiveSession,
      sendMessage,
    });

    expect(result.status).toBe("not_started");
    const stored = await base44.entities.ChatSession.get(session.id);
    expect(stored.messages.map((message) => message.id)).toEqual(["u1", "a1", "fresh"]);
  });
});
