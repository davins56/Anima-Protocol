import { Router } from "express";
import { toFile } from "openai";
import { getAuth } from "@clerk/express";
import { db, userEntities, makeId } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createRateLimit } from "../../lib/rateLimit";
import { notifyUser } from "../../lib/storeEvents";
import { resolveModel } from "../../lib/modelRouter";
import { createChatCompletionWithFailover } from "../../lib/llmFailover";
import { getOpenAIClient, hasOpenAIKey, hasOpenRouterKey } from "../../lib/openaiClient";
import { searchMemoriesSemantically } from "../../lib/memoryEmbeddings";
import {
  editImageWithGemini,
  generateImageWithGemini,
  hasGeminiImageKey,
  isFreeImageFallbackEnabled,
} from "../../lib/geminiImage";
import {
  editImageWithOpenRouter,
  generateImageWithOpenRouter,
  missingImageProviderError,
} from "../../lib/openrouterImage";
import { logger } from "../../lib/logger";
import { buildInBrowserCodespaceSystemPrompt } from "../../lib/codespaceAgentPrompt";

const router = Router();
// Invoke helpers are chatty during UI bootstrap; key by user and allow headroom.
router.use(createRateLimit({ name: "openai-functions", max: 180 }));
router.use((req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

async function llm(systemPrompt: string, userPrompt: string, maxTokens = 1024): Promise<string> {
  const result = await createChatCompletionWithFailover({
    tier: "standard",
    model: "gpt-4o",
    maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return result.content;
}

// Web search grounding is an OpenAI Responses API feature and chat never
// calls OpenAI (the self-hosted Anima LLM has no equivalent tool), so this
// always resolves to the plain model call.
async function webSearchLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  return llm(systemPrompt, userPrompt);
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

export type GeneratedCompanion = {
  name: string;
  universe: string;
  category: string;
  tagline: string;
  personality: string;
  backstory: string;
  speaking_style: string;
  traits: string;
  is_real_character: boolean;
};

// Tolerant JSON parse of the research-grounded companion generator output.
// Exported so the normalization can be unit-tested without hitting OpenAI.
export function parseCompanion(raw: string): GeneratedCompanion {
  const empty: GeneratedCompanion = {
    name: "",
    universe: "",
    category: "",
    tagline: "",
    personality: "",
    backstory: "",
    speaking_style: "",
    traits: "",
    is_real_character: false,
  };
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return empty;
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const traitsRaw = obj.traits;
    const traits = Array.isArray(traitsRaw)
      ? traitsRaw
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .map((t) => t.trim())
          .join(", ")
      : str(traitsRaw);
    return {
      name: str(obj.name),
      universe: str(obj.universe),
      category: str(obj.category),
      tagline: str(obj.tagline),
      personality: str(obj.personality),
      backstory: str(obj.backstory),
      speaking_style: str(obj.speaking_style),
      traits,
      is_real_character: obj.is_real_character === true,
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
  const result = await createChatCompletionWithFailover({
    tier: "standard",
    model: "gpt-4o",
    maxTokens: 1500,
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
  return parseContextAnalysis(result.content);
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

// --- Narrative inventory persistence ----------------------------------------
// Chat and Interactive Inventory ask the model to notice items that were
// acquired, consumed, or lost in the latest exchange. Those used to be
// acknowledged with a stub `{ success: true }` and never written, so a deploy
// or new device wiped the bag. Rows live as generic store entities
// (`Inventory`) scoped to the Clerk user — the same table conversations use —
// so they survive app updates as long as DATABASE_URL (often Supabase Postgres)
// is set.
const INVENTORY = "Inventory";
const INVENTORY_TYPES = new Set([
  "gear",
  "consumable",
  "weapon",
  "armor",
  "artifact",
  "misc",
]);
const INVENTORY_RARITIES = new Set([
  "common",
  "uncommon",
  "rare",
  "legendary",
]);

export type InventoryItem = Record<string, unknown>;

export type InventoryEvent = {
  action: "acquire" | "lose" | "consume";
  name: string;
  type: string;
  quantity: number;
  description: string;
  rarity: string;
};

function normalizeItemName(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asPositiveInt(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(99, Math.floor(n)));
}

function normalizeInventoryType(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return INVENTORY_TYPES.has(raw) ? raw : "misc";
}

function normalizeInventoryRarity(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return INVENTORY_RARITIES.has(raw) ? raw : "common";
}

type InventoryRow = { entityId: string; item: InventoryItem };

async function loadInventoryItems(
  userId: string,
  characterId: string,
): Promise<InventoryRow[]> {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, INVENTORY),
      ),
    );
  return rows
    .map((row) => ({ entityId: row.entityId, item: (row.data as InventoryItem) ?? {} }))
    .filter(({ item }) => item && item.character_id === characterId)
    .sort((a, b) =>
      String(b.item.created_date ?? "").localeCompare(String(a.item.created_date ?? "")),
    );
}

function parseInventoryEvents(raw: string): InventoryEvent[] {
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
    .map((entry) => {
      const obj = (entry ?? {}) as Record<string, unknown>;
      const actionRaw = String(obj.action ?? "").trim().toLowerCase();
      const action =
        actionRaw === "lose" || actionRaw === "lost" || actionRaw === "drop"
          ? "lose"
          : actionRaw === "consume" || actionRaw === "use" || actionRaw === "used"
            ? "consume"
            : "acquire";
      return {
        action,
        name: typeof obj.name === "string" ? obj.name.trim() : "",
        type: normalizeInventoryType(obj.type),
        quantity: asPositiveInt(obj.quantity, 1),
        description:
          typeof obj.description === "string" ? obj.description.trim() : "",
        rarity: normalizeInventoryRarity(obj.rarity),
      } satisfies InventoryEvent;
    })
    .filter((event) => event.name)
    .slice(0, 5);
}

// Ask the model to list tangible items that actually changed hands in this
// exchange. Returns [] on any parse/LLM failure so a botched extraction never
// blocks chat.
async function extractInventoryEvents(
  userMessage: string,
  aiResponse: string,
  existing: { name?: string; quantity?: unknown }[],
): Promise<InventoryEvent[]> {
  if (!userMessage.trim() && !aiResponse.trim()) return [];
  const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) : s);
  const existingList =
    existing.length > 0
      ? existing
          .slice(0, 40)
          .map((item) => `- ${item.name} (x${asPositiveInt(item.quantity, 1)})`)
          .join("\n")
      : "(none yet)";
  const raw = await llm(
    "You track a character's physical inventory from story. From the latest " +
      "exchange, list tangible items the character newly acquired, was given, " +
      "picked up, crafted, consumed, used up, dropped, or lost. Ignore " +
      "metaphor, feelings, and items that are only mentioned in passing " +
      "without changing possession. Return 0 to 5 objects as a JSON array; " +
      'each object is { "action": "acquire"|"lose"|"consume", "name": string, ' +
      '"type": "gear"|"consumable"|"weapon"|"armor"|"artifact"|"misc", ' +
      '"quantity": number, "description": string, "rarity": ' +
      '"common"|"uncommon"|"rare"|"legendary" }. name is a short title-case ' +
      "item name. If nothing changed hands, return []. Output ONLY the JSON array.",
    `CURRENT INVENTORY:\n${existingList}\n\nLATEST EXCHANGE:\nUser: ${clip(userMessage)}\nCharacter: ${clip(aiResponse)}`,
    512,
  ).catch(() => "[]");
  return parseInventoryEvents(raw);
}

export type InventoryPersistResult = {
  applied: number;
  created: InventoryItem[];
  updated: InventoryItem[];
  removed: InventoryItem[];
  items_acquired: number;
  inventory: InventoryItem[];
};

function emptyInventoryResult(inventory: InventoryItem[] = []): InventoryPersistResult {
  return {
    applied: 0,
    created: [],
    updated: [],
    removed: [],
    items_acquired: 0,
    inventory,
  };
}

async function persistInventoryEvents(
  userId: string,
  characterId: string,
  sessionId: string,
  events: InventoryEvent[],
): Promise<InventoryPersistResult> {
  const current = await loadInventoryItems(userId, characterId);
  const byName = new Map<string, (typeof current)[number]>();
  for (const entry of current) {
    const key = normalizeItemName(entry.item.name);
    if (key && !byName.has(key)) byName.set(key, entry);
  }

  const created: InventoryItem[] = [];
  const updated: InventoryItem[] = [];
  const removed: InventoryItem[] = [];
  let itemsAcquired = 0;
  const now = new Date().toISOString();

  for (const event of events) {
    const key = normalizeItemName(event.name);
    if (!key) continue;
    const existing = byName.get(key);

    if (event.action === "acquire") {
      itemsAcquired += event.quantity;
      if (existing) {
        const nextQty =
          asPositiveInt(existing.item.quantity, 1) + event.quantity;
        const merged: InventoryItem = {
          ...existing.item,
          quantity: nextQty,
          updated_date: now,
        };
        await db
          .update(userEntities)
          .set({ data: merged, updatedAt: new Date() })
          .where(
            and(
              eq(userEntities.userId, userId),
              eq(userEntities.entityName, INVENTORY),
              eq(userEntities.entityId, existing.entityId),
            ),
          );
        existing.item = merged;
        updated.push(merged);
      } else {
        const id = makeId();
        const item: InventoryItem = {
          id,
          character_id: characterId,
          session_id: sessionId || null,
          name: event.name,
          type: event.type,
          quantity: event.quantity,
          equipped: false,
          slot: "none",
          rarity: event.rarity,
          description: event.description,
          source: "narrative",
          created_date: now,
          updated_date: now,
        };
        await db.insert(userEntities).values({
          userId,
          entityName: INVENTORY,
          entityId: id,
          data: item,
        });
        const entry: InventoryRow = { entityId: id, item };
        byName.set(key, entry);
        current.unshift(entry);
        created.push(item);
      }
      continue;
    }

    if (!existing) continue;
    const nextQty = asPositiveInt(existing.item.quantity, 1) - event.quantity;
    if (nextQty <= 0) {
      await db
        .delete(userEntities)
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, INVENTORY),
            eq(userEntities.entityId, existing.entityId),
          ),
        );
      byName.delete(key);
      const idx = current.findIndex((e) => e.entityId === existing.entityId);
      if (idx >= 0) current.splice(idx, 1);
      removed.push(existing.item);
    } else {
      const merged: InventoryItem = {
        ...existing.item,
        quantity: nextQty,
        updated_date: now,
      };
      await db
        .update(userEntities)
        .set({ data: merged, updatedAt: new Date() })
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, INVENTORY),
            eq(userEntities.entityId, existing.entityId),
          ),
        );
      existing.item = merged;
      updated.push(merged);
    }
  }

  const applied = created.length + updated.length + removed.length;
  if (applied > 0) notifyUser(userId);

  const inventory = (await loadInventoryItems(userId, characterId)).map((e) => e.item);
  return {
    applied,
    created,
    updated,
    removed,
    items_acquired: itemsAcquired,
    inventory,
  };
}

async function applyNarrativeInventory(
  userId: string,
  data: Record<string, unknown>,
): Promise<InventoryPersistResult> {
  const characterId =
    typeof data.character_id === "string" ? data.character_id : "";
  if (!characterId) return emptyInventoryResult();

  const userMessage =
    typeof data.user_message === "string"
      ? data.user_message
      : typeof data.message_content === "string"
        ? data.message_content
        : "";
  const aiResponse =
    typeof data.ai_response === "string" ? data.ai_response : "";
  const sessionId =
    typeof data.session_id === "string" ? data.session_id : "";

  const current = await loadInventoryItems(userId, characterId);
  const events = await extractInventoryEvents(
    userMessage,
    aiResponse,
    current.map((e) => ({
      name: String(e.item.name ?? ""),
      quantity: e.item.quantity,
    })),
  );
  if (events.length === 0) {
    return emptyInventoryResult(current.map((e) => e.item));
  }
  return persistInventoryEvents(userId, characterId, sessionId, events);
}

async function processItemLoss(
  userId: string,
  data: Record<string, unknown>,
): Promise<InventoryPersistResult> {
  const characterId =
    typeof data.character_id === "string" ? data.character_id : "";
  const name = typeof data.item_name === "string" ? data.item_name.trim() : "";
  if (!characterId || !name) return emptyInventoryResult();
  const sessionId =
    typeof data.session_id === "string" ? data.session_id : "";
  return persistInventoryEvents(userId, characterId, sessionId, [
    {
      action: "lose",
      name,
      type: "misc",
      quantity: asPositiveInt(data.quantity, 1),
      description: typeof data.reason === "string" ? data.reason : "",
      rarity: "common",
    },
  ]);
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
        const raw = await llm(
          "You are a narrative behavioral analyst. Describe how this character has evolved based on recent events. Return a JSON object with: { evolved_personality: string, growth_areas: string[], updated_motivations: string[], new_vulnerabilities: string[] }. Output ONLY valid JSON.",
          JSON.stringify(data)
        );
        try {
          result = { data: JSON.parse(raw) };
        } catch {
          result = { data: null };
        }
        break;
      }

      case "updateInventory":
      case "applyNarrativeItemEvents": {
        const { userId } = getAuth(req) as { userId: string };
        result = { data: await applyNarrativeInventory(userId, data) };
        break;
      }

      case "processItemLoss": {
        const { userId } = getAuth(req) as { userId: string };
        result = { data: await processItemLoss(userId, data) };
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
        const prompt = ((data.prompt as string) || "").trim();
        if (!prompt) {
          result = { success: false, error: "Please describe the companion you want to create." };
          break;
        }
        // Research-grounded generation: the assistant uses web search to decide
        // whether the description names a real, established character. If so it
        // grounds every field in canonical detail; otherwise it invents a
        // coherent original. Either way the user gets a prefilled, editable
        // profile.
        const raw = await webSearchLLM(
          "You are a character research assistant for an AI-companion app. The user will describe a character they want to create. This may be an established, identifiable character (from fiction, film, TV, anime, games, comics, mythology, or history) OR an original character of their own invention. First use web search to determine whether the description refers to a real, well-known character. If it does, research them and ground EVERY field in accurate, canonical detail. If it is original, invent a vivid, coherent profile faithful to the description. Return ONLY a valid JSON object with exactly these fields: \"name\" (string), \"universe\" (string \u2014 the franchise/world/origin they belong to, or a short evocative origin for an original), \"category\" (string \u2014 a one or two word type such as warrior, detective, sage, trickster), \"tagline\" (string \u2014 a short evocative one-line hook), \"personality\" (string, 2-4 sentences), \"backstory\" (string, 2-4 sentences), \"speaking_style\" (string, 2-4 sentences capturing concrete, imitable details: verbal tics, catchphrases, vocabulary, rhythm, tone, and mannerisms so an AI can convincingly speak as them), \"traits\" (array of 3-6 short trait words), and \"is_real_character\" (boolean \u2014 true only if you grounded the profile in a real, established character you confirmed via research). Do not include markdown, code fences, or any text outside the JSON.",
          `Research and create a companion from this description: ${prompt}`
        );
        const companion = parseCompanion(raw);
        if (!companion.name) {
          result = {
            success: false,
            error: "Could not generate a companion from that description. Try adding more detail.",
          };
          break;
        }
        result = { success: true, companion };
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
        const { userId } = getAuth(req) as { userId: string };
        const query =
          typeof data.query === "string"
            ? data.query
            : typeof data.text === "string"
              ? data.text
              : "";
        const characterId =
          typeof data.character_id === "string" ? data.character_id : undefined;
        const topK =
          typeof data.top_k === "number" && data.top_k > 0
            ? Math.min(48, data.top_k)
            : 12;
        if (!query.trim()) {
          result = { memories: [] };
          break;
        }
        const memories = await searchMemoriesSemantically({
          userId,
          characterId,
          query,
          topK,
        });
        result = { memories };
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

      // Voice replay must not hit the LLM default handler — that call never
      // settles in a useful way. Emotion mapping lives on POST /api/tts.
      case "adjustVoiceEmotionalParameters": {
        result = {
          data: {
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.85,
              style: 0.2,
              speaker_boost: true,
            },
          },
        };
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
        const fileList = Array.isArray(data.files)
          ? (data.files as unknown[]).filter((f): f is string => typeof f === "string")
          : [];

        const systemPrompt = buildInBrowserCodespaceSystemPrompt(character, fileList);

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

        const heavy = resolveModel("heavy");
        const completion = await createChatCompletionWithFailover({
          tier: "heavy",
          model: heavy.model,
          maxTokens: heavy.maxTokens,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: baseMessages as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: tools as any,
        });

        result = {
          message: {
            role: "assistant",
            content: completion.content ?? "",
            tool_calls: completion.toolCalls ?? null,
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

  // Preserve an already-classified missing-provider / auth failure so the
  // client can show the actionable "not configured" copy instead of a generic
  // toast.
  if (rawCode === "auth_error" && rawMessage && !/sk-[A-Za-z0-9_\-*]+/.test(rawMessage)) {
    return {
      status: 503,
      code: "auth_error",
      error: rawMessage,
    };
  }

  // Invalid / missing OpenAI API key — never echo the key material OpenAI
  // includes in the raw 401 message (e.g. "Incorrect API key provided: sk-…").
  if (
    upstreamStatus === 401 ||
    rawCode === "invalid_api_key" ||
    haystack.includes("incorrect api key") ||
    haystack.includes("invalid api key") ||
    haystack.includes("api key provided")
  ) {
    return {
      status: 503,
      code: "auth_error",
      error: "Image generation is temporarily unavailable. Please try again later.",
    };
  }

  // Strip any accidental secret leakage from fallback messages.
  const safeMessage = /sk-[A-Za-z0-9_\-*]+/.test(rawMessage)
    ? "Image generation failed. Please try again later."
    : rawMessage;

  return {
    status: upstreamStatus ?? 500,
    code: "server_error",
    error: safeMessage,
  };
}

/** True when an OpenAI image failure should retry via the free provider. */
export function shouldFallbackToFreeImage(code: string): boolean {
  return (
    code === "auth_error" ||
    code === "rate_limit" ||
    code === "server_error"
  );
}

async function generateImageDataUrl(prompt: string): Promise<{
  image: string;
  provider: "openai" | "gemini" | "openrouter";
}> {
  // Keep headroom for skin-tone hard-requirement blocks from the customiser.
  const trimmed = prompt.trim().slice(0, 2500);
  let lastMapped: ReturnType<typeof mapImageEditError> | null = null;

  // Prefer Gemini Flash Image when configured — it follows skin/hair attributes
  // more reliably for Customise Anima than gpt-image-1.
  if (hasGeminiImageKey() && isFreeImageFallbackEnabled()) {
    try {
      const gemini = await generateImageWithGemini(trimmed);
      return { image: gemini.image, provider: gemini.provider };
    } catch (err) {
      lastMapped = mapImageEditError(err);
      if (lastMapped.code === "content_policy") {
        throw Object.assign(new Error(lastMapped.error), {
          status: lastMapped.status,
          code: lastMapped.code,
        });
      }
      logger.warn(
        { code: lastMapped.code },
        "Gemini image generate failed; falling back",
      );
    }
  }

  if (hasOpenAIKey()) {
    try {
      const result = await getOpenAIClient().images.generate({
        model: "gpt-image-1",
        prompt: trimmed.slice(0, 1000),
        size: "1024x1024",
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) {
        throw Object.assign(new Error("No image was returned."), { status: 502 });
      }
      return {
        image: `data:image/png;base64,${b64}`,
        provider: "openai",
      };
    } catch (err) {
      lastMapped = mapImageEditError(err);
      if (lastMapped.code === "content_policy") {
        throw Object.assign(new Error(lastMapped.error), {
          status: lastMapped.status,
          code: lastMapped.code,
        });
      }
      logger.warn(
        { code: lastMapped.code },
        "OpenAI image generate failed; falling back",
      );
    }
  }

  // Production Worker binds OPENROUTER_API_KEY for chat. Use it for portraits
  // when Gemini / OpenAI image keys are missing or those providers fail.
  if (hasOpenRouterKey()) {
    try {
      const routed = await generateImageWithOpenRouter(trimmed);
      return { image: routed.image, provider: routed.provider };
    } catch (err) {
      lastMapped = mapImageEditError(err);
      throw Object.assign(new Error(lastMapped.error), {
        status: lastMapped.status,
        code: lastMapped.code,
      });
    }
  }

  if (lastMapped) {
    throw Object.assign(new Error(lastMapped.error), {
      status: lastMapped.status,
      code: lastMapped.code,
    });
  }

  const missing = missingImageProviderError();
  throw missing;
}

// AI photo edit: takes a base64 image data URL plus a text prompt and returns
// an AI-transformed version (gpt-image-1 edit). Gated to signed-in users since
// image generation is a paid call. The result is returned as a PNG data URL.
// When OpenAI is unavailable, falls back to Gemini Flash Image edit.
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

  const trimmed = prompt.trim().slice(0, 2500);
  const dataUrl = `data:${mime};base64,${match[2]}`;

  // Prefer Gemini for edits too — better at applying complexion changes.
  if (hasGeminiImageKey() && isFreeImageFallbackEnabled()) {
    try {
      const gemini = await editImageWithGemini(dataUrl, trimmed);
      res.json({ image: gemini.image, provider: gemini.provider });
      return;
    } catch (err) {
      const mapped = mapImageEditError(err);
      if (mapped.code === "content_policy") {
        res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
        return;
      }
      logger.warn(
        { code: mapped.code },
        "Gemini image edit failed; falling back",
      );
    }
  }

  if (hasOpenAIKey()) {
    try {
      const file = await toFile(buffer, `source.${ext}`, { type: mime });
      const result = await getOpenAIClient().images.edit({
        model: "gpt-image-1",
        image: file,
        prompt: trimmed.slice(0, 1000),
        size: "1024x1024",
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) {
        res.status(502).json({ error: "No image was returned." });
        return;
      }
      res.json({ image: `data:image/png;base64,${b64}`, provider: "openai" });
      return;
    } catch (err) {
      const mapped = mapImageEditError(err);
      if (mapped.code === "content_policy") {
        res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
        return;
      }
      logger.warn(
        { code: mapped.code },
        "OpenAI image edit failed; falling back",
      );
    }
  }

  if (hasOpenRouterKey()) {
    try {
      const routed = await editImageWithOpenRouter(dataUrl, trimmed);
      res.json({ image: routed.image, provider: routed.provider });
      return;
    } catch (err) {
      const mapped = mapImageEditError(err);
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
      return;
    }
  }

  const missing = missingImageProviderError();
  res.status(503).json({
    error: missing.message,
    code: "auth_error",
  });
});

// AI image generation from a text prompt. Prefers Gemini Flash Image when
// GEMINI_API_KEY is set; otherwise OpenAI gpt-image-1; otherwise OpenRouter
// (the key already bound on the production Worker for chat).
// Auth is enforced by the router-level middleware above.
router.post("/image-generate", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };

  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "A generation prompt is required." });
    return;
  }

  try {
    const result = await generateImageDataUrl(prompt);
    res.json({ image: result.image, provider: result.provider });
  } catch (err) {
    const mapped = mapImageEditError(err);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

export default router;
