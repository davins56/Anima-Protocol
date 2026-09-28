import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatTurns, db, ensureSchemaOnce } from "@workspace/db";
import {
  beginChatTurn,
  checkpointGeneratedTurn,
  claimChatTurnLease,
  classifyChatTurnReuse,
  decideDurableTurnJoin,
  latestOpenChatTurn,
  markTurnCommitted,
  markTurnFailed,
  pendingTurnLeaseIsStale,
  readChatTurn,
  retryableChatTurns,
  STALE_PENDING_LEASE_MS,
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

  it("joins a live lease and claims an expired one for the same user text", () => {
    const pending = {
      status: "pending" as const,
      assistantContent: "",
      userContent: "hello",
      leaseExpiresAt: new Date(Date.now() + 30_000),
    };
    expect(decideDurableTurnJoin(pending, "hello")).toBe("join");
    expect(
      decideDurableTurnJoin(
        { ...pending, leaseExpiresAt: new Date(Date.now() - 1_000) },
        "hello",
      ),
    ).toBe("claim");
    expect(
      decideDurableTurnJoin(
        {
          status: "generated",
          assistantContent: "prior reply",
          userContent: "hello",
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
        "hello",
      ),
    ).toBe("replay");
    expect(decideDurableTurnJoin(pending, "different")).toBe("conflict");
  });

  it("claims a lease only while it is free or expired", async () => {
    const leaseTurn = `turn_${prefix}_lease`;
    await beginChatTurn({
      id: leaseTurn,
      sessionId,
      userId,
      userContent: "lease me",
      persistenceOwner: "server",
    });
    const start = new Date("2020-01-01T00:00:00.000Z");
    expect(await claimChatTurnLease(leaseTurn, userId, 1_000, start)).toBe(true);
    expect(
      await claimChatTurnLease(
        leaseTurn,
        userId,
        1_000,
        new Date(start.getTime() + 500),
      ),
    ).toBe(false);
    expect(
      await claimChatTurnLease(
        leaseTurn,
        userId,
        1_000,
        new Date(start.getTime() + 1_500),
      ),
    ).toBe(true);
  });

  it("skips client-owned turns and turns older than the last commit", async () => {
    const retrySession = `${sessionId}_retry`;
    const base = new Date("2021-06-01T00:00:00.000Z");
    const older = `turn_${prefix}_older`;
    const committed = `turn_${prefix}_committed`;
    const clientOwned = `turn_${prefix}_client`;
    const newer = `turn_${prefix}_newer`;
    const emptyFailed = `turn_${prefix}_empty`;
    const rows = [
      {
        id: older,
        createdAt: new Date(base.getTime()),
        status: "generated",
        persistenceOwner: "server",
        assistantContent: "stale",
        userContent: "old question",
      },
      {
        id: committed,
        createdAt: new Date(base.getTime() + 1_000),
        status: "committed",
        persistenceOwner: "server",
        assistantContent: "kept",
        userContent: "middle",
      },
      {
        id: clientOwned,
        createdAt: new Date(base.getTime() + 2_000),
        status: "generated",
        persistenceOwner: "client",
        assistantContent: "client reply",
        userContent: "client question",
      },
      {
        id: newer,
        createdAt: new Date(base.getTime() + 3_000),
        status: "generated",
        persistenceOwner: "server",
        assistantContent: "fresh",
        userContent: "new question",
      },
      {
        id: emptyFailed,
        createdAt: new Date(base.getTime() + 4_000),
        status: "failed",
        persistenceOwner: "server",
        assistantContent: "",
        userContent: "no reply",
      },
    ];
    for (const row of rows) {
      await db.insert(chatTurns).values({
        id: row.id,
        sessionId: retrySession,
        userId,
        userMessageId: `${row.id}:user`,
        assistantMessageId: `${row.id}:assistant`,
        persistenceOwner: row.persistenceOwner,
        status: row.status,
        userContent: row.userContent,
        assistantContent: row.assistantContent,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      });
    }
    const retryable = await retryableChatTurns(userId, retrySession, 10);
    expect(retryable.map((turn) => turn.id)).toEqual([newer]);
  });

  it("ignores a pending turn whose lease expired more than three minutes ago", async () => {
    const staleSession = `${sessionId}_stale`;
    const staleId = `turn_${prefix}_stale`;
    const freshId = `turn_${prefix}_fresh_lease`;
    await beginChatTurn({
      id: staleId,
      sessionId: staleSession,
      userId,
      userContent: "still there?",
      persistenceOwner: "server",
    });
    await beginChatTurn({
      id: freshId,
      sessionId: staleSession,
      userId,
      userContent: "hello again",
      persistenceOwner: "server",
    });
    const longAgo = new Date(Date.now() - STALE_PENDING_LEASE_MS - 5_000);
    const recentlyExpired = new Date(Date.now() - 30_000);
    await db
      .update(chatTurns)
      .set({ leaseExpiresAt: longAgo, status: "pending", createdAt: longAgo })
      .where(eq(chatTurns.id, staleId));
    await db
      .update(chatTurns)
      .set({ leaseExpiresAt: recentlyExpired, status: "pending" })
      .where(eq(chatTurns.id, freshId));

    expect(pendingTurnLeaseIsStale({ status: "pending", leaseExpiresAt: longAgo })).toBe(true);
    expect(
      pendingTurnLeaseIsStale({ status: "pending", leaseExpiresAt: recentlyExpired }),
    ).toBe(false);
    expect(
      pendingTurnLeaseIsStale({ status: "generated", leaseExpiresAt: longAgo }),
    ).toBe(false);

    const open = await latestOpenChatTurn(userId, staleSession);
    expect(open?.id).toBe(freshId);
    expect(await readChatTurn(staleId, userId)).toMatchObject({
      status: "failed",
      lastError: "Companion turn lease expired",
    });
  });
});
