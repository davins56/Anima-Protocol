import { describe, expect, it } from "vitest";
import { optionalChatContext } from "../src/lib/optionalChatContext";

describe("optionalChatContext", () => {
  it("returns the successful value", async () => {
    await expect(
      optionalChatContext("memories", async () => ["a"], []),
    ).resolves.toEqual(["a"]);
  });

  it("returns the fallback when a Hyperdrive / Worker I/O error is thrown", async () => {
    const fallback = [null, null, null] as const;
    await expect(
      optionalChatContext(
        "hinted_state",
        async () => {
          throw new Error(
            "Cannot perform I/O on behalf of a different request",
          );
        },
        fallback,
      ),
    ).resolves.toBe(fallback);
  });

  it("returns the fallback for a drizzle Failed query wrapper", async () => {
    await expect(
      optionalChatContext(
        "recent_messages",
        async () => {
          throw new Error("Failed query: select 1\nparams:");
        },
        [],
      ),
    ).resolves.toEqual([]);
  });
});
