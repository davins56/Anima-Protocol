import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ getPool: () => ({ query }) }));

import {
  findDerivedMemory,
  forgetDeletedMessage,
  MESSAGE_DELETED_REASON,
  unforgetDeletedMessage,
} from "../src/lib/mind/forgetMessage";

describe("what the mind forgets when a message is deleted", () => {
  beforeEach(() => query.mockReset());

  it("a deleted user message targets that turn's facts and summaries covering it", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "f1" }, { id: "s1" }] });
    const ids = await findDerivedMemory("u", "sess", { id: "m", role: "user", seq: 4, turnId: "t1" });
    expect(ids).toEqual(["f1", "s1"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("memory_events");
    expect(sql).toContain("through_seq");
    expect(params).toEqual(["u", "sess", "t1", "user_fact", 4, "session_summary"]);
  });

  it("a deleted companion reply keeps facts (no turn match), still retracts summaries", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findDerivedMemory("u", "sess", { id: "m", role: "assistant", seq: 5, turnId: "t1" });
    const params = query.mock.calls[0][1];
    expect(params[2]).toBeNull();
    expect(params[4]).toBe(5);
  });

  it("with no turn and no seq there is nothing to look up", async () => {
    expect(await findDerivedMemory("u", "s", { id: "m", role: "assistant" })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("appends one retraction per derived note, tagged with the message", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "f1" }, { id: "s1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "r1" }, { id: "r2" }] });
    const n = await forgetDeletedMessage({
      userId: "u",
      sessionId: "sess",
      message: { id: "m9", role: "user", seq: 2, turnId: "t" },
    });
    expect(n).toBe(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO memory_events/);
    expect(sql).toContain("'retraction'");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).not.toMatch(/\bDELETE\b|\bUPDATE\b/);
    expect(params).toEqual(["u", ["f1", "s1"], "m9", MESSAGE_DELETED_REASON]);
  });

  it("writes nothing when nothing was derived", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await forgetDeletedMessage({ userId: "u", sessionId: "s", message: { id: "m", seq: 1 } })).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("undo re-appends (append-only table) the notes this message's delete retracted", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "c1" }] });
    expect(await unforgetDeletedMessage("u", "m9")).toBe(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO memory_events/);
    expect(sql).not.toMatch(/\bDELETE\b|\bUPDATE\b/);
    expect(params).toEqual(["u", MESSAGE_DELETED_REASON, "m9"]);
  });
});
