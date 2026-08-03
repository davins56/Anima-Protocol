import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture toast calls so the tests can assert that an "Undo" affordance was
// shown (and reach into its handler the same way a user tapping it would).
vi.mock("sonner", () => {
  const toast = vi.fn();
  toast.success = vi.fn();
  toast.error = vi.fn();
  return { toast };
});

// The page handlers talk to base44 through the undo helpers. Back base44 with a
// simple in-memory store so the confirm/navigate flow can be tested without a
// server or auth token. update() acts as an upsert, mirroring the real client.
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

import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
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
    const session = await base44.entities.ChatSession.create({ title: "Keep me" });
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
    expect(await base44.entities.ChatSession.get(session.id)).not.toBeNull();
  });

  it("deletes the session and shows an undo toast when confirmed", async () => {
    const session = await base44.entities.ChatSession.create({ title: "Doomed" });
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
    expect(await base44.entities.ChatSession.get(session.id)).toBeNull();
    expect(loadSessions).toHaveBeenCalled();
    const opts = toast.mock.calls[toast.mock.calls.length - 1][1];
    expect(opts.action.label).toBe("Undo");

    // And undo restores the session intact.
    await lastUndoAction()();
    const restored = await base44.entities.ChatSession.get(session.id);
    expect(restored).not.toBeNull();
    expect(restored.title).toBe("Doomed");
  });

  it("navigates away only when the deleted session is the active one", async () => {
    // Active session deleted -> navigate("/") happens.
    const active = await base44.entities.ChatSession.create({ title: "Active" });
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
    const other = await base44.entities.ChatSession.create({ title: "Other" });
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

describe("deleteMessageFlow (delete one message in the active session)", () => {
  it("does nothing when there is no active session", async () => {
    const setActiveSession = vi.fn();

    await deleteMessageFlow(0, { activeSession: null, setActiveSession });

    expect(setActiveSession).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("deletes the message and reflects it in the active session view", async () => {
    const session = await base44.entities.ChatSession.create({
      title: "Session",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    });
    const setActiveSession = vi.fn();

    await deleteMessageFlow(1, { activeSession: session, setActiveSession });

    // The message is gone from the store...
    const current = await base44.entities.ChatSession.get(session.id);
    expect(current.messages.map((m) => m.content)).toEqual(["first", "third"]);
    // ...the page view was updated, and an Undo affordance showed.
    expect(setActiveSession).toHaveBeenCalled();
    const opts = toast.mock.calls[toast.mock.calls.length - 1][1];
    expect(opts.action.label).toBe("Undo");
  });
});
