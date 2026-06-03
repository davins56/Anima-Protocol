import { Router } from "express";
import OpenAI, { toFile } from "openai";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../../lib/rateLimit";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();
router.use(rateLimit);

async function llm(systemPrompt: string, userPrompt: string, maxTokens = 1024): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return resp.choices[0]?.message?.content ?? "";
}

// Web-grounded LLM call: uses the OpenAI Responses API with the web_search
// tool so the model can scour the live web (cast to any to stay compatible
// across SDK minor versions). Falls back to the plain model if unavailable.
async function webSearchLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const resp = await (openai as any).responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      instructions: systemPrompt,
      input: userPrompt,
    });
    const text = (resp as any).output_text;
    if (typeof text === "string" && text.trim()) return text;
    return await llm(systemPrompt, userPrompt);
  } catch {
    return llm(systemPrompt, userPrompt);
  }
}

function parseTraits(raw: string): { personality: string; backstory: string; speaking_style: string } {
  const empty = { personality: "", backstory: "", speaking_style: "" };
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return empty;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return {
      personality: typeof obj.personality === "string" ? obj.personality : "",
      backstory: typeof obj.backstory === "string" ? obj.backstory : "",
      speaking_style: typeof obj.speaking_style === "string" ? obj.speaking_style : "",
    };
  } catch {
    return empty;
  }
}

router.post("/invoke/:fnName", async (req, res) => {
  const { fnName } = req.params;
  const data = req.body as Record<string, unknown>;

  try {
    let result: unknown = null;

    switch (fnName) {
      case "generateSessionSummary":
      case "generateStorySummary":
      case "compileDailyChronicles": {
        const msgs = (data.messages as { role: string; content: string; character_name?: string }[]) ?? [];
        const history = msgs.slice(-20).map(m => `${m.character_name || m.role}: ${m.content}`).join("\n");
        result = await llm(
          "You are a narrative chronicler. Summarize this story session in 2-3 vivid sentences, highlighting key emotional moments and decisions.",
          history || "No messages yet."
        );
        break;
      }

      case "detectQuestsFromNarrative":
      case "generateSessionQuests":
      case "generateSpecialQuests":
      case "suggestSideQuests": {
        const context = JSON.stringify(data);
        const raw = await llm(
          "You are a quest designer. Return a JSON array of 1-3 quest objects with fields: { title, description, objective, reward }. Output only valid JSON.",
          `Generate quests from this context: ${context}`
        );
        try { result = JSON.parse(raw); } catch { result = []; }
        break;
      }

      case "generateChoices": {
        const context = JSON.stringify(data);
        const raw = await llm(
          "You are a narrative game designer. Return a JSON array of 3 story choice strings the player could say next. Output only a JSON array of strings.",
          `Context: ${context}`
        );
        try { result = JSON.parse(raw); } catch { result = []; }
        break;
      }

      case "generateResponseSuggestions": {
        const context = JSON.stringify(data);
        const raw = await llm(
          "Generate 3 short message suggestions the user could send next. Return a JSON array of strings.",
          `Context: ${context}`
        );
        try { result = JSON.parse(raw); } catch { result = []; }
        break;
      }

      case "updateRelationship": {
        result = { tier: "warm", score: 60, ...(data as object) };
        break;
      }

      case "characterMemory":
      case "respondMentalLine": {
        const prompt = (data.prompt as string) || JSON.stringify(data);
        result = await llm(
          "You are an introspective AI companion. Respond thoughtfully and briefly.",
          prompt,
          512
        );
        break;
      }

      case "generateAtmosphericDescription":
      case "generateLocationBackground":
      case "extractLocationContext":
      case "injectLocationContext": {
        const loc = (data.location as string) || (data.location_name as string) || "the current scene";
        result = await llm(
          "You are an atmospheric world-builder. Write a 2-sentence vivid description.",
          `Describe the atmosphere of: ${loc}`
        );
        break;
      }

      case "generateLocationHints": {
        const loc = (data.location as string) || "this location";
        const raw = await llm(
          "Return a JSON array of 3 short atmospheric hint strings for this location. Output only valid JSON.",
          `Location: ${loc}`
        );
        try { result = JSON.parse(raw); } catch { result = []; }
        break;
      }

      case "analyzeMessageTags": {
        const content = (data.content as string) || "";
        const raw = await llm(
          "Analyze this message and return a JSON object with: { emotion: string, intensity: number (1-5), tags: string[] }. Output only valid JSON.",
          content
        );
        try { result = JSON.parse(raw); } catch { result = { emotion: "neutral", intensity: 2, tags: [] }; }
        break;
      }

      case "analyzeNarrativeContext":
      case "analyzeEmotionalClimate": {
        result = await llm(
          "Briefly analyze the emotional and narrative tone of this session in 1-2 sentences.",
          JSON.stringify(data)
        );
        break;
      }

      case "extractLore":
      case "ingestSeriesLore": {
        const text = (data.text as string) || (data.content as string) || "";
        const raw = await llm(
          "Extract world lore facts from this text. Return a JSON array of { subject, fact } objects. Output only valid JSON.",
          text.slice(0, 4000)
        );
        try { result = JSON.parse(raw); } catch { result = []; }
        break;
      }

      case "evolveCharacter":
      case "trackCharacterEvolution":
      case "analyzeCharacterForBehavior": {
        result = await llm(
          "Describe how this character has evolved based on recent events in 1-2 sentences.",
          JSON.stringify(data)
        );
        break;
      }

      case "updateInventory":
      case "applyNarrativeItemEvents": {
        result = { success: true, inventory: data.inventory ?? [] };
        break;
      }

      case "autoEvolveWorldState":
      case "worldEvolutionOrchestrator":
      case "suggestWorldEvents":
      case "generateWorldEvent": {
        result = await llm(
          "Describe a subtle world state change in 1-2 sentences based on recent story events.",
          JSON.stringify(data)
        );
        break;
      }

      case "autoAssignCharacterVoices":
      case "assignCharacterVoices": {
        result = { voices: {} };
        break;
      }

      case "getActiveQuests": {
        result = { quests: [] };
        break;
      }

      case "calculateInfluenceScores": {
        result = { scores: {} };
        break;
      }

      case "exportSessionArchive":
      case "exportSessionData": {
        result = { data: data, exported_at: new Date().toISOString() };
        break;
      }

      case "compileWorldTimeline":
      case "updateNarrativeArcs": {
        result = { timeline: [], arcs: [] };
        break;
      }

      case "generateInsightsSummary":
      case "generateQuestStatistics": {
        result = await llm(
          "Provide a brief insights summary in 1-2 sentences.",
          JSON.stringify(data)
        );
        break;
      }

      case "generateQuestHints": {
        result = { hints: ["Follow the story naturally.", "Talk to characters to learn more."] };
        break;
      }

      case "updateInGameCalendar":
      case "updateSeasonalContext": {
        result = { updated: true };
        break;
      }

      case "generateCharacterTraits":
      case "enrichCharacterFromWikipedia":
      case "fetchCharacterBioFromWikipedia": {
        const name = ((data.name as string) || (data.character_name as string) || "").trim();
        const universe = ((data.universe as string) || (data.character_universe as string) || "").trim();
        if (!name) {
          result = { personality: "", backstory: "", speaking_style: "" };
          break;
        }
        const raw = await webSearchLLM(
          "You are a character research assistant. Use web search to find how the specified fictional character actually behaves and talks across their canonical source material. Return ONLY a valid JSON object with exactly these string fields: \"personality\", \"backstory\", and \"speaking_style\". Each field should be 2-4 sentences. The \"speaking_style\" field must capture concrete, imitable details: verbal tics, catchphrases, vocabulary, rhythm, tone, and mannerisms, so an AI can convincingly speak as them. If you cannot find an established, real character by this name, return all three fields as empty strings. Do not include markdown, code fences, or any text outside the JSON.",
          `Research the character "${name}"${universe ? ` from ${universe}` : ""}. Focus especially on their distinctive speech patterns and mannerisms.`
        );
        result = parseTraits(raw);
        break;
      }

      case "generateCompanionFromPrompt": {
        const prompt = (data.prompt as string) || "";
        const raw = await llm(
          "Create an AI companion character. Return a JSON object with: { name, personality, backstory, speaking_style, traits }. Output only valid JSON.",
          `Create companion: ${prompt}`
        );
        try { result = JSON.parse(raw); } catch { result = {}; }
        break;
      }

      case "generateGroupInteraction": {
        const context = JSON.stringify(data);
        result = await llm(
          "Write a brief group interaction between the characters in 2-3 sentences.",
          context
        );
        break;
      }

      case "generateCharacterPortrait": {
        result = { portrait_url: null };
        break;
      }

      case "searchMemoriesSemantically": {
        result = { memories: [] };
        break;
      }

      case "sacredSpaceImpact":
      case "dailyJournalCompilation": {
        result = await llm(
          "Write a reflective 1-2 sentence entry for this moment.",
          JSON.stringify(data)
        );
        break;
      }

      case "elevenLabsTTS":
      case "elevenLabsVoices": {
        result = { audio: null, voices: [] };
        break;
      }

      case "createCheckoutSession": {
        result = { url: null, error: "Payments not configured in Replit environment." };
        break;
      }

      case "debugApp": {
        result = { status: "ok", message: "Running in Replit environment." };
        break;
      }

      default: {
        const raw = await llm(
          `You are a helpful AI function handler named "${fnName}". Process the input and return a useful result. If returning structured data, output valid JSON.`,
          JSON.stringify(data)
        ).catch(() => null);
        result = raw;
        break;
      }
    }

    res.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Maps a raw error from the gpt-image-1 edit call into a stable
// { status, code, error } shape the client can branch on to show specific
// guidance (rate limits, content-policy rejections, etc). Pure + exported so
// it can be unit-tested without hitting OpenAI.
export function mapImageEditError(err: unknown): {
  status: number;
  code: string;
  error: string;
} {
  const e = (err ?? {}) as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: { code?: string; type?: string; message?: string };
  };
  const rawMessage =
    e.message || e.error?.message || (typeof err === "string" ? err : "") || "Image edit failed.";
  const rawCode = (e.code || e.error?.code || e.type || e.error?.type || "").toString();
  const haystack = `${rawCode} ${rawMessage}`.toLowerCase();

  const upstreamStatus =
    typeof e.status === "number" && e.status >= 400 && e.status < 600 ? e.status : undefined;

  // Content-policy / moderation rejection.
  if (
    rawCode === "moderation_blocked" ||
    rawCode === "content_policy_violation" ||
    haystack.includes("content policy") ||
    haystack.includes("safety system") ||
    haystack.includes("moderation")
  ) {
    return {
      status: 400,
      code: "content_policy",
      error: "That request was blocked by the content safety filter.",
    };
  }

  // Rate limit / quota.
  if (
    upstreamStatus === 429 ||
    rawCode === "rate_limit_exceeded" ||
    rawCode === "insufficient_quota" ||
    haystack.includes("rate limit") ||
    haystack.includes("quota")
  ) {
    return {
      status: 429,
      code: "rate_limit",
      error: "The image service is busy right now.",
    };
  }

  return {
    status: upstreamStatus ?? 500,
    code: "server_error",
    error: rawMessage,
  };
}

// AI photo edit: takes a base64 image data URL plus a text prompt and returns
// an AI-transformed version (gpt-image-1 edit). Gated to signed-in users since
// image generation is a paid call. The result is returned as a PNG data URL.
router.post("/image-edit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { image, prompt } = req.body as { image?: string; prompt?: string };

  if (typeof image !== "string" || !image.startsWith("data:")) {
    res.status(400).json({ error: "A base64 image data URL is required." });
    return;
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "An edit prompt is required." });
    return;
  }

  const match = image.match(/^data:(.+?);base64,(.*)$/);
  if (!match) {
    res.status(400).json({ error: "Malformed image data." });
    return;
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: "Image is too large." });
    return;
  }
  const ext = mime.includes("png")
    ? "png"
    : mime.includes("webp")
      ? "webp"
      : "jpg";

  try {
    const file = await toFile(buffer, `source.${ext}`, { type: mime });
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt: prompt.trim().slice(0, 1000),
      size: "1024x1024",
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      res.status(502).json({ error: "No image was returned." });
      return;
    }
    res.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    const mapped = mapImageEditError(err);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

export default router;
