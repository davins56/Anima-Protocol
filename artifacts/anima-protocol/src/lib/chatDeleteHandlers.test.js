import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture toast calls so the tests can assert that an "Undo" affordance was
// shown (and reach into its handler the same way a user tapping it would).
vi.mock("sonner", () => {
  const toast = vi.fn();
  toast.success = vi.fn();
  toast.error = vi.fn();
  return { toast };
});

// The page handlers talk to animaClient through the undo helpers. Back animaClient with a
// simple in-memory store so the confirm/navigate flow can be tested without a
// server or auth token. update() acts as an upsert, mirroring the real client.
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
  // Per-message rows, like the real /store/messages endpoints.
  const messages = {
    remove: vi.fn(),
    restore: vi.fn(),
    list: vi.fn(),
  };
  return { animaClient: { entities, messages }, default: { entities, messages } };
});

import { toast } from "sonner";
import { animaClient } from "@/api/animaClient";
import { deleteSessionFlow, deleteMessageFlow } from "@/lib/chatDeleteHandlers";

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
  toast.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("deleteSessionFlow (confirm-and-delete a chat session)", () => {
  it("does nothing when the user cancels the confirm dialog", async () => {
    const session = await animaClient.entities.ChatSession.create({ title: "Keep me" });
    const confirm = vi.fn().mockResolvedValue(false);
    const navigate = vi.fn();
    const loadSessions = vi.fn();

    await deleteSessionFlow(session.id, {
      confirm,
      sessions: [session],
      sessionId: session.id,
      navigate,
      loadSessions,
    });

    // Confirm was asked, but nothing else happened.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(loadSessions).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(await animaClient.entities.ChatSession.get(session.id)).not.toBeNull();
  });

  it("deletes the session and shows an undo toast when confirmed", async () => {
    const session = await animaClient.entities.ChatSession.create({ title: "Doomed" });
    const confirm = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();
    const loadSessions = vi.fn();

    await deleteSessionFlow(session.id, {
      confirm,
      sessions: [session],
      sessionId: "some-other-session",
      navigate,
      loadSessions,
    });

    // The record is gone, the page refresh ran, and an Undo affordance showed.
    expect(await animaClient.entities.ChatSession.get(session.id)).toBeNull();
    expect(loadSessions).toHaveBeenCalled();
    const opts = toast.mock.calls[toast.mock.calls.length - 1][1];
    expect(opts.action.label).toBe("Undo");

    // And undo restores the session intact.
    await lastUndoAction()();
    const restored = await animaClient.entities.ChatSession.get(session.id);
    expect(restored).not.toBeNull();
    expect(restored.title).toBe("Doomed");
  });

  it("navigates away only when the deleted session is the active one", async () => {
    // Active session deleted -> navigate("/") happens.
    const active = await animaClient.entities.ChatSession.create({ title: "Active" });
    const navigateActive = vi.fn();
    await deleteSessionFlow(active.id, {
      confirm: vi.fn().mockResolvedValue(true),
      sessions: [active],
      sessionId: active.id,
      navigate: navigateActive,
      loadSessions: vi.fn(),
    });
    expect(navigateActive).toHaveBeenCalledWith("/");

    // A non-active session deleted -> no navigation.
    const other = await animaClient.entities.ChatSession.create({ title: "Other" });
    const navigateOther = vi.fn();
    await deleteSessionFlow(other.id, {
      confirm: vi.fn().mockResolvedValue(true),
      sessions: [other],
      sessionId: "currently-open-session",
      navigate: navigateOther,
      loadSessions: vi.fn(),
    });
    expect(navigateOther).not.toHaveBeenCalled();
  });
});

// A tiny stand-in for React's setState so tests can read the page view.
function viewOf(session) {
  let state = session;
  const setActiveSession = vi.fn((next) => {
    state = typeof next === "function" ? next(state) : next;
  });
  return { setActiveSession, view: () => state };
}

const longSession = () => ({
  id: "s1",
  messages: [
    { id: "m1", seq: 0, role: "user", content: "first", turn_id: "t1" },
    { id: "m2", seq: 1, role: "assistant", content: "second", turn_id: "t1" },
    { id: "m3", seq: 2, role: "user", content: "third", turn_id: "t2" },
  ],
});

describe("deleteMessageFlow (delete one message in the active session)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animaClient.messages.remove.mockResolvedValue({ deleted: true, id: "m2", seq: 1 });
    animaClient.messages.restore.mockImplementation(async (_s, m) => ({ ...m }));
    animaClient.messages.list.mockResolvedValue([]);
  });

  it("does nothing when there is no active session", async () => {
    const setActiveSession = vi.fn();

    await deleteMessageFlow(0, { activeSession: null, setActiveSession });

    expect(setActiveSession).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("deletes ONE row by id (never rewrites the history) and drops the bubble", async () => {
    const session = longSession();
    const { setActiveSession, view } = viewOf(session);

    await deleteMessageFlow(1, { activeSession: session, setActiveSession });

    expect(animaClient.messages.remove).toHaveBeenCalledWith("s1", "m2");
    expect(view().messages.map((m) => m.id)).toEqual(["m1", "m3"]);
    const opts = toast.mock.calls[toast.mock.calls.length - 1][1];
    expect(opts.action.label).toBe("Undo");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("removes the bubble before the server answers", async () => {
    const session = longSession();
    const { setActiveSession, view } = viewOf(session);
    let finish;
    animaClient.messages.remove.mockReturnValue(new Promise((r) => { finish = r; }));

    const pending = deleteMessageFlow(0, { activeSession: session, setActiveSession });
    expect(view().messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    finish({ deleted: true, id: "m1", seq: 0 });
    await pending;
  });

  it("puts the bubble back and says so when the delete fails", async () => {
    const session = longSession();
    const { setActiveSession, view } = viewOf(session);
    animaClient.messages.remove.mockRejectedValue(new Error("Request timed out"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteMessageFlow(1, { activeSession: session, setActiveSession });

    expect(view().messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(toast.error).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("deletes the message the user tapped even when older pages are not loaded", async () => {
    // The page holds only the newest rows; the index is into what is shown.
    const session = { id: "s1", messages: [
      { id: "m501", seq: 500, role: "user", content: "a" },
      { id: "m502", seq: 501, role: "assistant", content: "b" },
    ] };
    const { setActiveSession } = viewOf(session);

    await deleteMessageFlow(1, { activeSession: session, setActiveSession });

    expect(animaClient.messages.remove).toHaveBeenCalledWith("s1", "m502");
  });

  it("Undo restores the stored row in seq order", async () => {
    const session = longSession();
    const { setActiveSession, view } = viewOf(session);

    await deleteMessageFlow(1, { activeSession: session, setActiveSession });
    await lastUndoAction()();

    expect(animaClient.messages.restore).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ id: "m2", seq: 1 }),
    );
    expect(view().messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("falls back to the stored row for the same turn when the bubble id is client-only", async () => {
    const session = { id: "s1", messages: [
      { id: "local-1", role: "assistant", content: "hello", turn_id: "t9" },
    ] };
    const { setActiveSession, view } = viewOf(session);
    animaClient.messages.remove
      .mockResolvedValueOnce({ deleted: false, missing: true, id: "local-1" })
      .mockResolvedValueOnce({ deleted: true, id: "srv-1", seq: 7 });
    animaClient.messages.list.mockResolvedValue([
      { id: "srv-0", role: "user", content: "hi", turn_id: "t9", seq: 6 },
      { id: "srv-1", role: "assistant", content: "hello", turn_id: "t9", seq: 7 },
    ]);

    await deleteMessageFlow(0, { activeSession: session, setActiveSession });

    expect(animaClient.messages.remove).toHaveBeenLastCalledWith("s1", "srv-1");
    expect(view().messages).toEqual([]);
  });

  it("a bubble that was never saved is only removed from the view", async () => {
    const session = { id: "s1", messages: [{ role: "assistant", content: "typing" }] };
    const { setActiveSession, view } = viewOf(session);

    await deleteMessageFlow(0, { activeSession: session, setActiveSession });

    expect(animaClient.messages.remove).not.toHaveBeenCalled();
    expect(view().messages).toEqual([]);
  });

  it("leaves another session's view alone if the user switched chats", async () => {
    const session = longSession();
    const other = { id: "s2", messages: [{ id: "x", role: "user", content: "x" }] };
    const { setActiveSession, view } = viewOf(other);

    await deleteMessageFlow(0, { activeSession: session, setActiveSession });

    expect(view()).toBe(other);
  });
});
