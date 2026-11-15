import { describe, expect, it } from "vitest";
import { stripMachineTags, stripMachineTagsStreaming, MAX_MACHINE_TAG_LENGTH } from "./machineTags";
import { streamChatReply } from "./streamChatReply";

/** Feed `text` split at `cut` (and at every char) and return what the UI last painted. */
function streamedAt(text, cuts) {
  let acc = "";
  let shown = "";
  let prev = 0;
  for (const cut of [...cuts, text.length]) {
    acc += text.slice(prev, cut);
    prev = cut;
    shown = stripMachineTagsStreaming(acc);
    // Never paint a held-back tag fragment.
    expect(shown).not.toMatch(/\[\s*EMOTION\s*:[^\]]*\]/i);
  }
  return { shown, final: stripMachineTags(acc) };
}

const CASES = [
  ["Hi [EMOTION: sad] there.", "Hi there."],
  ["[EMOTION:tender] I missed you.", "I missed you."],
  ["Wait here. [[exit]]", "Wait here."],
  ["She nods.\n[[enter:Serenity]] Serenity walks in.", "She nods.\nSerenity walks in."],
  ["Ça va? [EMOTION: 😢 triste] Je suis là. 💜", "Ça va? Je suis là. 💜"],
  ["日本語 [[exit]] テスト 👩‍👩‍👧", "日本語 テスト 👩‍👩‍👧"],
  ["I'm glad you're here. Grief is heavy.", "I'm glad you're here. Grief is heavy."],
  ['She said "I feel sad" [and smiled].', 'She said "I feel sad" [and smiled].'],
  ["[Emotional support] is what I offer.", "[Emotional support] is what I offer."],
  ["Use [x] and [y]. 😢", "Use [x] and [y]. 😢"],
];

describe("stripMachineTags", () => {
  it.each(CASES)("strips only machine tags: %j", (input, expected) => {
    expect(stripMachineTags(input)).toBe(expected);
  });

  it.each(CASES)("is chunk-boundary independent at every split: %j", (input, expected) => {
    for (let i = 0; i <= input.length; i += 1) {
      const { final } = streamedAt(input, [i]);
      expect(final).toBe(expected);
    }
    // One character per chunk too (includes splits inside surrogate pairs).
    const every = [...Array(input.length).keys()].slice(1);
    expect(streamedAt(input, every).final).toBe(expected);
  });

  it("holds back an incomplete tag mid-stream", () => {
    expect(stripMachineTagsStreaming("Hello [EMOT")).toBe("Hello ");
    expect(stripMachineTagsStreaming("Hello [[ex")).toBe("Hello ");
    expect(stripMachineTagsStreaming("Hello [[exit]")).toBe("Hello ");
    expect(stripMachineTagsStreaming("Hello [")).toBe("Hello ");
    expect(stripMachineTagsStreaming("Hello [Emotional")).toBe("Hello [Emotional");
  });

  it("flushes an unclosed tag as text at stream end", () => {
    expect(stripMachineTags("Hello [EMOTION: sad")).toBe("Hello [EMOTION: sad");
    expect(stripMachineTags("Bye [[exit")).toBe("Bye [[exit");
  });

  it("releases an over-long bracket instead of hiding text forever", () => {
    const long = `Note [EMOTION: ${"x".repeat(MAX_MACHINE_TAG_LENGTH + 10)}`;
    expect(stripMachineTagsStreaming(long)).toBe(long);
  });
});

async function* frames(chunks, done = {}) {
  for (const c of chunks) yield { content: c };
  yield { done: true, ...done };
}

describe("streamChatReply stripTags", () => {
  const reply = "Hi [EMOTION: sad] there. [[exit]] 💜";

  it("streamed and returned text match at every chunk boundary", async () => {
    for (let i = 1; i < reply.length; i += 1) {
      const painted = [];
      const result = await streamChatReply(frames([reply.slice(0, i), reply.slice(i)]), {
        stripTags: true,
        onDelta: (t) => painted.push(t),
      });
      expect(result.content).toBe("Hi there. 💜");
      expect(painted.at(-1)).toBe(result.content);
      for (const p of painted) expect(p).not.toContain("[EMOTION");
    }
  });

  it("flag off leaves tags exactly as today", async () => {
    const result = await streamChatReply(frames([reply]));
    expect(result.content).toBe(reply);
  });

  it("strips tags from done.visible too", async () => {
    const result = await streamChatReply(frames([], { visible: reply }), { stripTags: true });
    expect(result.content).toBe("Hi there. 💜");
  });

  it("hands the provisional affect frame to onAffect and never returns it", async () => {
    const seen = [];
    async function* withAffect() {
      yield { affect: { character_id: "scarlet", snapshot: { expressed: true }, provisional: true } };
      yield { content: "Hello." };
      yield { done: true };
    }
    const result = await streamChatReply(withAffect(), { onAffect: (f) => seen.push(f) });
    expect(seen).toHaveLength(1);
    expect(result.affect).toBeUndefined();
    expect(result.content).toBe("Hello.");
  });
});
