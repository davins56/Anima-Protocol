import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/animaClient", () => ({ animaClient: {} }));

import {
  MAX_REACTIONS_PER_MESSAGE,
  canReactTo,
  reactToMessageFlow,
  reactionsEnabled,
  toggleReaction,
  userReactions,
  withReactions,
} from "./chatReactions";

const reply = (over = {}) => ({ id: "m2", role: "assistant", content: "Hi there", character_name: "Lyra", ...over });

function fakeClient(rows, { failUpdate = false } = {}) {
  const stored = { id: "s1", messages: rows.map((r) => ({ ...r })) };
  return {
    stored,
    entities: {
      ChatSession: {
        get: vi.fn(async () => ({ ...stored, messages: stored.messages.map((r) => ({ ...r })) })),
        update: vi.fn(async (_id, data) => {
          if (failUpdate) throw new Error("boom");
          stored.messages = data.messages;
          return { ...stored };
        }),
      },
    },
  };
}

function sessionState(initial) {
  let state = initial;
  const setActiveSession = (fn) => {
    state = typeof fn === "function" ? fn(state) : fn;
  };
  return { get: () => state, setActiveSession };
}

describe("chatReactions", () => {
  it("is off unless the flag says on", () => {
    expect(reactionsEnabled({})).toBe(false);
    expect(reactionsEnabled({ VITE_ANIMA_REACTIONS: "0" })).toBe(false);
    expect(reactionsEnabled({ VITE_ANIMA_REACTIONS: "1" })).toBe(true);
    expect(reactionsEnabled({ VITE_ANIMA_REACTIONS: "on" })).toBe(true);
  });

  it("only lets the user react to her settled, stored replies", () => {
    expect(canReactTo(reply())).toBe(true);
    expect(canReactTo(reply({ role: "user" }))).toBe(false);
    expect(canReactTo(reply({ id: undefined }))).toBe(false);
    expect(canReactTo(reply({ character_name: "__typing__" }))).toBe(false);
    expect(canReactTo(reply({ character_name: "__thinking__" }))).toBe(false);
    expect(canReactTo(reply({ is_streaming: true }))).toBe(false);
    expect(canReactTo(reply({ content: "..." }))).toBe(false);
    expect(canReactTo(reply({ type: "ai_notice" }))).toBe(false);
  });

  it("cleans stored reactions to the palette, without repeats, capped", () => {
    expect(userReactions(reply({ user_reactions: ["❤️", "💀", "❤️", "🔥", "😂", "😮"] }))).toEqual(["❤️", "🔥", "😂"]);
    expect(userReactions(reply({ user_reactions: "❤️" }))).toEqual([]);
  });

  it("toggles on and off and drops the oldest past the cap", () => {
    expect(toggleReaction([], "❤️")).toEqual(["❤️"]);
    expect(toggleReaction(["❤️"], "❤️")).toEqual([]);
    expect(toggleReaction(["❤️"], "💀")).toEqual(["❤️"]);
    const full = ["❤️", "😂", "😮"];
    expect(full).toHaveLength(MAX_REACTIONS_PER_MESSAGE);
    expect(toggleReaction(full, "🔥")).toEqual(["😂", "😮", "🔥"]);
  });

  it("sets reactions by id and removes the field when empty", () => {
    const rows = [{ id: "m1", role: "user", content: "hey" }, reply({ user_reactions: ["❤️"] })];
    const added = withReactions(rows, "m2", ["❤️", "🔥"]);
    expect(added.messages[1].user_reactions).toEqual(["❤️", "🔥"]);
    expect(added.messages[0]).toBe(rows[0]);
    const cleared = withReactions(rows, "m2", []);
    expect("user_reactions" in cleared.messages[1]).toBe(false);
    expect(withReactions(rows, "m2", ["❤️"]).messages).toBe(rows);
    expect(withReactions(rows, "nope", ["❤️"]).found).toBe(false);
  });

  it("paints at once and saves on the fresh copy with keep_arrivals", async () => {
    const rows = [{ id: "m1", role: "user", content: "hey" }, reply()];
    const client = fakeClient([...rows, { id: "m3", role: "assistant", content: "newer", character_name: "Lyra" }]);
    const ui = sessionState({ id: "s1", messages: rows });
    const result = await reactToMessageFlow("m2", "❤️", { activeSession: ui.get(), isLoading: () => false, setActiveSession: ui.setActiveSession, client });
    expect(result).toEqual({ ok: true, reactions: ["❤️"] });
    expect(ui.get().messages[1].user_reactions).toEqual(["❤️"]);
    const [, body] = client.entities.ChatSession.update.mock.calls[0];
    expect(body.keep_arrivals).toBe(true);
    expect(body.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(client.stored.messages[1].user_reactions).toEqual(["❤️"]);
  });

  it("puts the paint back when the save fails", async () => {
    const rows = [reply({ user_reactions: ["😂"] })];
    const client = fakeClient(rows, { failUpdate: true });
    const ui = sessionState({ id: "s1", messages: rows });
    const result = await reactToMessageFlow("m2", "❤️", { activeSession: ui.get(), isLoading: false, setActiveSession: ui.setActiveSession, client });
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(ui.get().messages[0].user_reactions).toEqual(["😂"]);
  });

  it("does nothing while a reply is in flight or for unknown emoji", async () => {
    const rows = [reply()];
    const client = fakeClient(rows);
    const ui = sessionState({ id: "s1", messages: rows });
    expect(await reactToMessageFlow("m2", "❤️", { activeSession: ui.get(), isLoading: () => true, setActiveSession: ui.setActiveSession, client })).toEqual({ ok: false, reason: "busy" });
    expect(await reactToMessageFlow("m2", "💀", { activeSession: ui.get(), isLoading: false, setActiveSession: ui.setActiveSession, client })).toEqual({ ok: false, reason: "invalid" });
    expect(client.entities.ChatSession.get).not.toHaveBeenCalled();
    expect(ui.get().messages[0].user_reactions).toBeUndefined();
  });

  it("reverts when the row is gone on the server", async () => {
    const rows = [reply()];
    const client = fakeClient([]);
    const ui = sessionState({ id: "s1", messages: rows });
    const result = await reactToMessageFlow("m2", "❤️", { activeSession: ui.get(), isLoading: false, setActiveSession: ui.setActiveSession, client });
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(ui.get().messages[0].user_reactions).toBeUndefined();
    expect(client.entities.ChatSession.update).not.toHaveBeenCalled();
  });
});
