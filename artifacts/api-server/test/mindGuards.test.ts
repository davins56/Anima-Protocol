import { describe, expect, it } from "vitest";
import {
  antiRepetitionNote,
  createPersonaStreamGuard,
  echoesRecentReply,
  sanitizeCompanionReply,
} from "../src/lib/mind/personaGuard";
import { CONTINUE_PLACEHOLDER, shapeMessagesForModel } from "../src/lib/mind/templates";
import { consumeWithMidstreamFallback } from "../src/lib/mind/streamFallback";
import {
  REASONING_RESERVE_TOKENS,
  REPLY_RESERVE_TOKENS,
  TOKEN_ESTIMATE_HEADROOM,
  UNKNOWN_MODEL_CONTEXT_TOKENS,
  maxPromptTokensFor,
  mindProfileFor,
  modelContextTokens,
  modelFamily,
  samplingFor,
} from "../src/lib/mind/profile";

const opts = { companionName: "Ava", userName: "Sam" };

function streamThrough(chunks: string[]): string {
  const guard = createPersonaStreamGuard(opts);
  let out = "";
  for (const c of chunks) out += guard.push(c);
  out += guard.finish();
  return out;
}

describe("chat mind persona guard", () => {
  it("strips a self label, template tokens and meta lines", () => {
    expect(sanitizeCompanionReply("Ava: Hey you. *smiles*<|eot_id|>", opts)).toBe("Hey you. *smiles*");
    expect(sanitizeCompanionReply("**Ava:** Morning!", opts)).toBe("Morning!");
    expect(sanitizeCompanionReply("Sure thing.\n[System: memory updated]\nSee you.", opts)).toBe("Sure thing.\nSee you.");
    expect(sanitizeCompanionReply("(OOC: as an AI I...)\nI missed you.", opts)).toBe("I missed you.");
  });

  it("cuts the reply where the model starts writing the user's turn", () => {
    expect(sanitizeCompanionReply("That sounds lovely.\nSam: yeah it was\nAva: great", opts)).toBe("That sounds lovely.");
    expect(sanitizeCompanionReply("Tell me more.\nUser: ok", opts)).toBe("Tell me more.");
  });

  it("keeps ordinary roleplay intact", () => {
    const text = "*laughs softly* (I knew it.) You always say that, Sam. Ready: set, go!";
    expect(sanitizeCompanionReply(text, opts)).toBe(text);
  });

  it("streams the same clean text even when labels split across chunks", () => {
    expect(streamThrough(["A", "va", ": Hel", "lo there, how was ", "the trip?"])).toBe("Hello there, how was the trip?");
    expect(
      streamThrough(["It was wonderful to hear.", "\nSa", "m: thanks", "\nAva: anytime"]),
    ).toBe("It was wonderful to hear.");
    expect(streamThrough(["Hi.<|eot", "_id|>"])).toBe("Hi.");
  });

  it("holds a possible scaffolding line until its newline decides it", () => {
    const guard = createPersonaStreamGuard(opts);
    let shown = guard.push("Okay, here it is. I thought about what you said all day long and I agree.\n");
    shown += guard.push("[System: user mood=sad, keep it short and kind please]");
    expect(shown).not.toContain("[System");
    shown += guard.push("\nAnyway, tea?");
    shown += guard.finish();
    expect(shown).not.toContain("[System");
    expect(shown).toContain("Anyway, tea?");
  });

  it("flags the stream to stop on a run-on into the user's turn", () => {
    const guard = createPersonaStreamGuard(opts);
    guard.push("Goodnight, sleep well and dream of something kind.\nUser:");
    expect(guard.stopped).toBe(true);
  });

  it("builds an anti-repetition note from recent openings", () => {
    const note = antiRepetitionNote(["Oh, Sam, that is so sweet of you.", "Oh, Sam, I can't believe it!", "Hm."]);
    expect(note).toContain('"Oh, Sam, I can\'t believe it!…"');
    expect(antiRepetitionNote([])).toBe("");
    expect(echoesRecentReply("I am so proud of you for finishing the marathon today", ["so proud of you for finishing the marathon today, truly I am"])).toBe(true);
    expect(echoesRecentReply("Want to grab tea later and talk about the book?", ["so proud of you for finishing the marathon"])).toBe(false);
  });
});

describe("chat mind model templates", () => {
  const msgs = [
    { role: "system", content: "persona" },
    { role: "assistant", content: "Hi, I'm here." },
    { role: "user", content: "hey" },
    { role: "user", content: "you there?" },
    { role: "assistant", content: "" },
    { role: "system", content: "Answer the last message." },
    { role: "user", content: "hello?" },
  ];

  it("Llama keeps the closing system note and merges same-role turns", () => {
    const shaped = shapeMessagesForModel(msgs, { strictAlternation: false });
    expect(shaped.map((m) => m.role)).toEqual(["system", "assistant", "user", "system", "user"]);
    expect(shaped[2]?.content).toBe("hey\n\nyou there?");
  });

  it("strict templates get one leading system, start on user and alternate", () => {
    const shaped = shapeMessagesForModel(msgs, { strictAlternation: true });
    expect(shaped[0]?.role).toBe("system");
    expect(shaped[0]?.content).toContain("Right now:\nAnswer the last message.");
    expect(shaped[1]).toEqual({ role: "user", content: CONTINUE_PLACEHOLDER });
    const roles = shaped.slice(1).map((m) => m.role);
    for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1]);
    expect(roles.at(-1)).toBe("user");
    expect(shaped.at(-1)?.content).toBe("hey\n\nyou there?\n\nhello?");
  });
});

describe("chat mind stream fallback", () => {
  const provider = (name: string) => ({ provider: name });

  it("reopens on the next provider when the first dies before any text", async () => {
    const opened: string[][] = [];
    let shown = false;
    const run = await consumeWithMidstreamFallback({
      open: async (ex) => {
        opened.push(ex);
        return provider(ex.length ? "openrouter" : "workersai");
      },
      consume: async (o) => {
        if (o.provider === "workersai") throw new Error("4006 neuron quota");
        shown = true;
        return "hello";
      },
      emittedVisible: () => shown,
      hasAlternative: (ex) => !ex.includes("openrouter"),
    });
    expect(run).toMatchObject({ result: "hello", attempts: 2, opened: { provider: "openrouter" } });
    expect(opened).toEqual([[], ["workersai"]]);
  });

  it("does not splice a second model onto text the user already saw", async () => {
    await expect(
      consumeWithMidstreamFallback({
        open: async () => provider("workersai"),
        consume: async () => {
          throw new Error("socket closed");
        },
        emittedVisible: () => true,
        hasAlternative: () => true,
      }),
    ).rejects.toThrow("socket closed");
  });

  it("gives up when no other provider remains", async () => {
    let opens = 0;
    await expect(
      consumeWithMidstreamFallback({
        open: async () => {
          opens += 1;
          return provider("workersai");
        },
        consume: async () => {
          throw new Error("boom");
        },
        emittedVisible: () => false,
        hasAlternative: () => false,
      }),
    ).rejects.toThrow("boom");
    expect(opens).toBe(1);
  });
});

describe("chat mind profile", () => {
  it("maps model ids to families", () => {
    expect(modelFamily("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe("llama");
    expect(modelFamily("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b")).toBe("deepseek-r1");
    expect(modelFamily("cognitivecomputations/dolphin-mistral-24b-venice-edition:free")).toBe("mistral");
    expect(modelFamily("@cf/google/gemma-3-12b-it")).toBe("gemma");
    expect(modelFamily("something-else")).toBe("generic");
  });

  it("is off for the local host, the own model and ANIMA_CHAT_MIND=off", () => {
    expect(mindProfileFor("local", "anima-chat", {})).toBeNull();
    expect(mindProfileFor("own", "x", {})).toBeNull();
    expect(mindProfileFor("workersai", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { ANIMA_CHAT_MIND: "off" })).toBeNull();
  });

  it("sizes hosted prompts and clamps env overrides", () => {
    const p = mindProfileFor("workersai", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {})!;
    expect(p.promptTokens).toBe(12000);
    expect(p.knowledgeTokens).toBe(Math.floor(12000 * 0.22));
    expect(p.historyExchanges).toBe(16);
    expect(p.strictAlternation).toBe(false);
    expect(p.sampling.temperature).toBeGreaterThan(0.65);
    const big = mindProfileFor("openrouter", "mistralai/mistral-small-3.1-24b-instruct", {
      ANIMA_MIND_PROMPT_TOKENS: "999999",
      ANIMA_MIND_HISTORY_EXCHANGES: "2",
    })!;
    expect(big.promptTokens).toBe(100000);
    expect(big.historyExchanges).toBe(4);
    expect(big.strictAlternation).toBe(true);
    expect(samplingFor("llama", { ANIMA_MIND_TEMPERATURE: "0.5" }).temperature).toBe(0.5);
  });
});

describe("chat mind context-window clamp", () => {
  const LLAMA70 = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

  it("knows the production models and is conservative about unknown ones", () => {
    expect(modelContextTokens(LLAMA70, {})).toBe(24000);
    expect(modelContextTokens("@cf/meta/llama-3.1-8b-instruct", {})).toBe(7968);
    expect(modelContextTokens("@cf/meta/llama-3.1-8b-instruct-fast", {})).toBe(128000);
    expect(modelContextTokens("venice/uncensored:free", {})).toBe(32768);
    expect(modelContextTokens("mystery-model", {})).toBe(UNKNOWN_MODEL_CONTEXT_TOKENS);
    expect(modelContextTokens("mystery-model", { ANIMA_MIND_CONTEXT_TOKENS: "65536" })).toBe(65536);
  });

  it("leaves room for the reply and estimate error", () => {
    expect(maxPromptTokensFor(LLAMA70, {})).toBe(Math.floor((24000 - REPLY_RESERVE_TOKENS) * TOKEN_ESTIMATE_HEADROOM));
    // Reasoning models keep a bigger reserve for their thinking.
    expect(maxPromptTokensFor("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", {})).toBe(
      Math.floor((80000 - REASONING_RESERVE_TOKENS) * TOKEN_ESTIMATE_HEADROOM),
    );
    for (const m of [LLAMA70, "@cf/meta/llama-3.1-8b-instruct", "mystery-model"]) {
      const budget = maxPromptTokensFor(m, {});
      expect(budget + REPLY_RESERVE_TOKENS).toBeLessThan(modelContextTokens(m, {}));
    }
  });

  it("clamps the 12k default to small models and to the smallest fallback", () => {
    const small = mindProfileFor("workersai", "@cf/meta/llama-3.1-8b-instruct", {})!;
    expect(small.promptTokens).toBe(maxPromptTokensFor("@cf/meta/llama-3.1-8b-instruct", {}));
    expect(small.promptTokens).toBeLessThan(7968 - REPLY_RESERVE_TOKENS);
    const withFallback = mindProfileFor("workersai", LLAMA70, {}, ["mystery-model"])!;
    expect(withFallback.promptTokens).toBe(maxPromptTokensFor("mystery-model", {}));
    const roomyFallback = mindProfileFor("workersai", LLAMA70, {}, ["minimax/minimax-m2.7:free"])!;
    expect(roomyFallback.promptTokens).toBe(12000);
    const askedTooMuch = mindProfileFor("workersai", LLAMA70, { ANIMA_MIND_PROMPT_TOKENS: "50000" })!;
    expect(askedTooMuch.promptTokens).toBe(maxPromptTokensFor(LLAMA70, {}));
  });
});
