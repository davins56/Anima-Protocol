import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const { createMock, setExtraction } = vi.hoisted(() => {
  let nextContent = "[]";
  return {
    setExtraction: (value: unknown) => {
      nextContent = typeof value === "string" ? value : JSON.stringify(value);
    },
    createMock: vi.fn(async () => ({
      content: typeof nextContent === "string" ? nextContent : JSON.stringify(nextContent),
    })),
  };
});

vi.mock("../src/lib/llmFailover", () => ({
  createChatCompletionWithFailover: createMock,
}));

import functionsRouter from "../src/routes/openai/functions";
import { db, userEntities } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

const PREFIX = `invtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/openai", functionsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  createMock.mockClear();
  setExtraction("[]");
});

async function invoke(
  userId: string | null,
  fnName: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/openai/invoke/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

async function listItems(userId: string, characterId?: string) {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, "Inventory"),
      ),
    );
  return rows
    .map((r) => r.data as Record<string, unknown>)
    .filter((item) => !characterId || item.character_id === characterId);
}

describe("updateInventory", () => {
  it("extracts and persists a new item so it survives a later read", async () => {
    const u = user("acquire_new");
    setExtraction([
      {
        action: "acquire",
        name: "Echo Shard",
        type: "artifact",
        quantity: 1,
        description: "A humming fragment of the net.",
        rarity: "rare",
      },
    ]);

    const res = await invoke(u, "updateInventory", {
      character_id: "char_a",
      session_id: "sess_1",
      user_message: "I pick up the glowing shard.",
      ai_response: "You pocket the Echo Shard.",
      existing_items: [],
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(1);
    expect(res.json.result.data.items_acquired).toBe(1);
    expect(res.json.result.data.created).toHaveLength(1);
    expect(res.json.result.data.created[0].name).toBe("Echo Shard");
    expect(res.json.result.data.created[0].source).toBe("narrative");

    const stored = await listItems(u, "char_a");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Echo Shard");
    expect(stored[0].type).toBe("artifact");
    expect(stored[0].quantity).toBe(1);
    expect(stored[0].session_id).toBe("sess_1");
  });

  it("increments quantity when the same item is acquired again", async () => {
    const u = user("acquire_stack");
    await db.insert(userEntities).values({
      userId: u,
      entityName: "Inventory",
      entityId: "existing_shard",
      data: {
        id: "existing_shard",
        character_id: "char_a",
        name: "Echo Shard",
        type: "artifact",
        quantity: 1,
        created_date: "2026-01-01T00:00:00.000Z",
      },
    });

    setExtraction([
      { action: "acquire", name: "echo  shard", type: "artifact", quantity: 2 },
    ]);

    const res = await invoke(u, "updateInventory", {
      character_id: "char_a",
      user_message: "Another shard!",
      ai_response: "You add two more Echo Shards to the pouch.",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(1);
    expect(res.json.result.data.created).toHaveLength(0);
    expect(res.json.result.data.updated[0].quantity).toBe(3);
    expect(await listItems(u, "char_a")).toHaveLength(1);
    expect((await listItems(u, "char_a"))[0].quantity).toBe(3);
  });

  it("does not invent items when the model returns nothing", async () => {
    const u = user("acquire_none");
    setExtraction("[]");
    const res = await invoke(u, "updateInventory", {
      character_id: "char_a",
      user_message: "hey",
      ai_response: "hey yourself",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(0);
    expect(res.json.result.data.items_acquired).toBe(0);
    expect(await listItems(u)).toHaveLength(0);
  });

  it("tolerates malformed model output without throwing", async () => {
    const u = user("acquire_garbage");
    setExtraction("not json at all");
    const res = await invoke(u, "updateInventory", {
      character_id: "char_a",
      user_message: "I found a sword.",
      ai_response: "Nice.",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(0);
    expect(await listItems(u)).toHaveLength(0);
  });

  it("scopes items to the requested character", async () => {
    const u = user("scope");
    await db.insert(userEntities).values({
      userId: u,
      entityName: "Inventory",
      entityId: "other",
      data: {
        id: "other",
        character_id: "char_b",
        name: "Borrowed Blade",
        type: "weapon",
        quantity: 1,
      },
    });

    setExtraction([
      { action: "acquire", name: "Lantern", type: "gear", quantity: 1 },
    ]);

    const res = await invoke(u, "updateInventory", {
      character_id: "char_a",
      user_message: "I take the lantern.",
      ai_response: "The lantern is yours.",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.inventory.map((i: any) => i.name)).toEqual([
      "Lantern",
    ]);
    expect(await listItems(u, "char_b")).toHaveLength(1);
  });

  it("returns empty without a model call when character_id is missing", async () => {
    const u = user("no_char");
    const res = await invoke(u, "updateInventory", {
      user_message: "I pick up a coin.",
      ai_response: "Ok.",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("applyNarrativeItemEvents", () => {
  it("accepts message_content and returns created + items_acquired", async () => {
    const u = user("narrative");
    setExtraction([
      {
        action: "acquire",
        name: "Rusty Key",
        type: "misc",
        quantity: 1,
        rarity: "common",
      },
    ]);

    const res = await invoke(u, "applyNarrativeItemEvents", {
      character_id: "char_a",
      session_id: "sess_9",
      message_content: "You notice a rusty key under the mat.",
      ai_response: "You take the rusty key.",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.created).toHaveLength(1);
    expect(res.json.result.data.items_acquired).toBe(1);
    expect(res.json.result.data.created[0].name).toBe("Rusty Key");
    expect(await listItems(u, "char_a")).toHaveLength(1);
  });
});

describe("processItemLoss", () => {
  it("decrements quantity and deletes the row when it hits zero", async () => {
    const u = user("loss");
    await db.insert(userEntities).values([
      {
        userId: u,
        entityName: "Inventory",
        entityId: "potion",
        data: {
          id: "potion",
          character_id: "char_a",
          name: "Health Potion",
          type: "consumable",
          quantity: 2,
        },
      },
    ]);

    const dec = await invoke(u, "processItemLoss", {
      character_id: "char_a",
      item_name: "health potion",
      quantity: 1,
      reason: "Story event",
    });
    expect(dec.status).toBe(200);
    expect(dec.json.result.data.updated[0].quantity).toBe(1);
    expect(createMock).not.toHaveBeenCalled();

    const gone = await invoke(u, "processItemLoss", {
      character_id: "char_a",
      item_name: "Health Potion",
      quantity: 1,
    });
    expect(gone.status).toBe(200);
    expect(gone.json.result.data.removed).toHaveLength(1);
    expect(await listItems(u, "char_a")).toHaveLength(0);
  });

  it("is a no-op when the named item is not in the bag", async () => {
    const u = user("loss_missing");
    const res = await invoke(u, "processItemLoss", {
      character_id: "char_a",
      item_name: "Phantom Cloak",
      quantity: 1,
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.applied).toBe(0);
  });
});

describe("inventory guards", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await invoke(null, "updateInventory", {
      character_id: "char_a",
      user_message: "hi",
      ai_response: "hi",
    });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
});
