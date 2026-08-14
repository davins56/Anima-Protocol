import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatTurns, db, ensureSchemaOnce } from "@workspace/db";
import {
  beginChatTurn,
  checkpointGeneratedTurn,
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
});
