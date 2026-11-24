import { describe, expect, it } from "vitest";
import { streamChatReply } from "./streamChatReply";

async function* frames(list) {
  for (const f of list) yield f;
}

describe("streamChatReply onTool (chat upgrade 4)", () => {
  const list = [
    { tool: { action_id: "a1", event: "started", seq: 1 } },
    { content: "Looking" },
    { tool: { action_id: "a1", event: "succeeded", seq: 2 } },
    { done: true, visible: "Looking it up [1]", tool_actions: ["a1"] },
  ];

  it("hands tool frames to the caller and keeps done.tool_actions", async () => {
    const seen = [];
    const result = await streamChatReply(frames(list), { onTool: (f) => seen.push(f) });
    expect(seen.map((f) => f.seq)).toEqual([1, 2]);
    expect(result.tool_actions).toEqual(["a1"]);
    expect(result.content).toBe("Looking it up [1]");
  });

  it("ignores tool frames without the hook, and a throwing hook never breaks the reply", async () => {
    expect((await streamChatReply(frames(list))).content).toBe("Looking it up [1]");
    const result = await streamChatReply(frames(list), {
      onTool: () => {
        throw new Error("ui");
      },
    });
    expect(result.content).toBe("Looking it up [1]");
  });
});
