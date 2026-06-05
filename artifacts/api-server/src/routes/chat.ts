import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import OpenAI from "openai";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  asObject,
  chatMessages,
  chatSessions,
  companionMemories,
  db,
  makeId,
  migrateSessionMessages,
  sessionIdEq,
  userEntities,
  type MsgData,
} from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";
import {
  isModelUnavailableError,
  resolveModel,
  routeModel,
} from "../lib/modelRouter";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = Router();

router.use(rateLimit);

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function truncate(value: unknown, max = 600): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

async function loadStoreSession(userId: string, sessionId: string) {
  const [row] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, sessionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadCharacters(userId: string, characterIds: string[]) {
  if (characterIds.length === 0) return [];
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, "Character"),
        inArray(userEntities.entityId, characterIds),
      ),
    );
  return rows.map((row) => asObject(row.data));
}

async function readRecentStoreMessages(
  userId: string,
  sessionId: string,
  limit = 20,
): Promise<MsgData[]> {
  await db.transaction((tx) => migrateSessionMessages(tx, userId, sessionId));
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        sessionIdEq(sessionId),
      ),
    )
    .orderBy(sql`(${userEntities.data} ->> 'seq')::numeric desc`)
    .limit(limit);
  return rows.map((row) => row.data as MsgData).reverse();
}

async function appendStoreMessage(
  userId: string,
  sessionId: string,
  message: MsgData,
): Promise<MsgData> {
  return db.transaction(async (tx) => {
    await migrateSessionMessages(tx, userId, sessionId);
    const [agg] = await tx
      .select({
        maxSeq: sql<string>`coalesce(max((${userEntities.data} ->> 'seq')::numeric), -1)`,
      })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      );
    const seq = Number(agg?.maxSeq ?? -1) + 1;
    const now = new Date().toISOString();
    const msg = asObject(message);
    const id = String(msg.id ?? makeId());
    const data: MsgData = {
      ...msg,
      id,
      session_id: sessionId,
      seq,
      created_date: msg.created_date ?? msg.timestamp ?? now,
      updated_date: now,
    };
    await tx.insert(userEntities).values({
      userId,
      entityName: CHAT_MESSAGE,
      entityId: id,
      data,
    });
    return data;
  });
}

async function syncTypedSession(params: {
  userId: string;
  sessionId: string;
  title: string;
  mode: string;
  characterIds: string[];
  isCrossover: boolean;
  metadata?: Record<string, unknown>;
}) {
  await db
    .insert(chatSessions)
    .values({
      id: params.sessionId,
      userId: params.userId,
      title: params.title || "New session",
      mode: params.mode || "solo",
      characterIds: params.characterIds,
      isCrossover: params.isCrossover,
      metadata: params.metadata ?? {},
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: chatSessions.id,
      set: {
        title: params.title || "New session",
        mode: params.mode || "solo",
        characterIds: params.characterIds,
        isCrossover: params.isCrossover,
        metadata: params.metadata ?? {},
        updatedAt: new Date(),
      },
    });
}

async function persistTypedMessage(params: {
  userId: string;
  sessionId: string;
  role: string;
  content: string;
  characterId?: string | null;
  characterName?: string | null;
  isCrossover: boolean;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(chatMessages).values({
    id: makeId(),
    sessionId: params.sessionId,
    userId: params.userId,
    role: params.role,
    content: params.content,
    characterId: params.characterId ?? null,
    characterName: params.characterName ?? null,
    isCrossover: params.isCrossover,
    metadata: params.metadata ?? {},
  });
}

async function updateStoreSessionMetadata(
  userId: string,
  sessionId: string,
  content: string,
  sharedFact?: Record<string, unknown>,
) {
  const [row] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, sessionId),
      ),
    )
    .limit(1);
  if (!row) return;
  const data = asObject(row.data);
  const now = new Date().toISOString();
  const currentSharedMemory = Array.isArray(data.shared_memory)
    ? data.shared_memory.slice(-24)
    : [];
  if (sharedFact) currentSharedMemory.push(sharedFact);
  await db
    .update(userEntities)
    .set({
      data: {
        ...data,
        last_message: truncate(content, 80),
        title: data.title || truncate(content, 40) || "New session",
        shared_memory: currentSharedMemory,
        updated_date: now,
      },
      updatedAt: new Date(),
    })
    .where(eq(userEntities.id, row.id));
}

async function loadMemories(userId: string, characterIds: string[]) {
  if (characterIds.length === 0) return [];
  return db
    .select()
    .from(companionMemories)
    .where(
      and(
        eq(companionMemories.userId, userId),
        inArray(companionMemories.characterId, characterIds),
      ),
    )
    .orderBy(desc(companionMemories.updatedAt));
}

function buildMemoryBlock(
  memories: Awaited<ReturnType<typeof loadMemories>>,
  characters: MsgData[],
): string {
  if (memories.length === 0) return "";
  const names = new Map(characters.map((c) => [String(c.id), String(c.name)]));
  const body = memories
    .map((memory) => {
      const facts = Array.isArray(memory.facts)
        ? memory.facts
            .slice(-8)
            .map((fact) =>
              typeof fact === "object" && fact
                ? truncate((fact as { text?: unknown }).text ?? JSON.stringify(fact), 220)
                : truncate(fact, 220),
            )
            .filter(Boolean)
        : [];
      return [
        `${names.get(memory.characterId) || memory.characterId}:`,
        memory.summary ? `Summary: ${truncate(memory.summary, 500)}` : "",
        memory.resonanceNotes
          ? `Resonance: ${truncate(memory.resonanceNotes, 300)}`
          : "",
        facts.length ? `Recent memory facts:\n- ${facts.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return `LONG-TERM COMPANION MEMORY:\n${body}`;
}

function buildCharacterBlock(characters: MsgData[]): string {
  if (characters.length === 0) return "";
  return characters
    .map((char) =>
      [
        `${char.name || "Companion"}${char.universe ? ` (${char.universe})` : ""}`,
        char.personality ? `Personality: ${truncate(char.personality, 700)}` : "",
        char.backstory ? `Backstory: ${truncate(char.backstory, 700)}` : "",
        char.speaking_style ? `Voice: ${truncate(char.speaking_style, 350)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function buildSharedMemoryBlock(sharedMemory: unknown): string {
  if (!Array.isArray(sharedMemory) || sharedMemory.length === 0) return "";
  const facts = sharedMemory
    .slice(-12)
    .map((fact) =>
      typeof fact === "object" && fact
        ? truncate((fact as { text?: unknown }).text ?? JSON.stringify(fact), 260)
        : truncate(fact, 260),
    )
    .filter(Boolean);
  return facts.length ? `SHARED SESSION MEMORY:\n- ${facts.join("\n- ")}` : "";
}

function buildPrompt(params: {
  systemPrompt?: string;
  characters: MsgData[];
  memories: Awaited<ReturnType<typeof loadMemories>>;
  recentMessages: MsgData[];
  sharedMemory?: unknown;
  mode: string;
  content: string;
}) {
  const history = params.recentMessages
    .slice(-16)
    .map((message) => {
      const speaker =
        message.role === "user"
          ? "User"
          : String(message.character_name || message.characterName || "Companion");
      return `${speaker}: ${truncate(message.content, 900)}`;
    })
    .join("\n");
  const characterBlock = buildCharacterBlock(params.characters);
  const memoryBlock = buildMemoryBlock(params.memories, params.characters);
  const sharedMemoryBlock = buildSharedMemoryBlock(params.sharedMemory);
  const fallback =
    params.mode === "group"
      ? "You are orchestrating a multi-character companion scene. Keep every character's voice distinct, let them respond naturally to each other, and label spoken turns with the character name."
      : "You are a sovereign AI companion. Stay in character, remember the relationship, and respond naturally with emotional continuity.";

  return [
    params.systemPrompt || fallback,
    characterBlock ? `CHARACTER CONTEXT:\n${characterBlock}` : "",
    memoryBlock,
    sharedMemoryBlock,
    history ? `RECENT SESSION HISTORY:\n${history}` : "",
    `LATEST USER MESSAGE:\n${params.content || "(continue the scene)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function upsertTurnMemory(params: {
  userId: string;
  characterIds: string[];
  sessionId: string;
  userContent: string;
  assistantContent: string;
}) {
  if (params.characterIds.length === 0 || !params.assistantContent.trim()) return;
  const now = new Date();
  const fact = {
    type: "turn",
    session_id: params.sessionId,
    text: `User: ${truncate(params.userContent, 240)} | Companion: ${truncate(
      params.assistantContent,
      320,
    )}`,
    created_at: now.toISOString(),
  };
  for (const characterId of params.characterIds) {
    const [existing] = await db
      .select()
      .from(companionMemories)
      .where(
        and(
          eq(companionMemories.userId, params.userId),
          eq(companionMemories.characterId, characterId),
        ),
      )
      .limit(1);
    const facts = Array.isArray(existing?.facts) ? existing.facts.slice(-24) : [];
    facts.push(fact);
    await db
      .insert(companionMemories)
      .values({
        userId: params.userId,
        characterId,
        summary: existing?.summary ?? "",
        facts,
        emotionalState: existing?.emotionalState ?? {},
        resonanceNotes: existing?.resonanceNotes ?? "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          companionMemories.userId,
          companionMemories.characterId,
        ],
        set: {
          facts,
          updatedAt: now,
        },
      });
  }
}

router.get("/sessions/:sessionId/context", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const sessionId = req.params.sessionId;
  const session = await loadStoreSession(userId, sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const data = asObject(session.data);
  const characterIds = [
    ...asStringArray(data.group_character_ids),
    ...(data.character_id ? [String(data.character_id)] : []),
  ];
  const uniqueCharacterIds = [...new Set(characterIds)];
  const [characters, memories, recentMessages] = await Promise.all([
    loadCharacters(userId, uniqueCharacterIds),
    loadMemories(userId, uniqueCharacterIds),
    readRecentStoreMessages(userId, sessionId, 20),
  ]);
  res.json({
    session: data,
    characters,
    memories,
    recent_messages: recentMessages,
  });
});

router.get("/memories/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const [memory] = await db
    .select()
    .from(companionMemories)
    .where(
      and(
        eq(companionMemories.userId, userId),
        eq(companionMemories.characterId, req.params.characterId),
      ),
    )
    .limit(1);
  res.json({ memory: memory ?? null });
});

router.post("/messages", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = req.body as {
    session_id?: string;
    content?: string;
    character_id?: string | null;
    character_ids?: string[];
    assistant_character_id?: string | null;
    assistant_character_name?: string | null;
    mode?: string;
    system_prompt?: string;
    deep_mode?: boolean;
    persist?: boolean;
    metadata?: Record<string, unknown>;
  };
  const sessionId = body.session_id;
  if (!sessionId) {
    res.status(400).json({ error: "session_id is required" });
    return;
  }

  const session = await loadStoreSession(userId, sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const sessionData = asObject(session.data);
  const sessionCharacterIds = [
    ...asStringArray(sessionData.group_character_ids),
    ...(sessionData.character_id ? [String(sessionData.character_id)] : []),
  ];
  const requestedIds = [
    ...asStringArray(body.character_ids),
    ...(body.character_id ? [String(body.character_id)] : []),
  ];
  const characterIds = [
    ...new Set((requestedIds.length ? requestedIds : sessionCharacterIds).filter(Boolean)),
  ];
  const mode = body.mode || String(sessionData.mode || "solo");
  const content = String(body.content ?? "");

  const [characters, memories, recentMessages] = await Promise.all([
    loadCharacters(userId, characterIds),
    loadMemories(userId, characterIds),
    readRecentStoreMessages(userId, sessionId, 24),
  ]);
  const distinctUniverses = new Set(
    characters.map((c) => c.universe).filter(Boolean).map(String),
  ).size;
  const isCrossover = mode === "group" && distinctUniverses >= 2;
  const prompt = buildPrompt({
    systemPrompt: body.system_prompt,
    characters,
    memories,
    recentMessages,
    sharedMemory: sessionData.shared_memory,
    mode,
    content,
  });
  const routed = routeModel(content, {
    deepMode: Boolean(body.deep_mode),
    conversationDepth: recentMessages.length,
  });
  const standard = resolveModel("standard");
  const shouldPersist = body.persist !== false;

  await syncTypedSession({
    userId,
    sessionId,
    title: String(sessionData.title || "New session"),
    mode,
    characterIds,
    isCrossover,
    metadata: { source: "chat_api" },
  });

  let persistedUser: MsgData | null = null;
  if (shouldPersist && content.trim()) {
    const userMessage: MsgData = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    };
    persistedUser = await appendStoreMessage(userId, sessionId, userMessage);
    await persistTypedMessage({
      userId,
      sessionId,
      role: "user",
      content,
      isCrossover,
      metadata: body.metadata,
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let fullResponse = "";
  let usedModel = routed.model;
  let usedTier = routed.tier;

  try {
    let stream;
    try {
      stream = await openai.chat.completions.create({
        model: routed.model,
        max_tokens: routed.maxTokens,
        messages: [{ role: "system", content: prompt }],
        stream: true,
      });
    } catch (modelErr) {
      if (routed.model !== standard.model && isModelUnavailableError(modelErr)) {
        usedModel = standard.model;
        usedTier = standard.tier;
        stream = await openai.chat.completions.create({
          model: standard.model,
          max_tokens: standard.maxTokens,
          messages: [{ role: "system", content: prompt }],
          stream: true,
        });
      } else {
        throw modelErr;
      }
    }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      fullResponse += delta;
      res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
    }

    let persistedAssistant: MsgData | null = null;
    if (shouldPersist) {
      const assistantMessage: MsgData = {
        role: "assistant",
        content: fullResponse,
        character_id: body.assistant_character_id ?? body.character_id ?? null,
        character_name: body.assistant_character_name ?? null,
        timestamp: new Date().toISOString(),
      };
      persistedAssistant = await appendStoreMessage(
        userId,
        sessionId,
        assistantMessage,
      );
      await persistTypedMessage({
        userId,
        sessionId,
        role: "assistant",
        content: fullResponse,
        characterId: body.assistant_character_id ?? body.character_id ?? null,
        characterName: body.assistant_character_name ?? null,
        isCrossover,
        metadata: { model: usedModel, tier: usedTier },
      });
      const sharedFact = isCrossover
        ? {
            type: "crossover_turn",
            text: `User: ${truncate(content, 180)} | Reply: ${truncate(fullResponse, 260)}`,
            created_at: new Date().toISOString(),
          }
        : undefined;
      await updateStoreSessionMetadata(
        userId,
        sessionId,
        content || fullResponse,
        sharedFact,
      );
      await upsertTurnMemory({
        userId,
        characterIds,
        sessionId,
        userContent: content,
        assistantContent: fullResponse,
      });
    }

    res.write(
      `data: ${JSON.stringify({
        done: true,
        model: usedModel,
        tier: usedTier,
        is_crossover: isCrossover,
        messages: [persistedUser, persistedAssistant].filter(Boolean),
      })}\n\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
