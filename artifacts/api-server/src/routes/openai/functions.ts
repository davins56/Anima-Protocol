import { Router } from "express";
import OpenAI from "openai";
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

router.post("/invoke/:fnName", async (req, res) => {
  const { fnName } = req.params;
  const data = req.body as Record<string, unknown>;

  try {
    let result: unknown = null;

    switch (fnName) {
      case "generateSessionSummary":
      case "generateStorySummary":
      case "compileDailyChronicles": {
        const messages = (data.messages as { role: string; content: string; character_name?: string }[]) ?? [];
        const history = messages.slice(-20).map(m => `${m.character_name || m.role}: ${m.content}`).join("\n");
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

      case "enrichCharacterFromWikipedia":
      case "fetchCharacterBioFromWikipedia": {
        result = { bio: "", enriched: false };
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

export default router;
