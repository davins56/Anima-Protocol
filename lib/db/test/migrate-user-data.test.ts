import { describe, it, expect, vi } from "vitest";

let insertCalls = 0;
const insertedValues: any[] = [];
let sourceRowsMock: any[] = [];

vi.mock("../src/client", () => {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(sourceRowsMock),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    transaction: async (callback: any) => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve(),
        }),
        insert: () => {
          insertCalls++;
          return {
            values: (val: any) => {
              if (Array.isArray(val)) {
                insertedValues.push(...val);
              } else {
                insertedValues.push(val);
              }
              return {
                onConflictDoUpdate: () => Promise.resolve(),
              };
            },
          };
        },
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      };
      return callback(mockTx);
    },
  };

  return {
    db: mockDb,
  };
});

import { migrateUserData } from "../src/migrate-user-data";

describe("migrateUserData performance & correctness", () => {
  it("processes user entity inserts and tracks query calls", async () => {
    insertCalls = 0;
    insertedValues.length = 0;

    const numRows = 1200;
    sourceRowsMock = Array.from({ length: numRows }, (_, i) => ({
      id: i + 1,
      userId: "user_from",
      entityName: `Entity_${i % 5}`,
      entityId: `id_${i}`,
      data: {
        assigned_user: "old@example.com",
        index: i,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const result = await migrateUserData({
      fromEmail: "old@example.com",
      toEmail: "new@example.com",
      fromUserId: "user_from",
      toUserId: "user_to",
      dryRun: false,
    });

    expect(result.entitiesCopied).toBe(1200);
    expect(result.emailFieldsPatched).toBe(2400); // 1200 in copied rows + 1200 in targetEntities check
    expect(insertedValues.length).toBe(1200);

    // Verify first inserted record data
    expect(insertedValues[0]).toEqual({
      userId: "user_to",
      entityName: "Entity_0",
      entityId: "id_0",
      data: {
        assigned_user: "new@example.com",
        index: 0,
      },
    });

    console.log(`[Baseline Benchmark Metric] Total rows: ${numRows}, tx.insert calls: ${insertCalls}`);
  });
});
