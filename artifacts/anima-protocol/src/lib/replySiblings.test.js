import { describe, it, expect } from "vitest";
import {
  replySiblingsEnabled,
  keepRetriedBranch,
  siblingPagerAt,
  switchToSibling,
  branchToSibling,
  MAX_SIBLINGS,
} from "@/lib/replySiblings";
import { planRetryReply } from "@/lib/chatReplyActions";

function convo() {
  return [
    { id: "t1:user", role: "user", content: "hi" },
    { id: "t1:assistant", role: "assistant", content: "hello", character_name: "Serenity" },
    { id: "t2:user", role: "user", content: "how are you" },
    { id: "t2:assistant", role: "assistant", content: "good", character_name: "Serenity" },
    { id: "t3:user", role: "user", content: "nice" },
    { id: "t3:assistant", role: "assistant", content: "yes", character_name: "Serenity" },
  ];
}

describe("replySiblingsEnabled", () => {
  it("is off by default and only on for explicit values", () => {
    expect(replySiblingsEnabled({})).toBe(false);
    expect(replySiblingsEnabled({ VITE_ANIMA_REPLY_SIBLINGS: "0" })).toBe(false);
    expect(replySiblingsEnabled({ VITE_ANIMA_REPLY_SIBLINGS: "off" })).toBe(false);
    expect(replySiblingsEnabled({ VITE_ANIMA_REPLY_SIBLINGS: "1" })).toBe(true);
    expect(replySiblingsEnabled({ VITE_ANIMA_REPLY_SIBLINGS: "on" })).toBe(true);
  });
});

describe("keepRetriedBranch", () => {
  it("archives the discarded reply and its tail on the parent user line", () => {
    const messages = convo();
    const plan = planRetryReply(messages, 3);
    const kept = keepRetriedBranch(messages, plan, { now: "2026-11-23T00:00:00Z", key: "k1" });
    expect(kept).toHaveLength(3);
    expect(kept[2].id).toBe("t2:user");
    expect(kept[2].reply_siblings).toEqual([
      {
        key: "k1",
        archived_at: "2026-11-23T00:00:00Z",
        messages: [
          { role: "assistant", content: "good", character_name: "Serenity", origin_id: "t2:assistant" },
          { role: "user", content: "nice", origin_id: "t3:user" },
          { role: "assistant", content: "yes", character_name: "Serenity", origin_id: "t3:assistant" },
        ],
      },
    ]);
    // The input list is not mutated.
    expect(messages[2].reply_siblings).toBeUndefined();
  });

  it("keeps at most MAX_SIBLINGS, dropping the oldest", () => {
    let messages = convo().slice(0, 2);
    for (let n = 0; n < MAX_SIBLINGS + 3; n += 1) {
      const plan = planRetryReply(messages, 1);
      const kept = keepRetriedBranch(messages, plan, { key: `k${n}` });
      messages = [...kept, { id: `r${n}`, role: "assistant", content: `reply ${n}` }];
    }
    const siblings = messages[0].reply_siblings;
    expect(siblings).toHaveLength(MAX_SIBLINGS);
    expect(siblings[0].key).toBe("k3");
  });

  it("ignores placeholders and keeps nothing when no reply text exists", () => {
    expect(branchToSibling([{ role: "assistant", character_name: "__typing__", content: "..." }])).toBeNull();
    const messages = [{ id: "u", role: "user", content: "hi" }, { id: "a", role: "assistant", content: "" }];
    const plan = planRetryReply(messages, 1);
    expect(keepRetriedBranch(messages, plan)).toEqual(plan.kept);
  });

  it("does nothing for ask-again (nothing discarded)", () => {
    const messages = convo().slice(0, 5);
    const plan = planRetryReply(messages, messages.length);
    expect(keepRetriedBranch(messages, plan)).toEqual(messages);
  });
});

describe("siblingPagerAt", () => {
  it("is only shown on the first reply after a user line with siblings", () => {
    const messages = convo();
    const plan = planRetryReply(messages, 3);
    const kept = keepRetriedBranch(messages, plan, { key: "k1" });
    const live = [...kept, { id: "t4:assistant", role: "assistant", content: "great" }];
    expect(siblingPagerAt(live, 3)).toMatchObject({ parentIndex: 2, total: 2 });
    expect(siblingPagerAt(live, 1)).toBeNull();
    expect(siblingPagerAt(live, 2)).toBeNull();
  });
});

describe("switchToSibling", () => {
  it("restores an earlier branch with fresh ids and archives the live one", () => {
    const messages = convo();
    const plan = planRetryReply(messages, 3);
    const kept = keepRetriedBranch(messages, plan, { key: "old" });
    const live = [...kept, { id: "t4:assistant", role: "assistant", content: "great", character_name: "Serenity" }];
    let n = 0;
    const out = switchToSibling(live, 2, "old", { key: "live", makeId: () => `new${++n}` });
    expect(out.ok).toBe(true);
    expect(out.messages.map((m) => m.content)).toEqual(["hi", "hello", "how are you", "good", "nice", "yes"]);
    expect(out.messages.slice(3).map((m) => m.id)).toEqual(["new1", "new2", "new3"]);
    expect(out.messages[3]).not.toHaveProperty("turn_id");
    expect(out.messages[3].restored_from).toBe("t2:assistant");
    expect(out.messages[2].reply_siblings.map((s) => s.key)).toEqual(["live"]);
    expect(out.messages[2].reply_siblings[0].messages[0].content).toBe("great");
  });

  it("refuses while a reply is streaming or the sibling is unknown", () => {
    const messages = convo();
    const kept = keepRetriedBranch(messages, planRetryReply(messages, 3), { key: "old" });
    const streaming = [...kept, { role: "assistant", character_name: "__typing__", content: "..." }];
    expect(switchToSibling(streaming, 2, "old")).toEqual({ ok: false, reason: "busy" });
    expect(switchToSibling(kept, 2, "nope")).toEqual({ ok: false, reason: "no_sibling" });
    expect(switchToSibling(kept, 1, "old")).toEqual({ ok: false, reason: "no_parent" });
  });
});
