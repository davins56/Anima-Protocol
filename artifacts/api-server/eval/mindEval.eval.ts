/**
 * Offline eval for the chat mind: scripted multi-turn conversations, scored
 * at the prompt level (does the model get what it needs?) and the reply
 * level (does what reaches the user stay in character and clean?).
 *
 *   pnpm --filter @workspace/api-server run eval:mind
 *
 * With CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in the environment the
 * reply-level checks call Workers AI (REST, same model as production).
 * Without them a scripted mock model stands in and the report says so.
 * No database: facts / summaries are held in memory and fed through the
 * same ranking, packing and prompt code the Worker runs.
 */
import { describe, expect, it } from "vitest";
import { composeCompanionChatMessages, type LlmChatMessage } from "../src/lib/promptBuilder";
import {
  createPersonaStreamGuard,
  factScopeForTurn,
  maxPromptTokensFor,
  formatKnowledgeBlock,
  knowledgeCandidates,
  mindProfileFor,
  packKnowledge,
  parseExtractedFacts,
  parseSummary,
  planSummaryRollover,
  rankKnowledge,
  sanitizeCompanionReply,
  shapeMessagesForModel,
  type MindProfile,
  type UserFact,
} from "../src/lib/mind";

const MODEL = process.env.ANIMA_WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LIVE = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
const profile = mindProfileFor("workersai", MODEL, {}) as MindProfile;

const ava = {
  id: "ava",
  name: "Ava",
  personality: "Warm, wry, observant. Teases gently, remembers small details, asks one good question at a time.",
  backstory: "Grew up in a lighthouse town. Paints seascapes at night. Hates small talk, loves specifics.",
  speaking_style: "Short, vivid sentences. Never formal.",
};

type Turn = { role: "user" | "assistant"; content: string; seq: number };

function chatter(fromSeq: number, exchanges: number, topic: string): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < exchanges; i++) {
    out.push({ role: "user", content: `${topic} thought ${i}: ${"and then the afternoon went on ".repeat(3)}`, seq: fromSeq + i * 2 });
    out.push({ role: "assistant", content: `Mm, ${topic} again ${i}. ${"I like hearing about it. ".repeat(3)}`, seq: fromSeq + i * 2 + 1 });
  }
  return out;
}

function buildPrompt(args: {
  history: Turn[];
  content: string;
  facts?: UserFact[];
  summary?: string;
  mind: boolean;
}): LlmChatMessage[] {
  const knowledge = args.mind
    ? formatKnowledgeBlock(
        packKnowledge(
          rankKnowledge(knowledgeCandidates(args.facts ?? [], []), {
            query: args.content,
            historyTexts: args.history.map((h) => h.content),
          }),
          args.summary ?? "",
          profile.knowledgeTokens,
        ),
        { userName: "Sam" },
      )
    : "";
  const composed = composeCompanionChatMessages({
    characters: [ava],
    activeCharacter: ava,
    memories: [],
    mode: "solo",
    recentMessages: args.history.map((h) => ({ ...h, character_name: h.role === "assistant" ? "Ava" : undefined })),
    content: args.content,
    memoryCoreContext: knowledge,
    userDisplayName: "Sam",
    ...(args.mind
      ? {
          mind: {
            promptTokens: profile.promptTokens,
            historyExchanges: profile.historyExchanges,
            minHistoryExchanges: profile.minHistoryExchanges,
            historyMessageChars: profile.historyMessageChars,
            memoryTopK: profile.memoryTopK,
          },
        }
      : {}),
  } as never);
  return args.mind ? shapeMessagesForModel(composed, profile) : composed;
}

const promptText = (m: LlmChatMessage[]) => m.map((x) => x.content).join("\n");

async function liveReply(messages: LlmChatMessage[]): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: 220, ...profile.sampling }),
  });
  const json = (await res.json()) as { result?: { response?: string } };
  return String(json.result?.response ?? "");
}

/**
 * Mock model: answers from what is actually in the prompt, the way a good
 * model would, and also emits the failure modes small models produce (self
 * label, template token, run-on into the user's turn) so the guards are
 * exercised.
 */
function mockReply(messages: LlmChatMessage[], ask: RegExp): string {
  const text = promptText(messages.slice(0, -1));
  const hit = text.match(ask)?.[0];
  const body = hit ? `Of course I remember — ${hit}. *grins*` : "Hm, remind me? I've lost that thread.";
  return `Ava: ${body}<|eot_id|>\nSam: wow ok`;
}

async function reply(messages: LlmChatMessage[], ask: RegExp): Promise<string> {
  const raw = LIVE ? await liveReply(messages) : mockReply(messages, ask);
  const guard = createPersonaStreamGuard({ companionName: "Ava", userName: "Sam" });
  let shown = "";
  for (const piece of raw.match(/[\s\S]{1,7}/g) ?? []) shown += guard.push(piece);
  shown += guard.finish();
  return sanitizeCompanionReply(shown, { companionName: "Ava", userName: "Sam" });
}

const report: Array<{ scenario: string; legacy: string; mind: string }> = [];

describe(`chat mind eval (${LIVE ? `LIVE Workers AI ${MODEL}` : "MOCK model — no Cloudflare credentials"})`, () => {
  it("recalls a durable fact from 40 exchanges ago", async () => {
    const extracted = parseExtractedFacts(
      '{"facts":[{"fact":"Sam has a beagle named Biscuit.","category":"relationship","importance":0.8,"replaces":null}]}',
    ).map((f, i) => ({ ...f, id: `f${i}`, occurredAt: new Date().toISOString() }));
    const history: Turn[] = [
      { role: "user", content: "My beagle Biscuit ate my sock again lol", seq: 0 },
      { role: "assistant", content: "Biscuit has taste, clearly.", seq: 1 },
      ...chatter(2, 40, "work"),
    ];
    const content = "Random question, do you remember my dog's name?";
    const legacy = buildPrompt({ history, content, mind: false });
    const mind = buildPrompt({ history, content, facts: extracted, mind: true });
    expect(promptText(legacy)).not.toContain("Biscuit");
    expect(promptText(mind)).toContain("Sam has a beagle named Biscuit.");
    const r = await reply(mind, /Biscuit/);
    expect(r).toMatch(/Biscuit/);
    expect(r).not.toMatch(/^Ava:|<\|eot_id\|>|\nSam:/);
    report.push({ scenario: "fact from 40 exchanges ago", legacy: "missing from prompt", mind: `in prompt; reply: "${r.slice(0, 80)}"` });
  });

  it("keeps a detail from 12 exchanges back in the verbatim window", () => {
    const history: Turn[] = [
      ...chatter(0, 4, "weekend"),
      { role: "user", content: "The painting I'm starting is a red fishing boat called the Marigold.", seq: 8 },
      { role: "assistant", content: "The Marigold. I can already see the red against grey water.", seq: 9 },
      ...chatter(10, 11, "commute"),
    ];
    const content = "What was the boat in my painting called again?";
    const legacy = buildPrompt({ history, content, mind: false });
    const mind = buildPrompt({ history, content, mind: true });
    expect(promptText(legacy)).not.toContain("Marigold");
    expect(promptText(mind)).toContain("Marigold");
    report.push({ scenario: "detail 12 exchanges back", legacy: "cut (2–6 exchange window)", mind: "kept verbatim (16 exchanges)" });
  });

  it("carries a rolling summary once history ages out", () => {
    const history = chatter(0, 40, "travel");
    const plan = planSummaryRollover({ messages: history, previous: null, windowMessages: profile.historyExchanges * 2 });
    expect(plan).not.toBeNull();
    const summary = parseSummary('{"summary":"Sam planned a trip to Lisbon with their sister Ana in April and is nervous about flying."}');
    const mind = buildPrompt({ history, content: "So, any advice for the flight?", summary, mind: true });
    expect(promptText(mind)).toContain("Earlier in this conversation (summary)");
    expect(promptText(mind)).toContain("Lisbon");
    report.push({ scenario: "older conversation", legacy: "dropped", mind: `summary through seq ${plan?.throughSeq}` });
  });

  it("stays inside the prompt budget on a very long, fact-heavy chat", () => {
    const facts: UserFact[] = Array.from({ length: 60 }, (_, i) => ({
      id: `f${i}`,
      fact: `Sam fact ${i}: likes thing number ${i} and place ${i}.`,
      category: "preference",
      importance: 0.5,
      replaces: null,
    }));
    // 40 exchanges of ~1,500-char messages: far more than 12k tokens.
    const history = chatter(0, 40, "long").map((t) => ({ ...t, content: `${t.content} ${"so much to say here ".repeat(75)}` }));
    const mind = buildPrompt({ history, content: "hey", facts, summary: "x ".repeat(3000), mind: true });
    const tokens = Math.ceil(promptText(mind).length / 4);
    expect(tokens).toBeLessThanOrEqual(profile.promptTokens + 200);
    expect(mind.filter((m) => m.role === "user").length).toBeGreaterThanOrEqual(profile.minHistoryExchanges + 1);
    report.push({ scenario: "budget on long chat", legacy: "1,240-token cap", mind: `~${tokens} tokens of ${profile.promptTokens}` });
  });

  it("strict templates (Mistral/Gemma) alternate cleanly", () => {
    const strict = mindProfileFor("openrouter", "mistralai/mistral-small", {}) as MindProfile;
    const shaped = shapeMessagesForModel(buildPrompt({ history: chatter(0, 3, "x"), content: "hi", mind: true }), strict);
    expect(shaped.filter((m) => m.role === "system")).toHaveLength(1);
    const roles = shaped.slice(1).map((m) => m.role);
    expect(roles.every((r, i) => i === 0 || r !== roles[i - 1])).toBe(true);
    report.push({ scenario: "mistral/gemma template", legacy: "mid-list system turn", mind: "one system, strict alternation" });
  });

  it("shares a fact learned by another companion, but not a therapy-turn fact", async () => {
    // In-memory stand-in for memory_events, filtered with the same rule the
    // loadUserFacts SQL uses: same user, and (scope = user OR same companion).
    const store = [
      { userId: "u1", characterId: "kai", scope: factScopeForTurn({ mode: "standard" }), fact: "Sam is learning to play the cello." },
      { userId: "u1", characterId: "kai", scope: factScopeForTurn({ mode: "therapy" }), fact: "Sam is grieving their grandmother." },
      { userId: "u2", characterId: "ava", scope: "user" as const, fact: "Riley lives on a houseboat." },
    ];
    const visible = (userId: string, characterId: string) =>
      store
        .filter((r) => r.userId === userId && (r.scope === "user" || r.characterId === characterId))
        .map((r, i) => ({ id: `f${i}`, fact: r.fact, category: "other" as const, importance: 0.7 }));
    const content = "Guess what I practiced today?";
    const mind = buildPrompt({ history: chatter(0, 3, "day"), content, facts: visible("u1", "ava"), mind: true });
    const text = promptText(mind);
    expect(text).toContain("cello");
    expect(text).not.toContain("grandmother");
    expect(text).not.toContain("houseboat");
    const r = await reply(mind, /cello/);
    expect(r).toMatch(/cello/i);
    report.push({
      scenario: "fact told to another companion (Kai → Ava)",
      legacy: "not available",
      mind: `shared; therapy fact + other user's facts excluded; reply: "${r.slice(0, 80)}"`,
    });
  });

  it("clamps the 12k budget to each model's context window", () => {
    const small = mindProfileFor("workersai", "@cf/meta/llama-3.1-8b-instruct", {}) as MindProfile;
    const fallback = mindProfileFor("workersai", MODEL, {}, ["unknown/fallback-model"]) as MindProfile;
    expect(profile.promptTokens).toBe(Math.min(12_000, maxPromptTokensFor(MODEL, {})));
    expect(small.promptTokens).toBeLessThan(7_968 - 1_024);
    expect(fallback.promptTokens).toBe(maxPromptTokensFor("unknown/fallback-model", {}));
    report.push({
      scenario: "context-window clamp",
      legacy: "fixed 1,240",
      mind: `${MODEL}: ${profile.promptTokens}; llama-3.1-8b: ${small.promptTokens}; unknown fallback: ${fallback.promptTokens}`,
    });
  });

  it("prints the report", () => {
    console.log(
      `\nCHAT MIND EVAL — ${LIVE ? `live Workers AI (${MODEL})` : "MOCK model (no CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)"}\n` +
        report.map((r) => `- ${r.scenario}\n    legacy: ${r.legacy}\n    mind:   ${r.mind}`).join("\n"),
    );
    expect(report.length).toBe(7);
  });
});
