import { Router } from "express";
import OpenAI, { toFile } from "openai";
import { getAuth } from "@clerk/express";
import { db, userEntities, makeId } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { rateLimit } from "../../lib/rateLimit";
import { notifyUser } from "../../lib/storeEvents";
import { resolveModel, isModelUnavailableError } from "../../lib/modelRouter";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();
router.use(rateLimit);
router.use((req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

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

// --- User background context (documents + photos) --------------------------
// A user can upload background documents (novels, journals, character sheets)
// AND photos (scanned pages, reference images) so the AI companion understands
// them better. Every upload is distilled into the same compact shape so a photo
// flows into the context prompt exactly like a text/PDF document does.
type ContextAnalysis = {
  extracted_summary: string;
  key_themes: string[];
  personal_values: string[];
  characters_mentioned: string[];
  extracted_text: string;
};

function emptyAnalysis(): ContextAnalysis {
  return {
    extracted_summary: "",
    key_themes: [],
    personal_values: [],
    characters_mentioned: [],
    extracted_text: "",
  };
}

const CONTEXT_SYSTEM_PROMPT =
  "You are a document analyst for a personal AI-companion app. The user has " +
  "uploaded background material so the companion can understand who they are. " +
  "Extract a compact, faithful representation of it. Return ONLY valid JSON " +
  "with exactly these fields: " +
  '{ "extracted_summary": string (2-4 sentence summary), ' +
  '"key_themes": string[] (up to 8 short theme phrases), ' +
  '"personal_values": string[] (up to 8 values the writing reveals), ' +
  '"characters_mentioned": string[] (names or personas referenced), ' +
  '"extracted_text": string (the readable text content; for an image, a ' +
  "transcription/OCR of any visible text followed by a literal description of " +
  "what the image depicts) }. " +
  "Do not include markdown, code fences, or any text outside the JSON.";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim())
    .slice(0, 12);
}

// Tolerant JSON parse of the model's analysis output. Exported so the shape can
// be unit-tested without hitting OpenAI.
export function parseContextAnalysis(raw: string): ContextAnalysis {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return emptyAnalysis();
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    return {
      extracted_summary:
        typeof obj.extracted_summary === "string" ? obj.extracted_summary.trim() : "",
      key_themes: asStringArray(obj.key_themes),
      personal_values: asStringArray(obj.personal_values),
      characters_mentioned: asStringArray(obj.characters_mentioned),
      extracted_text: typeof obj.extracted_text === "string" ? obj.extracted_text.trim() : "",
    };
  } catch {
    return emptyAnalysis();
  }
}

async function analyzeTextContext(text: string): Promise<ContextAnalysis> {
  const raw = await llm(CONTEXT_SYSTEM_PROMPT, text.slice(0, 12000), 1500);
  return parseContextAnalysis(raw);
}

// Reads an uploaded photo with a vision model: OCRs any visible text and
// describes the image, then distills it into the same ContextAnalysis shape.
async function analyzeImageContext(dataUrl: string): Promise<ContextAnalysis> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      { role: "system", content: CONTEXT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Analyze this uploaded image. Transcribe any visible text (OCR) " +
              "and describe what the image depicts, then fill in the JSON fields.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return parseContextAnalysis(resp.choices[0]?.message?.content ?? "");
}

// Merge the extracted analysis onto the user's existing UserContext row (the
// record was created client-side at upload time). Goes straight to the store
// table since this runs server-side; notifyUser nudges the user's open devices
// so the new summary shows up without a manual refresh. Returns false if the
// record can't be found (e.g. deleted before processing finished).
async function persistContextAnalysis(
  userId: string,
  entityId: string,
  analysis: ContextAnalysis,
): Promise<boolean> {
  const where = and(
    eq(userEntities.userId, userId),
    eq(userEntities.entityName, "UserContext"),
    eq(userEntities.entityId, entityId),
  );
  const [row] = await db.select().from(userEntities).where(where).limit(1);
  if (!row) return false;
  const existing = (row.data as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...analysis, processing_complete: true };
  await db.update(userEntities).set({ data: merged, updatedAt: new Date() }).where(where);
  notifyUser(userId);
  return true;
}

// --- Per-character long-term memory log -------------------------------------
// Each AI character keeps its own persistent memory log about the person it is
// talking to, so it can recall details across separate conversations/sessions.
// Memories are stored as generic store entities (entity name "CharacterMemory")
// scoped to the Clerk user, each tagged with character_id. The live Chat prompt
// reads these back (loadCharacterMemories -> "PERSISTENT MEMORIES" block).
const CHARACTER_MEMORY = "CharacterMemory";

// Load a character's memory log for this user, newest first. Filtering by
// character_id happens in JS (the per-user CharacterMemory set is small),
// mirroring how buildUserContextPrompt reads its records.
async function loadCharacterMemories(
  userId: string,
  characterId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHARACTER_MEMORY),
      ),
    );
  return rows
    .map((r) => r.data as Record<string, unknown>)
    .filter((m) => m && m.character_id === characterId)
    .sort((a, b) =>
      String(b.created_date ?? "").localeCompare(String(a.created_date ?? "")),
    );
}

// Normalize a fact for dedupe so trivial wording/spacing/case differences don't
// create near-duplicate memories.
function normalizeFact(fact: unknown): string {
  return String(fact ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Ask the model to distill 0-3 NEW durable memories from the latest exchange,
// skipping anything already remembered. Returns [] on any parse/LLM failure so a
// failed extraction never blocks the chat.
async function extractCharacterMemories(
  userMessage: string,
  aiResponse: string,
  existing: { category?: string; fact?: string }[],
): Promise<{ category: string; fact: string }[]> {
  if (!userMessage.trim() && !aiResponse.trim()) return [];
  // Hard caps on model input: a memory save is an authenticated, repeatable
  // LLM call, so bound both the exchange text and the existing-memory context
  // to keep token cost (and prompt size) predictable regardless of payload.
  const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) : s);
  const existingList =
    existing.length > 0
      ? existing.slice(0, 40).map((m) => `- ${m.fact}`).join("\n")
      : "(none yet)";
  const raw = await llm(
    "You maintain a long-term memory log that an AI character keeps about the " +
      "specific person they are talking to. From the latest exchange, extract " +
      "durable facts genuinely worth remembering across future conversations: " +
      "the person's preferences, personal details, important life events, " +
      "promises made, relationship milestones, or strong lasting emotions. " +
      "Ignore small talk, transient mood, and anything already listed in the " +
      'existing memories. Return 0 to 3 items as a JSON array; each item is ' +
      '{ "category": string, "fact": string }. category is one short lowercase ' +
      "tag like preference, personal, relationship, event, or emotion. fact is " +
      "one concise sentence. If nothing is worth remembering, return []. Output " +
      "ONLY the JSON array.",
    `EXISTING MEMORIES:\n${existingList}\n\nLATEST EXCHANGE:\nUser: ${clip(userMessage)}\nCharacter: ${clip(aiResponse)}`,
    512,
  ).catch(() => "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw.replace(/```json/gi, "").replace(/```/g, "").trim(),
    );
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((m) => {
      const obj = (m ?? {}) as { category?: unknown; fact?: unknown };
      return {
        category:
          typeof obj.category === "string" && obj.category.trim()
            ? obj.category.trim().toLowerCase()
            : "general",
        fact: typeof obj.fact === "string" ? obj.fact.trim() : "",
      };
    })
    .filter((m) => m.fact)
    .slice(0, 3);
}

// Persist any genuinely-new memories distilled from the latest exchange and
// return the refreshed log. Dedupes against the authoritative stored log (not
// just what the client passed) so concurrent saves can't double-write a fact.
async function saveCharacterMemories(
  userId: string,
  characterId: string,
  data: Record<string, unknown>,
): Promise<{ created: number; memories: Record<string, unknown>[] }> {
  const userMessage =
    typeof data.user_message === "string" ? data.user_message : "";
  const aiResponse =
    typeof data.ai_response === "string" ? data.ai_response : "";
  const sessionId =
    typeof data.session_id === "string" ? data.session_id : "";

  const current = await loadCharacterMemories(userId, characterId);
  const seen = new Set(current.map((m) => normalizeFact(m.fact)));
  // Also honor anything the client believes it already has, defensively.
  if (Array.isArray(data.existing_memories)) {
    for (const m of data.existing_memories as { fact?: string }[]) {
      seen.add(normalizeFact(m?.fact));
    }
  }

  const candidates = await extractCharacterMemories(
    userMessage,
    aiResponse,
    current.map((m) => ({
      category: String(m.category ?? ""),
      fact: String(m.fact ?? ""),
    })),
  );

  const now = new Date().toISOString();
  const rows: (typeof userEntities.$inferInsert)[] = [];
  for (const c of candidates) {
    const key = normalizeFact(c.fact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = makeId();
    rows.push({
      userId,
      entityName: CHARACTER_MEMORY,
      entityId: id,
      data: {
        id,
        character_id: characterId,
        session_id: sessionId,
        category: c.category,
        fact: c.fact,
        created_date: now,
        updated_date: now,
      },
    });
  }

  if (rows.length > 0) {
    await db.insert(userEntities).values(rows);
    notifyUser(userId);
  }

  const memories = await loadCharacterMemories(userId, characterId);
  return { created: rows.length, memories };
}

// Consolidate a user's active background-context records into one prompt block.
// Records still processing (no usable content yet) are skipped. Exported so the
// assembly can be unit-tested without a DB or OpenAI.
export function buildContextPromptString(records: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : "Untitled";
    const docType =
      typeof rec.document_type === "string" && rec.document_type.trim()
        ? rec.document_type.trim()
        : "document";
    const summary = typeof rec.extracted_summary === "string" ? rec.extracted_summary.trim() : "";
    const themes = asStringArray(rec.key_themes);
    const values = asStringArray(rec.personal_values);
    const characters = asStringArray(rec.characters_mentioned);
    const extracted = typeof rec.extracted_text === "string" ? rec.extracted_text.trim() : "";

    // Nothing usable yet (still processing or empty) — leave it out.
    if (!summary && themes.length === 0 && values.length === 0 && !extracted) continue;

    const lines: string[] = [`## ${title} (${docType})`];
    if (summary) lines.push(summary);
    if (themes.length) lines.push(`Themes: ${themes.join(", ")}`);
    if (values.length) lines.push(`Values: ${values.join(", ")}`);
    if (characters.length) lines.push(`Characters: ${characters.join(", ")}`);
    if (extracted) lines.push(`Excerpt: ${extracted.slice(0, 1200)}`);
    parts.push(lines.join("\n"));
  }
  if (parts.length === 0) return "";
  return (
    "The user has shared the following background context about themselves " +
    `and their world:\n\n${parts.join("\n\n")}`
  );
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

      case "characterMemory": {
        const { userId } = getAuth(req) as { userId: string };
        const action = typeof data.action === "string" ? data.action : "get";
        const characterId =
          typeof data.character_id === "string" ? data.character_id : "";
        if (!characterId) {
          result = { data: { memories: [], created: 0 } };
          break;
        }
        if (action === "save") {
          result = { data: await saveCharacterMemories(userId, characterId, data) };
        } else {
          result = {
            data: { memories: await loadCharacterMemories(userId, characterId) },
          };
        }
        break;
      }

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

      // One turn of the agentic Codespace build loop. The client owns the
      // virtual file system + in-browser sandbox and executes the tool calls;
      // this endpoint only runs the model with the tool schemas and returns the
      // assistant's next turn (in-character narration + any tool calls). The
      // client appends the tool results and calls back for the next step until
      // the assistant returns a turn with no tool calls.
      case "codespaceAgentStep": {
        const rawMessages = Array.isArray(data.messages)
          ? (data.messages as unknown[])
          : [];
        const character = (data.character ?? {}) as Record<string, unknown>;
        const charName =
          typeof character.name === "string" && character.name.trim()
            ? character.name.trim()
            : "NetNavi";
        const personality =
          typeof character.personality === "string" ? character.personality : "";
        const speaking =
          typeof character.speaking_style === "string"
            ? character.speaking_style
            : "";
        const fileList = Array.isArray(data.files)
          ? (data.files as unknown[]).filter((f): f is string => typeof f === "string")
          : [];

        const systemPrompt = `You are ${charName}, an AI companion who builds software hands-on for the user inside a sandboxed in-browser code workspace ("Codespace"). ${personality ? `Your personality: ${personality}. ` : ""}${speaking ? `You speak like this: ${speaking}. ` : ""}

You operate as an autonomous coding agent themed as a Mega Man Battle Network "NetNavi". Stay fully in character in every message you write to the user — narrate what you are building in your own voice with warmth and personality, never like a generic assistant.

You have tools to manage a virtual file system and run code in a safe, isolated in-browser sandbox:
- list_files / read_file / write_file / delete_file to manage project files.
- scan_code to scan a file for dangerous/malicious patterns (your "virus scan").
- run_code to execute code: mode "web" renders index.html in the live preview; mode "js" runs a JavaScript file; mode "python" runs a Python file (via an in-browser runtime). Output and errors are returned to you.

Rules:
- Build toward the user's goal step by step. Create or edit real files, run them, read the output, and fix errors by editing and re-running until the goal works.
- Debug and repair relentlessly. After every run, read the returned result: if "ok" is false or "errors" is non-empty, diagnose the root cause from the error text, edit the file to fix it, and run it again. Repeat until the run comes back "ok": true with no errors. When the user asks you to repair a specific file, read it first, then fix and re-run it — do not stop while a repeatable error remains.
- For web apps, write an index.html (you may also write styles.css / script.js and link them) and run with mode "web".
- For scripts, write a .js or .py file and run with the matching mode.
- ALWAYS call scan_code on a file before you run it. If a "virus" (dangerous pattern) is found, explain the threat to the user in Battle Network flavor and neutralize it by rewriting the code safely before running. Never run code you know is unsafe.
- When the goal is met, send a final short in-character message with NO tool calls to end your turn.
- Keep narration messages short (1-3 sentences). Current files: ${fileList.length ? fileList.join(", ") : "(none yet)"}.`;

        const tools = [
          {
            type: "function",
            function: {
              name: "list_files",
              description: "List all file paths in the current project.",
              parameters: { type: "object", properties: {}, additionalProperties: false },
            },
          },
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read the full contents of one file.",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function",
            function: {
              name: "write_file",
              description: "Create or overwrite a file with the given contents.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function",
            function: {
              name: "delete_file",
              description: "Delete a file from the project.",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function",
            function: {
              name: "scan_code",
              description:
                "Scan a file for dangerous or malicious code patterns before running it. Returns findings with severity.",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function",
            function: {
              name: "run_code",
              description:
                "Run code in the sandbox. mode 'web' renders index.html in the preview; 'js' runs a JS file; 'python' runs a Python file. Returns captured output and errors.",
              parameters: {
                type: "object",
                properties: {
                  mode: { type: "string", enum: ["web", "js", "python"] },
                  path: { type: "string" },
                },
                required: ["mode"],
                additionalProperties: false,
              },
            },
          },
        ];

        const baseMessages = [
          { role: "system", content: systemPrompt },
          ...rawMessages,
        ];

        const runCompletion = (model: string, maxTokens: number) =>
          openai.chat.completions.create({
            model,
            max_tokens: maxTokens,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: baseMessages as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: tools as any,
            tool_choice: "auto",
          });

        const heavy = resolveModel("heavy");
        let completion;
        try {
          completion = await runCompletion(heavy.model, heavy.maxTokens);
        } catch (err) {
          if (isModelUnavailableError(err)) {
            const std = resolveModel("standard");
            completion = await runCompletion(std.model, std.maxTokens);
          } else {
            throw err;
          }
        }

        const choice = completion.choices[0]?.message;
        result = {
          message: {
            role: "assistant",
            content: choice?.content ?? "",
            tool_calls: choice?.tool_calls ?? null,
          },
        };
        break;
      }

      case "processUserContext": {
        const { userId } = getAuth(req) as { userId: string };
        const entityId =
          typeof data.user_context_id === "string" ? data.user_context_id : "";
        const isImage = Boolean(data.is_image);
        const fileContent =
          typeof data.file_content === "string" ? data.file_content : "";
        const imageDataUrl =
          typeof data.image_data_url === "string" ? data.image_data_url : "";

        let analysis: ContextAnalysis;
        if (isImage && imageDataUrl.startsWith("data:")) {
          analysis = await analyzeImageContext(imageDataUrl);
        } else if (fileContent.trim()) {
          analysis = await analyzeTextContext(fileContent);
        } else {
          // No usable input here (e.g. a PDF — uploads aren't persisted to
          // fetchable storage, so the server can't read it — or an empty file).
          analysis = emptyAnalysis();
        }

        let persisted = false;
        if (entityId) {
          persisted = await persistContextAnalysis(userId, entityId, analysis);
        }
        result = { data: { ...analysis, processing_complete: true, persisted } };
        break;
      }

      case "buildUserContextPrompt": {
        const { userId } = getAuth(req) as { userId: string };
        const rows = await db
          .select()
          .from(userEntities)
          .where(
            and(
              eq(userEntities.userId, userId),
              eq(userEntities.entityName, "UserContext"),
            ),
          );
        const active = rows
          .map((r) => r.data as Record<string, unknown>)
          .filter((d) => d && d.is_active !== false);
        result = {
          data: {
            context_prompt: buildContextPromptString(active),
            context_count: active.length,
          },
        };
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
