import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture toast calls so the tests can reach into the "Undo" action and
// trigger it the same way a user tapping the toast button would.
vi.mock("sonner", () => {
  const toast = vi.fn();
  toast.success = vi.fn();
  toast.error = vi.fn();
  return { toast };
});

// The undo helpers talk to animaClient. Back it with a simple in-memory store so the
// delete/restore flow can be tested without a server or auth token (the real
// client gates every request on a Clerk token getter that never resolves under
// vitest, so it would otherwise hang). update() acts as an upsert, mirroring the
// real client's behaviour that restore relies on.
vi.mock("@/api/animaClient", () => {
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
  return {
    animaClient: { entities },
    default: { entities },
    __resetStore: () => {
      stores.clear();
      counter = 0;
    },
  };
});

import { toast } from "sonner";
import { animaClient, __resetStore } from "@/api/animaClient";
import {
  deleteWithUndo,
  deleteArrayItemWithUndo,
  deleteAllWithUndo,
} from "@/lib/undoableDelete";

// Pull the Undo handler out of the most recent toast(...) call.
function lastUndoAction() {
  const calls = toast.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const opts = calls[calls.length - 1][1];
  expect(opts).toBeTruthy();
  expect(opts.action).toBeTruthy();
  expect(typeof opts.action.onClick).toBe("function");
  return opts.action.onClick;
}

beforeEach(() => {
  __resetStore();
  localStorage.clear();
  toast.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("deleteArrayItemWithUndo (single chat message)", () => {
  it("restores a deleted message to its original position on undo", async () => {
    const session = await animaClient.entities.ChatSession.create({
      title: "Session",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    });

    await deleteArrayItemWithUndo({
      entity: "ChatSession",
      recordId: session.id,
      field: "messages",
      index: 1,
    });

    // The middle message is gone after delete.
    let current = await animaClient.entities.ChatSession.get(session.id);
    expect(current.messages.map((m) => m.content)).toEqual(["first", "third"]);

    // Undo brings it back at the same index.
    await lastUndoAction()();

    current = await animaClient.entities.ChatSession.get(session.id);
    expect(current.messages.map((m) => m.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(current.messages[1]).toEqual({ role: "assistant", content: "second" });
  });

  it("keeps the message deleted when undo is never triggered", async () => {
    const session = await animaClient.entities.ChatSession.create({
      title: "Session",
      messages: [
        { role: "user", content: "keep" },
        { role: "assistant", content: "remove" },
      ],
    });

    await deleteArrayItemWithUndo({
      entity: "ChatSession",
      recordId: session.id,
      field: "messages",
      index: 1,
    });

    // Grace window passes with no undo click — the message stays gone.
    const current = await animaClient.entities.ChatSession.get(session.id);
    expect(current.messages.map((m) => m.content)).toEqual(["keep"]);
  });

  it("restores to the right place even if other messages change during the grace window", async () => {
    const session = await animaClient.entities.ChatSession.create({
      title: "Session",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });

    await deleteArrayItemWithUndo({
      entity: "ChatSession",
      recordId: session.id,
      field: "messages",
      index: 2,
    });

    // Simulate the surrounding array shrinking before undo is clicked.
    await animaClient.entities.ChatSession.update(session.id, {
      messages: [{ role: "user", content: "a" }],
    });

    await lastUndoAction()();

    const current = await animaClient.entities.ChatSession.get(session.id);
    expect(current.messages.map((m) => m.content)).toEqual(["a", "c"]);
  });
});

describe("deleteWithUndo (whole chat session)", () => {
  it("restores a deleted session with its original id and fields on undo", async () => {
    const session = await animaClient.entities.ChatSession.create({
      title: "My session",
      last_message: "hello there",
      messages: [{ role: "user", content: "hi" }],
    });

    await deleteWithUndo({
      entity: "ChatSession",
      item: session,
      label: "Chat session",
    });

    // The session is gone after delete.
    expect(await animaClient.entities.ChatSession.get(session.id)).toBeNull();
    expect(await animaClient.entities.ChatSession.list()).toHaveLength(0);

    // Undo brings the whole record back intact.
    await lastUndoAction()();

    const restored = await animaClient.entities.ChatSession.get(session.id);
    expect(restored).not.toBeNull();
    expect(restored.id).toBe(session.id);
    expect(restored.title).toBe("My session");
    expect(restored.last_message).toBe("hello there");
    expect(restored.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("keeps the session deleted when undo is never triggered", async () => {
    const session = await animaClient.entities.ChatSession.create({
      title: "Doomed session",
    });

    await deleteWithUndo({
      entity: "ChatSession",
      item: session,
      label: "Chat session",
    });

    // Grace window passes with no undo click — the session stays gone.
    expect(await animaClient.entities.ChatSession.get(session.id)).toBeNull();
    expect(await animaClient.entities.ChatSession.list()).toHaveLength(0);
  });
});

describe("deleteAllWithUndo (bulk delete)", () => {
  it("restores every deleted record on undo", async () => {
    const a = await animaClient.entities.Character.create({ name: "Alpha" });
    const b = await animaClient.entities.Character.create({ name: "Beta" });

    await deleteAllWithUndo({
      entity: "Character",
      items: [a, b],
      label: "characters",
    });

    expect(await animaClient.entities.Character.list()).toHaveLength(0);

    await lastUndoAction()();

    const restored = await animaClient.entities.Character.list("name");
    expect(restored.map((c) => c.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(restored.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("keeps everything deleted when undo is never triggered", async () => {
    const a = await animaClient.entities.Character.create({ name: "Alpha" });
    const b = await animaClient.entities.Character.create({ name: "Beta" });

    await deleteAllWithUndo({
      entity: "Character",
      items: [a, b],
      label: "characters",
    });

    expect(await animaClient.entities.Character.list()).toHaveLength(0);
  });
});
