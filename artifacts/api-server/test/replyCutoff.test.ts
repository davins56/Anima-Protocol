/**
 * Long replies on hosted models: enough output room, a cap that is detected
 * on Workers AI (which never sends finish_reason), and a capped reply that
 * ends on a sentence instead of mid-word.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resetAiBindingForTests, setAiBinding } from "../src/lib/aiBinding";
import { markWorkersAiLengthFinish, streamWorkersAi, WORKERS_AI_CHAT_MODEL } from "../src/lib/workersAi";
import { consumeLlmStream } from "../src/lib/consumeLlmStream";
import { createChatStreamWithFailover } from "../src/lib/llmFailover";
import {
  COMPANION_REPLY_MAX_TOKENS,
  REASONING_REPLY_MAX_TOKENS,
  SHORT_REPLY_MAX_TOKENS,
  chatReplyMaxTokens,
  hostedReplyMaxTokens,
  isReasoningChatModel,
} from "../src/lib/chatTimeouts";
import { finalizeAssistantReply, settleCappedReply } from "../src/lib/visibleAssistantReply";
import { replyLengthNote } from "../src/lib/mind";

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
  resetAiBindingForTests();
});

function sse(lines: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(`data: ${typeof l === "string" ? l : JSON.stringify(l)}\n\n`));
      c.close();
    },
  });
}

// What Workers AI really streams (seen live): text events, then a usage
// event, then [DONE]. No finish_reason anywhere.
const CUT = "I see us weaving something new together. How do you envision our interactions within this virtual";
const workersAiCapped = (completion: number) =>
  sse([
    { response: CUT.slice(0, 40) },
    { response: CUT.slice(40), usage: { prompt_tokens: 0, completion_tokens: 0 } },
    { usage: { prompt_tokens: 11418, completion_tokens: completion, total_tokens: 11418 + completion } },
    "[DONE]",
  ]);

describe("Workers AI cap detection", () => {
  it("marks a reply that used the whole max_tokens as finish_reason length", async () => {
    setAiBinding({ run: async () => workersAiCapped(90) });
    const stream = await streamWorkersAi({ messages: [{ role: "user", content: "hi" }], maxTokens: 90 });
    const res = await consumeLlmStream(stream as never);
    expect(res.content).toBe(CUT);
    expect(res.finishReason).toBe("length");
  });

  it("leaves a reply the model finished as stop", async () => {
    setAiBinding({ run: async () => workersAiCapped(40) });
    const stream = await streamWorkersAi({ messages: [{ role: "user", content: "hi" }], maxTokens: 1024 });
    expect((await consumeLlmStream(stream as never)).finishReason).toBe("stop");
  });

  it("falls back to a text-length estimate when no usage is reported", async () => {
    async function* chunks() {
      yield { choices: [{ index: 0, delta: { content: "x".repeat(400) }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    }
    const out: Array<string | null | undefined> = [];
    for await (const c of markWorkersAiLengthFinish(chunks() as never, 100)) out.push(c.choices[0]?.finish_reason);
    expect(out.at(-1)).toBe("length");
    const short: Array<string | null | undefined> = [];
    for await (const c of markWorkersAiLengthFinish(chunks() as never, 1024)) short.push(c.choices[0]?.finish_reason);
    expect(short.at(-1)).toBe("stop");
  });
});

describe("hosted reply room", () => {
  it("never gives a hosted reply less than 1,024 tokens, and a reasoning model 4,096", () => {
    expect(hostedReplyMaxTokens(SHORT_REPLY_MAX_TOKENS, WORKERS_AI_CHAT_MODEL)).toBe(COMPANION_REPLY_MAX_TOKENS);
    expect(hostedReplyMaxTokens(32, WORKERS_AI_CHAT_MODEL)).toBe(COMPANION_REPLY_MAX_TOKENS);
    expect(hostedReplyMaxTokens(1024, "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b")).toBe(REASONING_REPLY_MAX_TOKENS);
    expect(hostedReplyMaxTokens(8192, WORKERS_AI_CHAT_MODEL)).toBe(8192); // group / deep mode keep theirs
    expect(isReasoningChatModel("deepseek/deepseek-r1:free")).toBe(true);
    expect(isReasoningChatModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe(false);
    // The local 0.5B path still gets the small Short cap.
    expect(chatReplyMaxTokens(8192, { responseLength: "short" })).toBe(SHORT_REPLY_MAX_TOKENS);
  });

  function workersAiOnly(onRun: (opts: Record<string, unknown>) => void) {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    process.env.VERCEL = "1";
    setAiBinding({
      run: async (_m, opts) => {
        onRun(opts);
        return sse([{ response: "Done." }, "[DONE]"]);
      },
    });
  }

  it("sends a companion reply to Workers AI with full room even when Settings → Short asked for 90", async () => {
    let sent: unknown;
    workersAiOnly((o) => (sent = o.max_tokens));
    const opened = await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: SHORT_REPLY_MAX_TOKENS,
      companionReply: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(opened.provider).toBe("workersai");
    expect(sent).toBe(COMPANION_REPLY_MAX_TOKENS);
  });

  it("gives a reasoning chat model room for its thinking", async () => {
    process.env.ANIMA_WORKERS_AI_MODEL = "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";
    let sent: unknown;
    workersAiOnly((o) => (sent = o.max_tokens));
    await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 1024,
      companionReply: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sent).toBe(REASONING_REPLY_MAX_TOKENS);
  });

  it("leaves non-reply calls (background jobs) at the size they asked for", async () => {
    let sent: unknown;
    workersAiOnly((o) => (sent = o.max_tokens));
    await createChatStreamWithFailover({
      tier: "standard",
      model: "gpt-4o",
      maxTokens: 32,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sent).toBe(32);
  });
});

describe("a capped reply ends cleanly", () => {
  it("ends on the last finished sentence, never mid-word", async () => {
    setAiBinding({ run: async () => workersAiCapped(90) });
    const stream = await streamWorkersAi({ messages: [{ role: "user", content: "hi" }], maxTokens: 90 });
    const res = await consumeLlmStream(stream as never);
    const shown = settleCappedReply(finalizeAssistantReply(res.content), res);
    expect(shown).toBe("I see us weaving something new together.");
  });

  it("drops a half-written last word with an ellipsis when there is no sentence to fall back on", () => {
    expect(settleCappedReply("how do you envision our interactions within this virt", { finishReason: "length" })).toBe(
      "how do you envision our interactions within this…",
    );
    expect(settleCappedReply("*reaches toward the quiet, undist", { finishReason: "length" })).toBe(
      "*reaches toward the quiet, undist*",
    );
    // A reply the model finished is untouched.
    expect(settleCappedReply("no punctuation at all", { finishReason: "stop" })).toBe("no punctuation at all");
  });
});

describe("length preference on hosted models is a prompt note", () => {
  it("says short / long in words instead of cutting tokens", () => {
    expect(replyLengthNote("short")).toMatch(/one or two sentences/);
    expect(replyLengthNote("long")).toMatch(/few paragraphs/);
    expect(replyLengthNote("medium")).toBe("");
    expect(replyLengthNote(undefined)).toBe("");
  });
});
