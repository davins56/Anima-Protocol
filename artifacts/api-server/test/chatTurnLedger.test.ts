import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatTurns, db, ensureSchemaOnce } from "@workspace/db";
import {
  beginChatTurn,
  checkpointGeneratedTurn,
  classifyChatTurnReuse,
  markTurnCommitted,
  markTurnFailed,
  readChatTurn,
  turnMessageIds,
} from "../src/lib/chatTurnLedger";

const prefix = `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${prefix}_user`;
const sessionId = `${prefix}_session`;
const turnId = `turn_${prefix}`;

beforeAll(async () => {
  await ensureSchemaOnce();
});

afterAll(async () => {
  await db.delete(chatTurns).where(eq(chatTurns.userId, userId));
});

describe("chat turn ledger", () => {
  it("uses stable message ids and idempotently reopens a known turn", async () => {
    const ids = turnMessageIds(turnId);
    expect(ids).toEqual({
      userMessageId: `${turnId}:user`,
      assistantMessageId: `${turnId}:assistant`,
    });

    const first = await beginChatTurn({
      id: turnId,
      sessionId,
      userId,
      userContent: "hello",
      persistenceOwner: "server",
    });
    const second = await beginChatTurn({
      id: turnId,
      sessionId,
      userId,
      userContent: "hello",
      persistenceOwner: "server",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.turn.id).toBe(turnId);
  });

  it("checkpoints generated content and tracks retries through commit", async () => {
    await checkpointGeneratedTurn({
      id: turnId,
      userId,
      assistantContent: "durable reply",
      metadata: { provider: "test" },
    });
    expect(await readChatTurn(turnId, userId)).toMatchObject({
      status: "generated",
      assistantContent: "durable reply",
    });

    await markTurnFailed(turnId, userId, new Error("temporary"));
    expect(await readChatTurn(turnId, userId)).toMatchObject({
      status: "failed",
      retryCount: 1,
      lastError: "temporary",
    });

    await markTurnCommitted(turnId, userId);
    expect(await readChatTurn(turnId, userId)).toMatchObject({
      status: "committed",
      lastError: null,
    });
  });

  it("replays only when userContent matches a generated or committed turn", () => {
    const generated = {
      status: "generated" as const,
      assistantContent: "prior reply",
      userContent: "hello",
    };
    expect(classifyChatTurnReuse(generated, "hello")).toBe("replay");
    expect(classifyChatTurnReuse(generated, "a different line")).toBe("conflict");
    expect(
      classifyChatTurnReuse(
        { status: "committed", assistantContent: "prior reply", userContent: "hello" },
        "hello",
      ),
    ).toBe("replay");
    expect(
      classifyChatTurnReuse(
        { status: "pending", assistantContent: null, userContent: "hello" },
        "hello",
      ),
    ).toBe("in_flight");
    expect(
      classifyChatTurnReuse(
        { status: "pending", assistantContent: null, userContent: "hello" },
        "second thought",
      ),
    ).toBe("conflict");
  });
});
