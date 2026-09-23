import { describe, expect, it, vi } from "vitest";

const CROSS_REQUEST =
  "Cannot perform I/O on behalf of a different request. I/O objects created in the context of one request handler cannot be accessed from a different request's handler.";

vi.mock("../src/db/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            throw new Error(CROSS_REQUEST);
          },
        }),
      }),
    }),
  },
}));

import { loadEvolution } from "../src/lib/evolutionEngine";
import { loadRelationshipState } from "../src/lib/relationshipEngine";
import { loadArcState } from "../src/lib/narrativeArcEngine";

describe("companion flavor loaders do not abort chat", () => {
  it("swallows Worker cross-request I/O instead of throwing Database unavailable", async () => {
    await expect(loadEvolution("char-1", "user-1")).resolves.toBeUndefined();
    await expect(loadRelationshipState("char-1", "user-1")).resolves.toBeNull();
    await expect(loadArcState("char-1", "user-1")).resolves.toBeNull();
  });
});
