import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  asObject,
  chatMessages,
  chatSessions,
  companionMemories,
  db,
  ensureSchemaOnce,
  makeId,
  migrateSessionMessages,
  sessionIdEq,
  userEntities,
  type MsgData,
} from "@workspace/db";
import { createRateLimit } from "../lib/rateLimit";
import { routeModel } from "../lib/modelRouter";
import {
  createChatStreamWithFailover,
  type LlmBrand,
  type LlmProviderId,
} from "../lib/llmFailover";
import { consumeLlmStream, LlmStreamTimeoutError } from "../lib/consumeLlmStream";
import {
  combineLocalDrafts,
  draftLocalMinds,
  isLocalEnsembleEnabled,
} from "../lib/localEnsemble";
import {
  attachStoredEmbeddings,
  upsertMemoryEmbeddings,
} from "../lib/memoryEmbeddings";
import {
  buildCompanionPrompt,
  type CompanionMemoryRecord,
  type CharacterData,
} from "../lib/promptBuilder";
import {
  incrementConversationCount,
  maybeTriggerMilestoneEvolution,
  loadEvolution,
} from "../lib/evolutionEngine";
import {
  loadRelationshipState,
  maybeTriggerRelationshipEvolution,
} from "../lib/relationshipEngine";
import {
  loadArcState,
  maybeTriggerNarrativeArc,
} from "../lib/narrativeArcEngine";

import {
  initSynchroState,
  evolveSynchroFromUser,
  evolveSynchroFromCompanion,
  serializeSynchroState,
  type SynchroState,
} from "../lib/synchroEngine";
import {
  resolveActiveCharacterId,
  resolveActiveCharacterName,
} from "../lib/chatParticipants";
import {
  selectNextSpeaker,
  type SceneMindCharacter,
  type SceneMindDecision,
} from "../lib/sceneMind";
import { createChatCompletionWithFailover } from "../lib/llmFailover";

const router = Router();

// Only throttle the expensive LLM stream. Lightweight context/memory GETs must
// not burn the same budget (and must not share a collapsed proxy-IP bucket).
router.use(
  "/messages",
  createRateLimit({ name: "chat-messages", max: 60, windowMs: 60_000 }),
);

// Same self-heal as /api/store — chat dual-writes chat_sessions / companion_memories.
router.use(async (_req, _res, next) => {
  try {
    await ensureSchemaOnce();
    next();
  } catch (err) {
    next(err);
  }
});

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

const LLM_OPEN_TIMEOUT_MS = 35_000;
const SSE_HEARTBEAT_MS = 8_000;

function flushSse(res: Response) {
  const flushable = res as Response & { flush?: () => void };
  if (typeof flushable.flush === "function") flushable.flush();
}

function writeSse(res: Response, payload: unknown) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  flushSse(res);
}

function startSseHeartbeat(res: Response): () => void {
  const timer = setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
      flushSse(res);
    } catch {
      // Client gone — the stream closer in `finally` will clean up.
    }
  }, SSE_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function openStreamAbort(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_OPEN_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function streamErrorMessage(err: unknown): string {
  if (err instanceof LlmStreamTimeoutError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);
  if (/aborted|abort/i.test(raw)) {
    return "The companion took too long to reply. Please try again.";
  }
  return raw;
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
        inArray(userEntities.entityName, ["Character", "Anima"]),
        inArray(userEntities.entityId, characterIds),
      ),
    );
  // Prefer Character rows when both exist for the same id; mark Animas clearly
  // so the prompt builder can apply archetype/identity locks.
  const byId = new Map<string, MsgData>();
  for (const row of rows) {
    const data = asObject(row.data);
    const id = String(row.entityId || data.id || "");
    if (!id) continue;
    if (row.entityName === "Anima") {
      const animaData: MsgData = {
        ...data,
        id: data.id || id,
        _isAnima: true,
        universe: data.universe || "Anima",
        category: data.category || data.archetype || "guardian",
      };
      if (!byId.has(id)) byId.set(id, animaData);
      continue;
    }
    byId.set(id, data);
  }
  return characterIds.map((id) => byId.get(String(id))).filter(Boolean) as MsgData[];
}

async function readRecentStoreMessages(
  userId: string,
  sessionId: string,
  limit = 20,
  opts?: { skipMigrate?: boolean },
): Promise<MsgData[]> {
  // Steady-state sessions are already flagged messages_migrated. Skip the
  // advisory lock + session re-read so history load does not block first token.
  if (!opts?.skipMigrate) {
    await db.transaction((tx) => migrateSessionMessages(tx, userId, sessionId));
  }
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

/**
 * Adapts raw DB memory rows into the CompanionMemoryRecord interface
 * expected by the central prompt builder.
 */
function adaptMemories(
  memories: Awaited<ReturnType<typeof loadMemories>>,
): CompanionMemoryRecord[] {
  return memories.map((m) => ({
    characterId: m.characterId,
    summary: m.summary,
    facts: Array.isArray(m.facts) ? m.facts : [],
    emotionalState: m.emotionalState,
    resonanceNotes: m.resonanceNotes,
    updatedAt: m.updatedAt,
  }));
}

/**
 * Adapts raw DB character entity data into the CharacterData interface
 * expected by the central prompt builder.
 */
function adaptCharacters(characters: MsgData[]): CharacterData[] {
  return characters.map((c) => ({
    id: String(c.id || ""),
    name: String(c.name || "Companion"),
    personality: c.personality ? String(c.personality) : undefined,
    speaking_style: c.speaking_style ? String(c.speaking_style) : undefined,
    backstory: c.backstory ? String(c.backstory) : undefined,
    universe: c.universe ? String(c.universe) : undefined,
    archetype: c.archetype ? String(c.archetype) : undefined,
    tagline: c.tagline ? String(c.tagline) : undefined,
    expression_spectrum: c.expression_spectrum,
    _isAnima: Boolean(c._isAnima),
  }));
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

    // Index the new turn fact for hybrid semantic retrieval. Best-effort —
    // chat must not fail if the embedding endpoint / hash path errors.
    try {
      await upsertMemoryEmbeddings({
        userId: params.userId,
        characterId,
        facts: [
          {
            type: fact.type,
            session_id: fact.session_id,
            text: fact.text,
            created_at: fact.created_at,
          },
        ],
      });
    } catch {
      // leave companion_memories row intact; next turn can still use keyword path
    }
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
    readRecentStoreMessages(userId, sessionId, 20, {
      skipMigrate: Boolean(data.messages_migrated),
    }),
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

function toSceneMindCharacters(characters: MsgData[]): SceneMindCharacter[] {
  return characters
    .map((c) => ({
      id: String(c.id || ""),
      name: String(c.name || ""),
      universe: c.universe ? String(c.universe) : null,
      personality: c.personality ? String(c.personality) : null,
    }))
    .filter((c) => c.id && c.name);
}

async function runSceneMindDirector(prompt: string): Promise<string | null> {
  try {
    const routed = routeModel("who speaks next", { deepMode: false });
    const result = await createChatCompletionWithFailover({
      tier: "light",
      model: routed.model,
      maxTokens: 32,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are a narrative director. Reply with ONLY one character's exact name.",
        },
        { role: "user", content: prompt },
      ],
    });
    const name = String(result.content || "")
      .trim()
      .split(/\n/)[0]
      ?.replace(/^["'\s]+|["'\s.]+$/g, "");
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Scene Mind: pick which companion speaks next in a group / crossover chat.
 * Client can call this before assembling a group prompt, or rely on
 * /chat/messages to auto-select when assistant_character_id is omitted.
 */
router.post("/scene-mind", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = req.body as {
    session_id?: string;
    content?: string;
    character_ids?: string[];
    force_character_id?: string | null;
    eligible_character_ids?: string[];
    use_director?: boolean;
    is_continue?: boolean;
    interrupt_chance?: number;
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
  const characterIds = [
    ...new Set(
      (body.character_ids?.length
        ? asStringArray(body.character_ids)
        : sessionCharacterIds
      ).filter(Boolean),
    ),
  ];

  if (characterIds.length === 0) {
    res.status(400).json({ error: "No characters in session" });
    return;
  }

  const [characters, recentMessages] = await Promise.all([
    loadCharacters(userId, characterIds),
    readRecentStoreMessages(userId, sessionId, 24, {
      skipMigrate: Boolean(sessionData.messages_migrated),
    }),
  ]);

  const sceneChars = toSceneMindCharacters(characters);
  const useDirector = body.use_director !== false;
  const decision = await selectNextSpeaker({
    characters: sceneChars,
    recentMessages,
    userMessage: String(body.content ?? ""),
    forceCharacterId: body.force_character_id
      ? String(body.force_character_id)
      : null,
    eligibleCharacterIds: body.eligible_character_ids?.length
      ? asStringArray(body.eligible_character_ids)
      : null,
    useDirector,
    askDirector: useDirector ? runSceneMindDirector : undefined,
    isContinue: Boolean(body.is_continue),
    interruptChance:
      typeof body.interrupt_chance === "number"
        ? body.interrupt_chance
        : undefined,
  });

  if (!decision) {
    res.status(400).json({ error: "Unable to select a speaker" });
    return;
  }

  // Persist last_speaker hint on the session blob for orchestrator / next turns.
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
  if (row) {
    const data = asObject(row.data);
    await db
      .update(userEntities)
      .set({
        data: {
          ...data,
          last_speaker_id: decision.characterId,
          last_speaker_name: decision.characterName,
          scene_mind: {
            reason: decision.reason,
            interrupted: decision.interrupted,
            preferred_character_id: decision.preferredCharacterId,
            at: new Date().toISOString(),
          },
          updated_date: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(userEntities.id, row.id));
  }

  res.json({
    character_id: decision.characterId,
    character_name: decision.characterName,
    reason: decision.reason,
    interrupted: decision.interrupted,
    preferred_character_id: decision.preferredCharacterId,
    last_speaker_id: decision.lastSpeakerId,
    last_speaker_name: decision.lastSpeakerName,
  });
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
    force_character_id?: string | null;
    eligible_character_ids?: string[];
    use_scene_mind?: boolean;
    is_continue?: boolean;
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

  const memoriesPromise = loadMemories(userId, characterIds);
  const hintedCharId =
    (body.force_character_id &&
    characterIds.includes(String(body.force_character_id))
      ? String(body.force_character_id)
      : null) ||
    (body.assistant_character_id &&
    characterIds.includes(String(body.assistant_character_id))
      ? String(body.assistant_character_id)
      : null) ||
    (mode !== "group" && characterIds[0] ? characterIds[0] : null);
  const hintedStatePromise = hintedCharId
    ? Promise.all([
        loadEvolution(hintedCharId, userId),
        loadRelationshipState(hintedCharId, userId),
        loadArcState(hintedCharId, userId),
      ])
    : Promise.resolve([null, null, null] as const);
  const [characters, memories, recentMessages, adaptedMemories, hintedState] =
    await Promise.all([
      loadCharacters(userId, characterIds),
      memoriesPromise,
      readRecentStoreMessages(userId, sessionId, 24, {
        skipMigrate: Boolean(sessionData.messages_migrated),
      }),
      memoriesPromise.then((rows) =>
        attachStoredEmbeddings(userId, adaptMemories(rows)),
      ),
      hintedStatePromise,
    ]);

  const requestedAssistantId = body.assistant_character_id
    ? String(body.assistant_character_id)
    : null;
  const requestedAssistantName = body.assistant_character_name
    ? String(body.assistant_character_name).trim()
    : "";

  const distinctUniverses = new Set(
    characters.map((c) => c.universe).filter(Boolean).map(String),
  ).size;
  const isCrossover = mode === "group" && distinctUniverses >= 2;
  // Embeddings were attached in parallel with session/character loads above.
  const adaptedChars = adaptCharacters(characters);
  // Prefer the client-selected speaker (id, then name). Do NOT fall back to
  // characterIds[0] for multi-character sessions — that rebinds identity to the
  // wrong companion and conflicts with the client's group prompt.
  // Non-participant assistant_character_id values are ignored so prompt context
  // and persisted speaker attribution stay aligned.
  // When group mode has no usable speaker, Scene Mind picks one.
  const forcedSpeakerId = body.force_character_id
    ? String(body.force_character_id)
    : null;
  const requestedParticipantId =
    (forcedSpeakerId && characterIds.includes(forcedSpeakerId)
      ? resolveActiveCharacterId(forcedSpeakerId, characterIds)
      : null) ||
    (requestedAssistantId && characterIds.includes(requestedAssistantId)
      ? resolveActiveCharacterId(requestedAssistantId, characterIds)
      : null);

  let sceneMindDecision: SceneMindDecision | null = null;
  const needsSceneMind =
    mode === "group" &&
    adaptedChars.length > 1 &&
    !requestedParticipantId &&
    !requestedAssistantName &&
    body.use_scene_mind !== false;

  if (needsSceneMind) {
    sceneMindDecision = await selectNextSpeaker({
      characters: toSceneMindCharacters(characters),
      recentMessages,
      userMessage: content,
      forceCharacterId: forcedSpeakerId,
      eligibleCharacterIds: body.eligible_character_ids?.length
        ? asStringArray(body.eligible_character_ids)
        : null,
      useDirector: false,
      askDirector: undefined,
      isContinue: Boolean(body.is_continue),
    });
  }

  const sceneMindId = sceneMindDecision?.characterId ?? null;
  const activeChar =
    (requestedParticipantId
      ? adaptedChars.find((c) => c.id === String(requestedParticipantId))
      : undefined) ||
    (sceneMindId
      ? adaptedChars.find((c) => c.id === String(sceneMindId))
      : undefined) ||
    (requestedAssistantName
      ? adaptedChars.find(
          (c) =>
            String(c.name || "").toLowerCase() ===
            requestedAssistantName.toLowerCase(),
        )
      : undefined) ||
    (adaptedChars.length === 1 ? adaptedChars[0] : undefined);
  const activeCharacterId = activeChar?.id ? String(activeChar.id) : null;
  const activeCharacterName = resolveActiveCharacterName({
    requestedId: requestedParticipantId || sceneMindId,
    resolvedId: activeCharacterId,
    requestedName:
      requestedAssistantName || sceneMindDecision?.characterName || "",
    loadedName: activeChar?.name ?? null,
  });
  const [activeEvolutionRow, activeRelationshipState, activeArcState] =
    activeCharacterId && hintedCharId && activeCharacterId === hintedCharId
      ? hintedState
      : await Promise.all([
          activeCharacterId
            ? loadEvolution(activeCharacterId, userId)
            : Promise.resolve(null),
          activeCharacterId
            ? loadRelationshipState(activeCharacterId, userId)
            : Promise.resolve(null),
          activeCharacterId
            ? loadArcState(activeCharacterId, userId)
            : Promise.resolve(null),
        ]);
  let synchroState: SynchroState | null = null;
  if (activeChar && memories.length > 0) {
    const memForChar = memories.find(
      (m) => m.characterId === String(activeChar.id || ""),
    );
    synchroState = initSynchroState(
      memForChar?.emotionalState as Record<string, unknown> | null,
      memForChar?.resonanceNotes ?? null,
      null,
    );
    if (content) {
      synchroState = evolveSynchroFromUser(synchroState, content);
    }
  }
  const prompt = buildCompanionPrompt({
    systemPrompt: body.system_prompt,
    characters: adaptedChars,
    activeCharacter: activeChar,
    memories: adaptedMemories,
    recentMessages,
    sharedMemory: sessionData.shared_memory,
    mode,
    content,
    isCrossover,
    synchroState,
    evolutionDelta: activeEvolutionRow?.evolutionDelta,
    relationshipState: activeRelationshipState,
    arcState: activeArcState,
  });

  const routed = routeModel(content, {
    deepMode: Boolean(body.deep_mode),
    conversationDepth: recentMessages.length,
  });
  const shouldPersist = body.persist !== false;

  // Open the SSE stream before session dual-write / user persist so first
  // token is not blocked on those DB round-trips.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const stopHeartbeat = startSseHeartbeat(res);

  const preStreamPersist = (async () => {
    await syncTypedSession({
      userId,
      sessionId,
      title: String(sessionData.title || "New session"),
      mode,
      characterIds,
      isCrossover,
      metadata: { source: "chat_api" },
    });
    if (shouldPersist && content.trim()) {
      const userMessage: MsgData = {
        role: "user",
        content,
        timestamp: new Date().toISOString(),
        ...(body.metadata ? { metadata: body.metadata } : {}),
      };
      await appendStoreMessage(userId, sessionId, userMessage);
      await persistTypedMessage({
        userId,
        sessionId,
        role: "user",
        content,
        isCrossover,
        metadata: body.metadata,
      });
    }
  })();

  let fullResponse = "";
  let usedModel = routed.model;
  let usedTier = routed.tier;
  let usedProvider: LlmProviderId = "local";
  let usedBrand: LlmBrand | undefined;
  let failedOver = false;
  let ensembleMinds: string[] | undefined;
  let ensembleCombined = false;
  let streamSucceeded = false;

  const emitDelta = (delta: string) => writeSse(res, { content: delta });
  const emitReasoning = () => writeSse(res, { status: "thinking" });

  try {
    const messages = [{ role: "system" as const, content: prompt }];

    if (isLocalEnsembleEnabled()) {
      writeSse(res, { status: "ensemble", phase: "gathering", minds: [] });
      const drafts = await draftLocalMinds({
        tier: routed.tier,
        maxTokens: routed.maxTokens,
        messages,
      });
      if (!drafts.length) {
        throw new Error("The companion returned an empty reply. Please try again.");
      }
      ensembleMinds = drafts.map((d) => d.label);

      if (drafts.length === 1) {
        // Only one mind produced anything usable — nothing to combine.
        usedModel = drafts[0]!.model;
        usedBrand = "anima";
        fullResponse = drafts[0]!.content;
        writeSse(res, { content: fullResponse });
      } else {
        writeSse(res, {
          status: "ensemble",
          phase: "combining",
          minds: ensembleMinds,
          drafts: drafts.length,
        });
        const completion = await combineLocalDrafts(drafts, messages, {
          tier: routed.tier,
          maxTokens: routed.maxTokens,
        });
        usedModel = completion.model;
        usedTier = completion.tier;
        usedProvider = completion.provider;
        usedBrand = completion.brand;
        failedOver = completion.failedOver;
        ensembleCombined = true;

        const streamed = await consumeLlmStream(completion.stream, {
          onDelta: emitDelta,
          onReasoning: emitReasoning,
        });
        fullResponse = streamed.content;
      }
    } else {
      const open = openStreamAbort();
      let completion;
      try {
        completion = await createChatStreamWithFailover({
          tier: routed.tier,
          model: routed.model,
          maxTokens: routed.maxTokens,
          messages,
          signal: open.signal,
        });
      } finally {
        open.cancel();
      }
      usedModel = completion.model;
      usedTier = completion.tier;
      usedProvider = completion.provider;
      usedBrand = completion.brand;
      failedOver = completion.failedOver;

      const streamed = await consumeLlmStream(completion.stream, {
        onDelta: emitDelta,
        onReasoning: emitReasoning,
      });
      fullResponse = streamed.content;
    }

    // An empty completion used to look like a successful turn on the client
    // (thinking/typing cleared, no visible reply). Fail loudly instead.
    if (!String(fullResponse).trim()) {
      throw new Error("The companion returned an empty reply. Please try again.");
    }

    streamSucceeded = true;
    // Close the SSE as soon as the model is done. Persistence / evolution LLM
    // calls used to run before `done`, so the Chat page stayed on Processing...
    // until those finished (or hung).
    writeSse(res, {
      done: true,
      model: usedModel,
      tier: usedTier,
      provider: usedProvider,
      brand: usedBrand,
      failed_over: failedOver,
      ensemble_minds: ensembleMinds,
      ensemble_combined: ensembleCombined,
      is_crossover: isCrossover,
      assistant_character_id: activeCharacterId,
      assistant_character_name: activeCharacterName,
      scene_mind: sceneMindDecision
        ? {
            reason: sceneMindDecision.reason,
            interrupted: sceneMindDecision.interrupted,
            preferred_character_id: sceneMindDecision.preferredCharacterId,
          }
        : null,
    });
  } catch (err) {
    writeSse(res, { error: streamErrorMessage(err) });
  } finally {
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }

  void (async () => {
    try {
      await preStreamPersist;
    } catch {
      // Dual-write failed; the streamed reply is still valid.
    }
    if (!streamSucceeded || !shouldPersist || !String(fullResponse).trim()) return;

    try {
      const assistantMessage: MsgData = {
        role: "assistant",
        content: fullResponse,
        character_id: activeCharacterId,
        character_name: activeCharacterName,
        timestamp: new Date().toISOString(),
      };
      await appendStoreMessage(userId, sessionId, assistantMessage);
      await persistTypedMessage({
        userId,
        sessionId,
        role: "assistant",
        content: fullResponse,
        characterId: activeCharacterId,
        characterName: activeCharacterName,
        isCrossover,
        metadata: {
          model: usedModel,
          tier: usedTier,
          provider: usedProvider,
          brand: usedBrand,
          failed_over: failedOver,
          ensemble_minds: ensembleMinds,
          ensemble_combined: ensembleCombined,
        },
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

      if (characterIds.length > 0) {
        const isVoidTurn = mode === "void" || Boolean(body.deep_mode);
        const historySummary = `User said: ${truncate(content, 420)}\nCompanion replied: ${truncate(fullResponse, 520)}`;

        for (const animaId of characterIds) {
          const updated = await incrementConversationCount({
            userId,
            animaId,
          });
          const nextCount = Number(updated?.conversationCount ?? 0);

          await maybeTriggerMilestoneEvolution({
            userId,
            animaId,
            conversationCount: nextCount,
            historySummary,
            isVoidTurn,
          });

          await maybeTriggerRelationshipEvolution({
            userId,
            animaId,
            conversationCount: nextCount,
            historySummary,
            isVoidTurn,
          });

          await maybeTriggerNarrativeArc({
            userId,
            animaId,
            conversationCount: nextCount,
            content: historySummary,
          });
        }
      }
      if (synchroState && fullResponse) {
        const evolved = evolveSynchroFromCompanion(synchroState, fullResponse);
        const serialized = serializeSynchroState(evolved);
        for (const cid of characterIds) {
          await db
            .update(companionMemories)
            .set({
              emotionalState: serialized,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(companionMemories.userId, userId),
                eq(companionMemories.characterId, cid),
              ),
            );
        }
      }
    } catch (persistErr) {
      console.warn("[chat] post-stream persist failed:", persistErr);
    }
  })();
});

export default router;
