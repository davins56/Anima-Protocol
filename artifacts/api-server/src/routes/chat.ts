import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  asObject,
  chatMessages,
 chatSessions,
 companionMemories,
 memoryEmbeddings,
 db,
  ensureSchemaOnce,
  resetEnsureSchemaLatch,
  withTransientDbRetry,
  makeId,
  migrateSessionMessages,
  sessionIdEq,
  userEntities,
  userProfiles,
  type ChatTurn,
  type MsgData,
} from "@workspace/db";
import { createRateLimit } from "../lib/rateLimit";
import {
  retrieveRepositoryKnowledge,
  shouldRetrieveRepositoryKnowledge,
} from "../lib/repositoryKnowledge";
import { routeModel } from "../lib/modelRouter";
import {
  createChatStreamWithFailover,
  isLocalOnlyProviderChain,
  usesFreeTierOpenBudget,
  type LlmBrand,
  type LlmProviderId,
} from "../lib/llmFailover";
import { retrievePdfContext } from "../lib/pdf/store";
import {
  consumeLlmStream,
  LlmStreamTimeoutError,
} from "../lib/consumeLlmStream.js";
import {
  armAbandonedGenerateAbort,
  chatReplyMaxTokens,
  CLIENT_DISCONNECT_GRACE_MS,
  combineAbortSignals,
  llmChatMessagesFirstChunkMs,
  llmChatMessagesOpenTimeoutMs,
  llmChatMessagesStreamTotalMs,
  llmCompanionDurableWaitMs,
  llmProducingGenerateHardCapMs,
  openStreamAbort,
  repeatRetryBudgetMs,
  shouldRegenerateRepeatedReply,
  watchClientLeave,
} from "../lib/chatTimeouts";
import { hintLocalLlmWarm } from "../lib/localLlmWarm";
import {
  COMPANION_CHAT_TEMPERATURE,
  OLLAMA_MAX_TEMPERATURE,
} from "../lib/ollamaChat";
import {
  combineLocalDrafts,
  draftLocalMinds,
  isLocalEnsembleEnabled,
} from "../lib/localEnsemble";
import {
  attachStoredEmbeddings,
  factIdFor,
  upsertMemoryEmbeddings,
} from "../lib/memoryEmbeddings";
import {
  appendFinalUserReminder,
  composeCompanionChatMessages,
  isRepeatedReply,
  LOCAL_EXTRA_GENERATION_MAX_TOKENS,
  LOCAL_REPEAT_DETECT_CHARS,
  matchingRepeatedReply,
  messagesForRepeatRetry,
  recentAssistantReplies,
  visiblePrefixRepeatsHistory,
  type CompanionMemoryRecord,
  type CharacterData,
} from "../lib/promptBuilder";
import { beginCompanionLlmTurn, companionTurnsOpenForUser } from "../lib/sidecarLlm";
import { localLlmSlotEnabled, waitForLocalChatSlot } from "../lib/localLlmSlot";
import {
  inCharacterRetryReminder,
  isStockAssistantLine,
  noteStockAssistantLine,
  pronounFromPersona,
  stockAssistantDeflection,
} from "../lib/stockAssistantLine";
import { extractOperatorModelFromProfile } from "../lib/operatorModel";
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
  initCompanionAffect,
  evolveCompanionAffectFromUser,
  evolveCompanionAffectFromCompanion,
  serializeCompanionAffect,
  toCompanionAffectSnapshot,
  companionAffectSnapshotFromEmotionalState,
  synchroStrengthFromEmotionalState,
  type CompanionAffect,
} from "../lib/companionAffect";
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
import {
  fetchRegionalWorldKnowledge,
  formatRegionalWorldKnowledge,
  geoFromRequest,
  peekRegionalWorldKnowledge,
  regionHintsFromProfile,
  resolveUserRegion,
  type RegionHints,
} from "../lib/regionalWorldKnowledge";
import { resolveChatModePolicy } from "../lib/chatModeRegistry";
import {
  assessTherapySafety,
  crisisResourceForCountry,
} from "../lib/therapySafety";
import { ChatPipelineTelemetry } from "../lib/chatTelemetry";
import { streamErrorMessage } from "../lib/chatStreamError";
import { optionalChatContext } from "../lib/optionalChatContext";
import { classifyDbError, errorCauseBlob } from "../lib/dbErrors";
import {
  finalizeAssistantReply,
  trimToLastCompleteSentence,
} from "../lib/visibleAssistantReply";
import {
  OWN_MODEL_EMPTY_REPLY,
  OWN_MODEL_ID,
  ownModelAccess,
  readModelState,
} from "../lib/ownModel";
import {
  beginChatTurn,
  chatTurnHasRemoteWaiter,
  checkpointGeneratedTurn,
  claimChatTurnLease,
  classifyChatTurnReuse,
  decideDurableTurnJoin,
  latestOpenChatTurn,
  markChatTurnWaiting,
  markTurnCommitted,
  markTurnFailed,
  normalizeTurnId,
  readChatTurn,
  renewChatTurnLease,
  retryableChatTurns,
  userHasOtherPendingChatTurn,
  type PersistenceOwner,
} from "../lib/chatTurnLedger";
import {
  ChatTurnFlightElsewhere,
  chatTurnFlightWaiters,
  isChatTurnFlightElsewhere,
  reserveChatTurnFlight,
  type ChatTurnFlightOutcome,
  type ChatTurnFlightReservation,
} from "../lib/chatTurnFlight";
import { planTurnMessageSeqs, type SeqRow } from "../lib/chatMessageOrder";
import {
  emotionalStateWithTurnBond,
  emotionalStateWithTurnMood,
  moodTurnAlreadyWritten,
  relationshipTurnAlreadyWritten,
  savedMomentsTurnAlreadyWritten,
} from "../lib/turnMoodWrite";
import { scheduleWorkerBackground } from "../lib/workerBackground";
import { logger } from "../lib/logger";
import {
  shouldCrystallize,
  crystallizeResonanceMemory,
} from "../lib/resonanceMemories";
import {
  loadIntimacyProfile,
  saveIntimacyProfile,
  loadIntimacyScene,
  saveIntimacyScene,
} from "../lib/intimacyStore";
import { evaluateTurn, decayHeat } from "../lib/intimacyEngine";
import type {
  IntimacyProfile,
  IntimacyScene,
  IntimacyTurnResult,
} from "../lib/intimacyTypes";

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
    await withTransientDbRetry(() => ensureSchemaOnce());
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

const SSE_HEARTBEAT_MS = 8_000;

type ChatSsePhase = "preparing" | "waking" | "generating";

function flushSse(res: Response) {
  const flushable = res as Response & { flush?: () => void };
  if (typeof flushable.flush === "function") flushable.flush();
}

function writeSse(res: Response, payload: unknown) {
  if (res.writableEnded) return;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    flushSse(res);
  } catch {
    // The browser left. Keep generating and save the reply when it arrives.
  }
}

function replayFlightOutcome(turn: ChatTurn): ChatTurnFlightOutcome {
  const content = String(turn.assistantContent || "");
  return {
    content,
    done: {
      done: true,
      visible: content,
      turn_id: turn.id,
      persistence_status: turn.status,
      replayed: true,
      joined: true,
    },
  };
}

function writeFlightSse(res: Response, outcome: ChatTurnFlightOutcome) {
  const sse = openChatSse(res);
  try {
    if (outcome.content) writeSse(res, { content: outcome.content });
    writeSse(res, outcome.done);
  } finally {
    sse.stop();
    if (!res.writableEnded) res.end();
  }
}

const DURABLE_JOIN_POLL_MS = 1_000;

/**
 * Wait on the ledger row for this turn_id. A live lease means another
 * isolate is generating; an expired lease is claimed here so the turn cannot
 * stay pending after the owner dies.
 */
async function awaitDurableTurnOwner(input: {
  turn: ChatTurn;
  content: string;
  stillWaiting: () => boolean;
}): Promise<
  | { action: "replay"; outcome: ChatTurnFlightOutcome }
  | { action: "generate"; turn: ChatTurn }
> {
  const deadline = Date.now() + llmCompanionDurableWaitMs();
  let turn = input.turn;
  while (input.stillWaiting()) {
    const decision = decideDurableTurnJoin(turn, input.content, Date.now());
    if (decision === "conflict") throw new ChatTurnFlightElsewhere();
    if (decision === "replay") {
      return { action: "replay", outcome: replayFlightOutcome(turn) };
    }
    if (decision === "claim") {
      const claimed = await claimChatTurnLease(turn.id, turn.userId);
      if (claimed) {
        const latest = await readChatTurn(turn.id, turn.userId);
        return { action: "generate", turn: latest ?? turn };
      }
    } else {
      await markChatTurnWaiting(
        turn.id,
        turn.userId,
        CLIENT_DISCONNECT_GRACE_MS,
      );
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, DURABLE_JOIN_POLL_MS));
    const latest = await readChatTurn(turn.id, turn.userId);
    if (!latest) throw new ChatTurnFlightElsewhere();
    turn = latest;
  }
  if (!input.stillWaiting()) throw new ChatTurnFlightElsewhere();
  if (await claimChatTurnLease(turn.id, turn.userId)) {
    const latest = await readChatTurn(turn.id, turn.userId);
    return { action: "generate", turn: latest ?? turn };
  }
  throw new ChatTurnFlightElsewhere();
}

async function streamDurableFollow(
  res: Response,
  flight: ChatTurnFlightReservation,
  work: ReturnType<typeof awaitDurableTurnOwner>,
): Promise<
  | { action: "finished" }
  | {
      action: "generate";
      turn: ChatTurn;
      sse: ReturnType<typeof openChatSse>;
    }
> {
  const sse = openChatSse(res);
  let handoff = false;
  try {
    const result = await work;
    if (result.action === "replay") {
      flight.resolve(result.outcome);
      if (result.outcome.content) writeSse(res, { content: result.outcome.content });
      writeSse(res, { ...result.outcome.done, joined: true, replayed: true });
      return { action: "finished" };
    }
    handoff = true;
    return { action: "generate", turn: result.turn, sse };
  } catch (err) {
    if (isChatTurnFlightElsewhere(err)) {
      flight.abandon();
    } else {
      flight.fail(err);
    }
    writeSse(res, { error: streamErrorMessage(err) });
    return { action: "finished" };
  } finally {
    if (!handoff) {
      sse.stop();
      try {
        if (!res.writableEnded) res.end();
      } catch {
        // The joiner already left.
      }
    }
  }
}

async function writeJoinedTurn(
  res: Response,
  result: Promise<ChatTurnFlightOutcome>,
) {
  try {
    const outcome = await result;
    writeFlightSse(res, { ...outcome, done: { ...outcome.done, joined: true } });
  } catch (err) {
    if (isChatTurnFlightElsewhere(err)) {
      res.status(409).json({
        error: "This chat turn is already being processed.",
        code: "turn_in_flight",
      });
      return;
    }
    const sse = openChatSse(res);
    try {
      writeSse(res, { error: streamErrorMessage(err) });
    } finally {
      sse.stop();
      if (!res.writableEnded) res.end();
    }
  }
}

function writeSseComment(res: Response, comment: string) {
  if (res.writableEnded) return;
  try {
    res.write(`: ${comment}\n\n`);
    flushSse(res);
  } catch {
    // Client gone — the stream closer in `finally` will clean up.
  }
}

function writeProgressSse(
  res: Response,
  phase: ChatSsePhase,
  startedAt: number,
) {
  writeSse(res, {
    status: "progress",
    phase,
    elapsed_ms: Date.now() - startedAt,
  });
}

/** Open SSE and send a heartbeat byte before any context work. */
function openChatSse(res: Response): {
  stop: () => void;
  setPhase: (phase: ChatSsePhase) => void;
  markStreaming: () => void;
  pauseProgress: () => void;
  resumeProgress: () => void;
} {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const startedAt = Date.now();
  let phase: ChatSsePhase = "preparing";
  let streaming = false;
  let progressPaused = false;
  writeSseComment(res, `keepalive ${startedAt}`);
  writeProgressSse(res, phase, startedAt);
  const timer = setInterval(() => {
    writeSseComment(res, `keepalive ${Date.now()}`);
    if (!streaming && !progressPaused) writeProgressSse(res, phase, startedAt);
  }, SSE_HEARTBEAT_MS);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    setPhase: (next) => {
      phase = next;
      if (!streaming && !progressPaused) writeProgressSse(res, phase, startedAt);
    },
    markStreaming: () => {
      streaming = true;
    },
    pauseProgress: () => {
      progressPaused = true;
    },
    resumeProgress: () => {
      progressPaused = false;
    },
  };
}

function isMissingRelationError(err: unknown): boolean {
  const blob = errorCauseBlob(err);
  if (!/companion_memories/i.test(blob)) return false;
  const info = classifyDbError(err);
  return (
    info.code === "42P01" ||
    /relation .*companion_memories.* does not exist/i.test(blob) ||
    /companion_memories[\s\S]*does not exist|does not exist[\s\S]*companion_memories/i.test(
      blob,
    )
  );
}

/** Scalar binds only — drizzle `inArray` emits `IN ($n)` with a JS array. */
function matchCharacterIds(characterIds: string[]) {
  if (characterIds.length === 1) {
    return eq(companionMemories.characterId, characterIds[0]!);
  }
  return or(
    ...characterIds.map((id) => eq(companionMemories.characterId, id)),
  )!;
}

function matchEntityIds(characterIds: string[]) {
  if (characterIds.length === 1) {
    return eq(userEntities.entityId, characterIds[0]!);
  }
  return or(...characterIds.map((id) => eq(userEntities.entityId, id)))!;
}

async function queryCompanionMemories(userId: string, characterIds: string[]) {
  return db
    .select()
    .from(companionMemories)
    .where(
      and(
        eq(companionMemories.userId, userId),
        matchCharacterIds(characterIds),
      ),
    )
    .orderBy(desc(companionMemories.updatedAt));
}

async function loadStoreSession(userId: string, sessionId: string) {
  const [row] = await withTransientDbRetry(() =>
    db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_SESSION),
          eq(userEntities.entityId, sessionId),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

async function loadCharacters(userId: string, characterIds: string[]) {
  if (characterIds.length === 0) return [];
  const rows = await withTransientDbRetry(() =>
    db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          or(
            eq(userEntities.entityName, "Character"),
            eq(userEntities.entityName, "Anima"),
          ),
          matchEntityIds(characterIds),
        ),
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
  return withTransientDbRetry(async () => {
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
  });
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
    const inserted = await tx
      .insert(userEntities)
      .values({
        userId,
        entityName: CHAT_MESSAGE,
        entityId: id,
        data,
      })
      .onConflictDoNothing()
      .returning({ data: userEntities.data });
    return inserted[0]?.data ? asObject(inserted[0].data) : data;
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
  id?: string;
  userId: string;
  sessionId: string;
  role: string;
  content: string;
  characterId?: string | null;
  characterName?: string | null;
  isCrossover: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  await db
    .insert(chatMessages)
    .values({
      id: params.id ?? makeId(),
      sessionId: params.sessionId,
      userId: params.userId,
      role: params.role,
      content: params.content,
      characterId: params.characterId ?? null,
      characterName: params.characterName ?? null,
      isCrossover: params.isCrossover,
      metadata: params.metadata ?? {},
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    })
    .onConflictDoNothing();
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
  if (sharedFact) {
    const factTurnId = sharedFact.turn_id;
    const already =
      factTurnId != null &&
      currentSharedMemory.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).turn_id === factTurnId,
      );
    if (!already) currentSharedMemory.push(sharedFact);
  }
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
  try {
    return await withTransientDbRetry(() =>
      queryCompanionMemories(userId, characterIds),
    );
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    logger.warn(
      { err },
      "companion_memories missing or out of date; re-running schema ensure",
    );
    resetEnsureSchemaLatch();
    await withTransientDbRetry(() => ensureSchemaOnce());
    return await withTransientDbRetry(() =>
      queryCompanionMemories(userId, characterIds),
    );
  }
}

/** Profile display name for the answer-last instruction. Never an email. */
function profileDisplayName(
  profile: Record<string, unknown>,
  settings: Record<string, unknown>,
): string {
  for (const value of [profile.display_name, settings.display_name, profile.full_name]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
    system_prompt: c.system_prompt ? String(c.system_prompt) : undefined,
    expression_spectrum: c.expression_spectrum,
    soulprint: c.soulprint,
    evolution_path: c.evolution_path ? String(c.evolution_path) : undefined,
    _isAnima: Boolean(c._isAnima),
  }));
}

async function upsertTurnMemory(params: {
  turnId?: string;
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
    turn_id: params.turnId,
    session_id: params.sessionId,
    text: `User: ${truncate(params.userContent, 240)} | Companion: ${truncate(
      params.assistantContent,
      320,
    )}`,
    created_at: now.toISOString(),
  };
  for (const characterId of params.characterIds) {
    const [existing] = await withTransientDbRetry(() =>
      db
        .select()
        .from(companionMemories)
        .where(
          and(
            eq(companionMemories.userId, params.userId),
            eq(companionMemories.characterId, characterId),
          ),
        )
        .limit(1),
    );
    const facts = Array.isArray(existing?.facts) ? existing.facts.slice(-24) : [];
    if (
      params.turnId &&
      facts.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).turn_id === params.turnId,
      )
    ) {
      continue;
    }
    facts.push(fact);
    await withTransientDbRetry(() =>
      db
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
        }),
    );

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

function storeMessageMoment(data: MsgData): number {
  const raw = data.created_date || data.timestamp || data.updated_date;
  const at = Date.parse(String(raw || ""));
  return Number.isFinite(at) ? at : 0;
}

/**
 * Write the user line and the assistant line in turn order. A late repair
 * inserts them after this turn's user message (or at `created_at` when that
 * row is missing), never at max(seq) after newer committed messages.
 */
async function writeTurnMessagesInOrder(
  turn: ChatTurn,
  messages: { user: MsgData | null; assistant: MsgData },
): Promise<void> {
  await db.transaction(async (tx) => {
    await migrateSessionMessages(tx, turn.userId, turn.sessionId);
    const rows = await tx
      .select({
        id: userEntities.id,
        entityId: userEntities.entityId,
        data: userEntities.data,
      })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, turn.userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(turn.sessionId),
        ),
      );
    const seqRows: SeqRow[] = rows.map((row) => {
      const data = asObject(row.data);
      return {
        id: String(data.id || row.entityId),
        seq: Number(data.seq ?? 0),
        at: storeMessageMoment(data),
      };
    });
    const plan = planTurnMessageSeqs(seqRows, {
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      createdAtMs: turn.createdAt.getTime(),
      includeUser: Boolean(messages.user),
    });
    const now = new Date().toISOString();
    const insertRow = async (data: MsgData) => {
      await tx
        .insert(userEntities)
        .values({
          userId: turn.userId,
          entityName: CHAT_MESSAGE,
          entityId: String(data.id),
          data,
        })
        .onConflictDoNothing();
    };
    if (messages.user && plan.userSeq != null) {
      await insertRow({
        ...asObject(messages.user),
        id: turn.userMessageId,
        session_id: turn.sessionId,
        seq: plan.userSeq,
        created_date: turn.createdAt.toISOString(),
        updated_date: now,
      });
    }
    const assistantAt = new Date(turn.createdAt.getTime() + 1).toISOString();
    if (plan.reseatAssistant) {
      const existing = rows.find(
        (row) =>
          String(asObject(row.data).id || row.entityId) === turn.assistantMessageId,
      );
      if (existing) {
        const data = asObject(existing.data);
        await tx
          .update(userEntities)
          .set({
            data: {
              ...data,
              seq: plan.assistantSeq,
              created_date: data.created_date || assistantAt,
              updated_date: now,
            },
            updatedAt: new Date(),
          })
          .where(eq(userEntities.id, existing.id));
        return;
      }
    }
    if (seqRows.some((row) => row.id === turn.assistantMessageId)) return;
    await insertRow({
      ...asObject(messages.assistant),
      id: turn.assistantMessageId,
      session_id: turn.sessionId,
      seq: plan.assistantSeq,
      created_date: assistantAt,
      updated_date: now,
    });
  });
}

async function persistLedgerTurn(turn: ChatTurn): Promise<void> {
  if (!turn.assistantContent.trim()) {
    throw new Error("Cannot persist a turn before its assistant reply is generated");
  }
  const metadata = asObject(turn.metadata);
  const characterIds = asStringArray(metadata.character_ids);
  const activeCharacterId = metadata.active_character_id
    ? String(metadata.active_character_id)
    : null;
  const activeCharacterName = metadata.active_character_name
    ? String(metadata.active_character_name)
    : null;
  const isCrossover = metadata.is_crossover === true;
  const isContinue = metadata.is_continue === true;
  const mode = String(metadata.mode || "solo");

  await syncTypedSession({
    userId: turn.userId,
    sessionId: turn.sessionId,
    title: String(metadata.session_title || "New session"),
    mode,
    characterIds,
    isCrossover,
    metadata: { source: "chat_api", turn_id: turn.id },
  });

  const userMessage =
    !isContinue && turn.userContent.trim()
      ? {
          id: turn.userMessageId,
          role: "user",
          content: turn.userContent,
          timestamp: turn.createdAt.toISOString(),
          metadata: { turn_id: turn.id },
        }
      : null;
  const assistantMessage = {
    id: turn.assistantMessageId,
    role: "assistant",
    content: turn.assistantContent,
    character_id: activeCharacterId,
    character_name: activeCharacterName,
    timestamp: new Date(turn.createdAt.getTime() + 1).toISOString(),
    metadata: { turn_id: turn.id },
  };
  await writeTurnMessagesInOrder(turn, {
    user: userMessage,
    assistant: assistantMessage,
  });
  if (userMessage) {
    await persistTypedMessage({
      id: turn.userMessageId,
      userId: turn.userId,
      sessionId: turn.sessionId,
      role: "user",
      content: turn.userContent,
      isCrossover,
      metadata: { turn_id: turn.id },
      createdAt: turn.createdAt,
    });
  }
  await persistTypedMessage({
    id: turn.assistantMessageId,
    userId: turn.userId,
    sessionId: turn.sessionId,
    role: "assistant",
    content: turn.assistantContent,
    characterId: activeCharacterId,
    characterName: activeCharacterName,
    isCrossover,
    metadata,
    createdAt: new Date(turn.createdAt.getTime() + 1),
  });

  await recordTurnContinuity(turn);
  await writeTurnMoodFromMetadata(turn);
  await markTurnCommitted(turn.id, turn.userId);
}

/**
 * Mood lands in the same persist as the assistant row. `moodTurnId` makes a
 * retry of this turn a no-op so the felt state cannot shift twice.
 */
async function writeTurnMoodFromMetadata(turn: ChatTurn): Promise<void> {
  const metadata = asObject(turn.metadata);
  const selfState = asObject(metadata.mood_self_state);
  if (!selfState || Object.keys(selfState).length === 0) return;
  const characterIds = asStringArray(metadata.character_ids);
  if (characterIds.length === 0) return;
  const now = new Date();
  for (const characterId of characterIds) {
    const [existing] = await withTransientDbRetry(() =>
      db
        .select({
          summary: companionMemories.summary,
          facts: companionMemories.facts,
          emotionalState: companionMemories.emotionalState,
          resonanceNotes: companionMemories.resonanceNotes,
        })
        .from(companionMemories)
        .where(
          and(
            eq(companionMemories.userId, turn.userId),
            eq(companionMemories.characterId, characterId),
          ),
        )
        .limit(1),
    );
    const current = (existing?.emotionalState as Record<string, unknown> | null) ?? {};
    const next = emotionalStateWithTurnMood(current, turn.id, selfState);
    if (!next.wrote) continue;
    await withTransientDbRetry(() =>
      db
        .insert(companionMemories)
        .values({
          userId: turn.userId,
          characterId,
          summary: existing?.summary ?? "",
          facts: Array.isArray(existing?.facts) ? existing.facts : [],
          emotionalState: next.state,
          resonanceNotes: existing?.resonanceNotes ?? "",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [companionMemories.userId, companionMemories.characterId],
          set: {
            emotionalState: next.state,
            updatedAt: now,
          },
        }),
    );
  }
}

/**
 * Memory + shared crossover facts. Safe to call from both server persist and
 * the client `commitTurn` path — does not write chat message rows (the client
 * already appended those).
 */
async function recordTurnContinuity(turn: ChatTurn): Promise<void> {
  const metadata = asObject(turn.metadata);
  const characterIds = asStringArray(metadata.character_ids);
  const isCrossover = metadata.is_crossover === true;
  const sharedFact = isCrossover
    ? {
        type: "crossover_turn",
        turn_id: turn.id,
        text: `User: ${truncate(turn.userContent, 180)} | Reply: ${truncate(turn.assistantContent, 260)}`,
        created_at: new Date().toISOString(),
      }
    : undefined;
  await updateStoreSessionMetadata(
    turn.userId,
    turn.sessionId,
    turn.userContent || turn.assistantContent,
    sharedFact,
  );
  await upsertTurnMemory({
    turnId: turn.id,
    userId: turn.userId,
    characterIds,
    sessionId: turn.sessionId,
    userContent: turn.userContent,
    assistantContent: turn.assistantContent,
  });
}

async function applyRelationshipPostProcess(params: {
  userId: string;
  sessionId: string;
  turnId: string;
  characterIds: string[];
  activeCharacterId: string | null;
  content: string;
  assistantContent: string;
  mode: string;
  isVoidTurn: boolean;
  significantExperienceCount: number;
  synchroState: SynchroState | null;
  companionAffect?: CompanionAffect | null;
}): Promise<void> {
  const {
    userId,
    sessionId,
    turnId,
    characterIds,
    activeCharacterId,
    content,
    assistantContent,
    mode,
    isVoidTurn,
    significantExperienceCount,
    synchroState,
    companionAffect,
  } = params;
  if (characterIds.length > 0) {
    const historySummary = `User said: ${truncate(content, 420)}\nCompanion replied: ${truncate(assistantContent, 520)}`;

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
        significantExperienceCount,
        alreadyMilestone: Number(updated?.evolutionDelta?.milestone) || 0,
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
  if ((synchroState || companionAffect) && assistantContent) {
    const anchorId =
      activeCharacterId && characterIds.includes(activeCharacterId)
        ? activeCharacterId
        : characterIds[0];
    const [anchorRow] = anchorId
      ? await withTransientDbRetry(() =>
          db
            .select({ emotionalState: companionMemories.emotionalState })
            .from(companionMemories)
            .where(
              and(
                eq(companionMemories.userId, userId),
                eq(companionMemories.characterId, anchorId),
              ),
            )
            .limit(1),
        )
      : [undefined];
    const anchorState =
      (anchorRow?.emotionalState as Record<string, unknown> | null) ?? null;
    // The server save stamps mood before this runs. Skip only that write.
    // Relationship strength and saved moments still land once for the turn.
    const bondAlready = relationshipTurnAlreadyWritten(anchorState, turnId);
    const momentsAlready = savedMomentsTurnAlreadyWritten(anchorState, turnId);
    const evolved =
      bondAlready || !synchroState
        ? null
        : evolveSynchroFromCompanion(synchroState, assistantContent);
    const evolvedAffect =
      moodTurnAlreadyWritten(anchorState, turnId) || !companionAffect
        ? null
        : evolveCompanionAffectFromCompanion(companionAffect, assistantContent);
    if (evolved && !momentsAlready) {
      try {
        const intimacy = Number(
          evolved.vector?.intimacy ?? evolved.vector?.synchroStrength ?? 0,
        );
        if (shouldCrystallize(intimacy, evolved.lastShift, content)) {
          const title =
            content.length > 56
              ? `${content.slice(0, 53).trim()}…`
              : content.slice(0, 56) || "A moment that settled";
          const bodyText = [
            `User: ${truncate(content, 280)}`,
            `Companion: ${truncate(assistantContent, 360)}`,
            evolved.lastShift ? `Shift: ${evolved.lastShift}` : null,
          ]
            .filter(Boolean)
            .join("\n");
          const targetIds =
            activeCharacterId && characterIds.includes(activeCharacterId)
              ? [activeCharacterId]
              : characterIds.slice(0, 1);
          for (const animaId of targetIds) {
            await crystallizeResonanceMemory({
              userId,
              animaId,
              sessionId,
              title,
              body: bodyText,
              resonanceSnapshot: {
                intimacy: evolved.vector.intimacy,
                powerDynamic: evolved.vector.powerDynamic,
                spiritualAttunement: evolved.vector.spiritualAttunement,
                primalIntensity: evolved.vector.primalIntensity,
                crossoverOpenness: evolved.vector.crossoverOpenness,
              },
              emotionalTone: evolved.emotionalTone,
              tags: ["crystallized", evolved.level, mode, `turn:${turnId}`].filter(
                Boolean,
              ) as string[],
              intensity: Math.round(
                Math.max(intimacy, Number(evolved.vector.synchroStrength ?? 0)),
              ),
            });
          }
        }
      } catch (crystalErr) {
        logger.warn(
          { crystalErr, turnId, sessionId },
          "Resonance memory crystallization failed (non-blocking)",
        );
      }
    }
    const now = new Date();
    for (const cid of characterIds) {
      const [existing] = await withTransientDbRetry(() =>
        db
          .select({
            summary: companionMemories.summary,
            facts: companionMemories.facts,
            emotionalState: companionMemories.emotionalState,
            resonanceNotes: companionMemories.resonanceNotes,
          })
          .from(companionMemories)
          .where(
            and(
              eq(companionMemories.userId, userId),
              eq(companionMemories.characterId, cid),
            ),
          )
          .limit(1),
      );
      const current =
        (existing?.emotionalState as Record<string, unknown> | null) ?? null;
      const next = emotionalStateWithTurnBond(current, turnId, {
        synchro: evolved ? serializeSynchroState(evolved) : null,
        selfState: evolvedAffect ? serializeCompanionAffect(evolvedAffect) : null,
        saveMoment: Boolean(evolved) && !savedMomentsTurnAlreadyWritten(current, turnId),
      });
      if (!next.wroteMood && !next.wroteRelationship && !next.wroteSavedMoments) {
        continue;
      }
      await withTransientDbRetry(() =>
        db
          .insert(companionMemories)
          .values({
            userId,
            characterId: cid,
            summary: existing?.summary ?? "",
            facts: Array.isArray(existing?.facts) ? existing.facts : [],
            emotionalState: next.state,
            resonanceNotes: existing?.resonanceNotes ?? "",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [companionMemories.userId, companionMemories.characterId],
            set: {
              emotionalState: next.state,
              updatedAt: now,
            },
          }),
      );
    }
  }
}

async function applyRelationshipPostProcessFromTurn(turn: ChatTurn): Promise<void> {
  const metadata = asObject(turn.metadata);
  const characterIds = asStringArray(metadata.character_ids);
  const activeCharacterId = metadata.active_character_id
    ? String(metadata.active_character_id)
    : characterIds[0] || null;
  const mode = String(metadata.mode || "solo");
  const hidden = asObject(metadata.hidden_sequences);
  const learnedLife = Array.isArray((hidden as { learned_life?: unknown[] }).learned_life)
    ? (hidden as { learned_life: unknown[] }).learned_life.length
    : 0;
  const memories = await loadMemories(turn.userId, characterIds);
  let synchroState: SynchroState | null = null;
  let companionAffect: CompanionAffect | null = null;
  if (activeCharacterId) {
    const memForChar = memories.find((m) => m.characterId === activeCharacterId);
    companionAffect = initCompanionAffect(
      (memForChar?.emotionalState as Record<string, unknown> | null) ?? null,
    );
    if (turn.userContent) {
      companionAffect = evolveCompanionAffectFromUser(
        companionAffect,
        turn.userContent,
      );
    }
    if (memories.length > 0) {
      synchroState = initSynchroState(
        (memForChar?.emotionalState as Record<string, unknown> | null) ?? null,
        memForChar?.resonanceNotes ?? null,
        null,
      );
      if (turn.userContent) {
        synchroState = evolveSynchroFromUser(synchroState, turn.userContent);
      }
    }
  }
  await applyRelationshipPostProcess({
    userId: turn.userId,
    sessionId: turn.sessionId,
    turnId: turn.id,
    characterIds,
    activeCharacterId,
    content: turn.userContent,
    assistantContent: turn.assistantContent,
    mode,
    isVoidTurn: mode === "void" || Boolean(metadata.deep_mode),
    significantExperienceCount: learnedLife,
    synchroState,
    companionAffect,
  });
}

const leftoverTurnRepair = new Map<string, Promise<void>>();
const turnPersistInFlight = new Map<string, Promise<void>>();

async function retryTurnPersistence(turn: ChatTurn): Promise<void> {
  const existing = turnPersistInFlight.get(turn.id);
  if (existing) return existing;
  const work = (async () => {
    const latest = await readChatTurn(turn.id, turn.userId);
    if (!latest || latest.status === "committed") return;
    try {
      await persistLedgerTurn(latest);
    } catch (error) {
      await markTurnFailed(latest.id, latest.userId, error);
      throw error;
    }
  })().finally(() => {
    if (turnPersistInFlight.get(turn.id) === work) turnPersistInFlight.delete(turn.id);
  });
  turnPersistInFlight.set(turn.id, work);
  return work;
}

function scheduleLeftoverTurnRepair(
  userId: string,
  sessionId: string,
  currentTurnId: string,
): void {
  const key = `${userId}:${sessionId}`;
  if (leftoverTurnRepair.has(key)) return;
  const work = (async () => {
    try {
      const retryable = await retryableChatTurns(userId, sessionId, 3);
      if (retryable.length === 0) return;
      const results = await Promise.allSettled(
        retryable
          .filter((turn) => turn.id !== currentTurnId)
          .map((turn) => retryTurnPersistence(turn)),
      );
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures > 0) {
        logger.warn(
          { sessionId, failures, attempted: results.length },
          "Chat turn reconciliation left retryable failures",
        );
      }
    } catch (error) {
      logger.warn({ error, sessionId }, "Chat turn reconciliation failed");
    }
  })().finally(() => {
    if (leftoverTurnRepair.get(key) === work) leftoverTurnRepair.delete(key);
  });
  leftoverTurnRepair.set(key, work);
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
    companion_affect: Object.fromEntries(
      memories.map((row) => [
        row.characterId,
        companionAffectSnapshotFromEmotionalState(
          row.emotionalState as Record<string, unknown>,
        ),
      ]),
    ),
  });
});

type EditableMemoryFact = {
  fact_id?: string;
  text?: string;
  type?: string;
  tags?: string[];
  pinned?: boolean;
  importance?: number;
  session_id?: string;
  turn_id?: string;
  created_at?: string;
  updated_at?: string;
  source?: string;
  [key: string]: unknown;
};

function normalizeMemoryFact(raw: unknown): EditableMemoryFact | null {
  if (!raw || typeof raw !== "object") return null;

  const fact = raw as EditableMemoryFact;
  const text = String(fact.text || "").trim();

  if (!text) return null;

  return {
    ...fact,
    fact_id: fact.fact_id || factIdFor(text),
    text,
    type: String(fact.type || "unknown"),
    tags: Array.isArray(fact.tags)
      ? fact.tags.map(String).filter(Boolean)
      : [],
    pinned: fact.pinned === true,
    importance:
      typeof fact.importance === "number"
        ? Math.max(0, Math.min(1, fact.importance))
        : 0.5,
  };
}

function normalizeMemoryFacts(rawFacts: unknown): EditableMemoryFact[] {
  if (!Array.isArray(rawFacts)) return [];

  return rawFacts
    .map(normalizeMemoryFact)
    .filter((fact): fact is EditableMemoryFact => fact !== null);
}

async function loadCharacterMemory(
  userId: string,
  characterId: string,
) {
  const [memory] = await withTransientDbRetry(() =>
    db
      .select()
      .from(companionMemories)
      .where(
        and(
          eq(companionMemories.userId, userId),
          eq(companionMemories.characterId, characterId),
        ),
      )
      .limit(1),
  );

  return memory ?? null;
}

router.get("/memories/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const characterId = String(req.params.characterId || "").trim();

  if (!characterId) {
    res.status(400).json({ error: "characterId is required" });
    return;
  }

  const memory = await loadCharacterMemory(userId, characterId);

  if (!memory) {
    res.json({
      memory: {
        characterId,
        summary: "",
        facts: [],
        emotionalState: {},
        resonanceNotes: "",
      },
      companion_affect: companionAffectSnapshotFromEmotionalState({}),
    });
    return;
  }

  res.json({
    memory: {
      ...memory,
      facts: normalizeMemoryFacts(memory.facts),
    },
    companion_affect: companionAffectSnapshotFromEmotionalState(
      memory.emotionalState as Record<string, unknown>,
    ),
  });
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

function turnStatusPayload(turn: ChatTurn) {
  const metadata = asObject(turn.metadata);
  return {
    turn_id: turn.id,
    session_id: turn.sessionId,
    persistence_owner: turn.persistenceOwner,
    persistence_status: turn.status,
    retry_count: turn.retryCount,
    last_error: turn.lastError,
    committed_at: turn.committedAt,
    user_content: turn.userContent,
    assistant_content: turn.assistantContent || "",
    created_at: turn.createdAt,
    assistant_message_id: turn.assistantMessageId,
    user_message_id: turn.userMessageId,
    companion_affect: metadata.companion_affect ?? null,
    active_character_name: metadata.active_character_name ?? null,
  };
}

router.get("/sessions/:sessionId/live-turn", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const turn = await latestOpenChatTurn(userId, req.params.sessionId);
  if (!turn) {
    res.json({ turn_id: null, persistence_status: null });
    return;
  }
  res.json(turnStatusPayload(turn));
});

router.get("/turns/:turnId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const turn = await readChatTurn(req.params.turnId, userId);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  res.json(turnStatusPayload(turn));
});

router.post("/turns/:turnId/commit", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const turn = await readChatTurn(req.params.turnId, userId);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  if (!turn.assistantContent.trim()) {
    res.status(409).json({ error: "Turn generation has not completed" });
    return;
  }
  if (turn.status !== "committed") {
    // Client persist already wrote message rows. Still record companion
    // memory, crossover shared_memory, and relationship post-process —
    // those only ran on the unused server-persist path.
    try {
      await recordTurnContinuity(turn);
    } catch (error) {
      logger.warn({ error, turnId: turn.id }, "Client commit continuity write failed");
    }
    await markTurnCommitted(turn.id, userId);
    void applyRelationshipPostProcessFromTurn(turn).catch((postProcessError) => {
      logger.warn(
        { postProcessError, turnId: turn.id, sessionId: turn.sessionId },
        "Chat relationship/evolution post-processing failed",
      );
    });
  }
  res.json({ turn_id: turn.id, persistence_status: "committed" });
});

router.post("/turns/:turnId/retry", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const turn = await readChatTurn(req.params.turnId, userId);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  if (turn.status === "committed") {
    res.json({ turn_id: turn.id, persistence_status: turn.status });
    return;
  }
  try {
    await retryTurnPersistence(turn);
    res.json({ turn_id: turn.id, persistence_status: "committed" });
  } catch (error) {
    logger.warn({ error, turnId: turn.id }, "Chat turn persistence retry failed");
    res.status(503).json({
      error: "Turn persistence retry failed",
      turn_id: turn.id,
      persistence_status: "failed",
    });
  }
});

router.post("/messages", async (req, res) => {
  const requestStartedAt = Date.now();
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
    include_repository_knowledge?: boolean;
    deep_mode?: boolean;
    /** Reply the own model wrote in the browser (see lib/ownModel.ts). */
    own_model_reply?: string;
    own_model_version?: number;
    persist?: boolean;
    turn_id?: string;
    idempotency_key?: string;
    persistence_owner?: PersistenceOwner;
    metadata?: Record<string, unknown>;
    region?: RegionHints | null;
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
  let turnId = normalizeTurnId(body.turn_id || body.idempotency_key);
  const persistenceOwner: PersistenceOwner =
    body.persistence_owner === "client" || body.persist === false
      ? "client"
      : "server";
  const turnMetadata = {
    ...(body.metadata ?? {}),
    mode,
    character_ids: characterIds,
  };
  const telemetry = new ChatPipelineTelemetry({
    turnId,
    sessionId,
    mode,
  });
  let flight = reserveChatTurnFlight(turnId, content);
  if (flight.mismatched) {
    turnId = normalizeTurnId("");
    flight = reserveChatTurnFlight(turnId, content);
  }
  if (flight.joined) {
    const joinerWatch = watchClientLeave(res);
    res.on("close", () => {
      if (joinerWatch.left()) flight.releaseWaiter();
    });
    try {
      await writeJoinedTurn(res, flight.result);
    } finally {
      flight.releaseWaiter();
      joinerWatch.cancel();
    }
    return;
  }
  let turnStart = await beginChatTurn({
    id: turnId,
    sessionId,
    userId,
    userContent: content,
    persistenceOwner,
    metadata: turnMetadata,
  });

  let adoptedSse: ReturnType<typeof openChatSse> | null = null;
  const followDurableTurn = async (turn: ChatTurn): Promise<boolean> => {
    const joinerWatch = watchClientLeave(res);
    const followed = await streamDurableFollow(
      res,
      flight,
      awaitDurableTurnOwner({
        turn,
        content,
        stillWaiting: () => !joinerWatch.left(),
      }),
    );
    joinerWatch.cancel();
    if (followed.action === "finished") return false;
    turnStart = { turn: followed.turn, created: false };
    adoptedSse = followed.sse;
    turnId = followed.turn.id;
    return true;
  };

  if (!turnStart.created) {
    const reuse = classifyChatTurnReuse(turnStart.turn, content);
    if (reuse === "replay") {
      const outcome = replayFlightOutcome(turnStart.turn);
      flight.resolve(outcome);
      writeFlightSse(res, outcome);
      return;
    }
    if (reuse === "conflict") {
      // Same turn_id, different user text — never stream the prior reply.
      flight.abandon();
      turnId = normalizeTurnId("");
      flight = reserveChatTurnFlight(turnId, content);
      turnStart = await beginChatTurn({
        id: turnId,
        sessionId,
        userId,
        userContent: content,
        persistenceOwner,
        metadata: turnMetadata,
      });
    }
  }
  if (!turnStart.created) {
    // Same text on a turn another isolate may already be generating. Join
    // through the ledger row, or claim it when the owner's lease has expired.
    const handedOff = await followDurableTurn(turnStart.turn);
    if (!handedOff) return;
  } else {
    const claimed = await claimChatTurnLease(turnId, userId);
    if (!claimed) {
      const handedOff = await followDurableTurn(turnStart.turn);
      if (!handedOff) return;
    }
  }

  // First SSE byte / heartbeat before memories, embeddings, weather, RAG, or
  // prompt compose. User-perceived TTFT used to include all of that work.
  const sse = adoptedSse ?? openChatSse(res);
  const stopHeartbeat = sse.stop;
  let clientLeft: () => boolean = () => false;
  const clientWatch = watchClientLeave(res);
  clientLeft = clientWatch.left;
  const leaseHeartbeat = setInterval(() => {
    void renewChatTurnLease(turnId, userId).catch(() => {});
  }, 10_000);
  leaseHeartbeat.unref?.();
  hintLocalLlmWarm();
  let streamSucceeded = false;
  let fullResponse = "";
  let releaseBackground = () => {};
  const backgroundDone = new Promise<void>((resolve) => {
    releaseBackground = resolve;
  });
  scheduleWorkerBackground(backgroundDone, req.header("x-anima-bg"));
  let usedModel = "";
  let usedTier: string = "";
  let usedProvider: LlmProviderId = "local";
  let usedBrand: LlmBrand | undefined;
  let failedOver = false;
  let ensembleMinds: string[] | undefined;
  let ensembleCombined = false;
  let intimacyProfile: IntimacyProfile | null = null;
  let intimacyScene: IntimacyScene | null = null;
  let synchroState: SynchroState | null = null;
  let companionAffect: CompanionAffect | null = null;
  let activeCharacterId: string | null = null;
  let isCrossover = false;
  let preStreamPersist: Promise<void> = Promise.resolve();
  const shouldPersist = body.persist !== false;

  try {
  // Leftover-turn repair must not delay first token. Heartbeat is already
  // on the wire; reconcile in the background. One in-flight repair per
  // session so a generated turn is not retried while persist is still running.
  scheduleLeftoverTurnRepair(userId, sessionId, turnId);

  const memoriesPromise = optionalChatContext(
    "memories",
    () => loadMemories(userId, characterIds),
    [],
  );
  const wantRepositoryKnowledge = shouldRetrieveRepositoryKnowledge(content, {
    explicit:
      body.include_repository_knowledge === true ||
      body.metadata?.include_repository_knowledge === true,
  });
  const repositoryKnowledgePromise = wantRepositoryKnowledge
    ? telemetry
        .measure("repository_rag_ms", retrieveRepositoryKnowledge(content))
        .catch(() => "")
    : Promise.resolve("");
  // Postgres full-text only, and only when this turn cannot leave the
  // self-hosted model. A missing table or slow lookup must not block the reply.
  const pdfContextPromise = isLocalOnlyProviderChain()
    ? optionalChatContext(
        "pdf_context",
        () =>
          retrievePdfContext({
            userId,
            sessionId,
            characterIds,
            query: content,
          }),
        "",
      )
    : Promise.resolve("");
  const worldKnowledgePromise = (async () => {
    try {
      const [profileRow] = await db
        .select({ data: userProfiles.data })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      const region = resolveUserRegion({
        hints: body.region || null,
        profile: regionHintsFromProfile(profileRow?.data),
        geo: geoFromRequest(req),
      });
      if (!region.enabled) {
        return {
          prompt: "",
          countryCode: region.countryCode,
          profile: profileRow?.data ?? null,
        };
      }
      // Clock/location only on the hot path. Live weather/holidays wait on
      // Open-Meteo (≤1.5s) — warm the cache for the next turn instead.
      const snapshot = peekRegionalWorldKnowledge(region);
      void fetchRegionalWorldKnowledge(region).catch(() => {});
      return {
        prompt: formatRegionalWorldKnowledge(snapshot),
        countryCode: snapshot.countryCode,
        profile: profileRow?.data ?? null,
      };
    } catch {
      return { prompt: "", countryCode: null, profile: null };
    }
  })();
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
    ? optionalChatContext(
        "hinted_state",
        () =>
          Promise.all([
            loadEvolution(hintedCharId, userId),
            loadRelationshipState(hintedCharId, userId),
            loadArcState(hintedCharId, userId),
          ]),
        [undefined, null, null] as const,
      )
    : Promise.resolve([undefined, null, null] as const);
  const [
    characters,
    memories,
    recentMessages,
    adaptedMemories,
    hintedState,
    worldKnowledgeResult,
    repositoryKnowledge,
    pdfContext,
  ] = await telemetry.measure(
    "context_load_ms",
    Promise.all([
      // Identity and conversation history are required. The lean client prompt
      // no longer includes either; a failed read must not become an empty chat.
      loadCharacters(userId, characterIds),
      memoriesPromise,
      readRecentStoreMessages(userId, sessionId, 24, {
        skipMigrate: Boolean(sessionData.messages_migrated),
      }),
      memoriesPromise.then((rows) => {
        const adapted = adaptMemories(rows);
        // Local companion_memories + stored vectors only. Remote supermemory
        // search is a later-phase retrieval hop and must not delay first token.
        return attachStoredEmbeddings(userId, adapted).catch(() => adapted);
      }),
      hintedStatePromise,
      worldKnowledgePromise,
      repositoryKnowledgePromise,
      pdfContextPromise,
    ]),
  );
  const worldKnowledge = worldKnowledgeResult.prompt;
  
  const requestedAssistantId = body.assistant_character_id
    ? String(body.assistant_character_id)
    : null;
  const requestedAssistantName = body.assistant_character_name
    ? String(body.assistant_character_name).trim()
    : "";

  const distinctUniverses = new Set(
    characters.map((c) => c.universe).filter(Boolean).map(String),
  ).size;
  isCrossover = mode === "group" && distinctUniverses >= 2;
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
  activeCharacterId = activeChar?.id ? String(activeChar.id) : null;
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
      : await optionalChatContext(
          "active_state",
          () =>
            Promise.all([
              activeCharacterId
                ? loadEvolution(activeCharacterId, userId)
                : Promise.resolve(null),
              activeCharacterId
                ? loadRelationshipState(activeCharacterId, userId)
                : Promise.resolve(null),
              activeCharacterId
                ? loadArcState(activeCharacterId, userId)
                : Promise.resolve(null),
            ]),
          [null, null, null] as const,
        );
  synchroState = null;
  companionAffect = null;
  if (activeChar) {
    const memForChar = memories.find(
      (m) => m.characterId === String(activeChar.id || ""),
    );
    companionAffect = initCompanionAffect(
      (memForChar?.emotionalState as Record<string, unknown> | null) ?? null,
    );
    if (content) {
      companionAffect = evolveCompanionAffectFromUser(companionAffect, content);
    }
    if (memories.length > 0) {
      synchroState = initSynchroState(
        memForChar?.emotionalState as Record<string, unknown> | null,
        memForChar?.resonanceNotes ?? null,
        null,
      );
      if (content) {
        synchroState = evolveSynchroFromUser(synchroState, content);
      }
    }
  }
  const profileData = asObject(worldKnowledgeResult.profile);
  const profileSettings = asObject(profileData.settings);
  const userDisplayName = profileDisplayName(profileData, profileSettings);
  const therapyActive =
    sessionData.therapy_mode === true ||
    sessionData.companion_mode === "therapy" ||
    body.metadata?.therapy_mode === true ||
    mode === "therapy";
  const adultActive =
    !therapyActive &&
    (profileSettings.adult_content_enabled === true ||
      body.metadata?.adult_mode === true);
  const modePolicy = resolveChatModePolicy({
    requestedMode: mode,
    therapy: therapyActive,
    adult: adultActive,
    isCrossover,
    deepMode: Boolean(body.deep_mode),
  });
  const therapyAssessment =
    modePolicy.name === "therapy"
      ? assessTherapySafety({ content, recentMessages })
      : null;

  intimacyProfile = null;
  intimacyScene = null;
  let intimacyResult: IntimacyTurnResult | null = null;

  if (activeCharacterId && adultActive && !therapyActive) {
    let profile = await loadIntimacyProfile(userId, activeCharacterId);
    if (profile.lastSceneAt) {
      const idle = (Date.now() - Date.parse(profile.lastSceneAt)) / 60000;
      if (idle >= 8) {
        profile = decayHeat(profile, idle);
      }
    }
    const scene = await loadIntimacyScene(userId, sessionId, activeCharacterId);
    intimacyResult = evaluateTurn({
      profile,
      scene,
      content,
      adultEnabled: adultActive,
      therapyMode: therapyActive,
    });
    intimacyProfile = intimacyResult?.profile || null;
    intimacyScene = intimacyResult?.scene || null;
  }

  const operatorModel = extractOperatorModelFromProfile(
    worldKnowledgeResult.profile,
  );

  const messages = telemetry.measureSync("prompt_build_ms", () =>
    composeCompanionChatMessages({
      clientContext: body.system_prompt,
      repositoryKnowledge,
      pdfContext,
      characters: adaptedChars,
      activeCharacter: activeChar,
      memories: adaptedMemories,
      recentMessages,
      sharedMemory: sessionData.shared_memory,
      mode,
      content,
      isCrossover,
      synchroState,
      companionAffect,
      evolutionDelta: activeEvolutionRow?.evolutionDelta,
      relationshipState: activeRelationshipState,
      arcState: activeArcState,
      worldKnowledge,
      modePolicy,
      therapyAssessment,
      crisisResource: crisisResourceForCountry(
        worldKnowledgeResult.countryCode,
      ),
      hiddenSequences: (body.metadata?.hidden_sequences as any) || null,
      conversationalWeather: (body.metadata?.conversational_weather as any) || null,
      intimacyProfile,
      intimacyScene,
      intimacyTurnResult: intimacyResult,
      operatorModel,
      userDisplayName,
    }),
  );

  const routed = routeModel(content, {
    deepMode: Boolean(body.deep_mode),
    conversationDepth: recentMessages.length,
  });
  const replyMaxTokens = chatReplyMaxTokens(routed.maxTokens, {
    mode,
    deepMode: Boolean(body.deep_mode),
  });
  // The own model runs in the browser; the client sends the reply it
  // wrote and this turn records it like any other. Honoured only while the
  // own model answers this user (Settings → Model Tutor) — otherwise the
  // Anima chain replies as usual. Only requests carrying a reply pay for the
  // state read.
  const ownModelReply =
    typeof body.own_model_reply === "string"
      ? body.own_model_reply.slice(0, 8000)
      : null;
  const ownModelTurn =
    ownModelReply !== null &&
    (await readModelState()
      .then((state) =>
        ownModelAccess({
          userId,
          sessionClaims: getAuth(req).sessionClaims,
          profile: worldKnowledgeResult.profile,
          state,
        }),
      )
      .then((access) => access.enabled)
      .catch((error) => {
        logger.warn({ error }, "Own-model access check failed; using the Anima chain");
        return false;
      }));

  preStreamPersist = (async () => {
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
        id: turnStart.turn.userMessageId,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
        ...(body.metadata ? { metadata: body.metadata } : {}),
      };
      await appendStoreMessage(userId, sessionId, userMessage);
      await persistTypedMessage({
        id: turnStart.turn.userMessageId,
        userId,
        sessionId,
        role: "user",
        content,
        isCrossover,
        metadata: body.metadata,
      });
    }
  })();

  usedModel = routed.model;
  usedTier = routed.tier;

  let producingTokens = false;
  const emitDelta = (delta: string) => {
    if (delta) producingTokens = true;
    telemetry.markFirstToken();
    sse.markStreaming();
    writeSse(res, { content: delta });
  };
  const emitReasoning = () => writeSse(res, { status: "thinking" });
  const freeTierCascade = usesFreeTierOpenBudget();
  const generationBudgetMs = llmChatMessagesOpenTimeoutMs({ freeTierCascade });
  const consumeOpts = {
    onDelta: emitDelta,
    onReasoning: emitReasoning,
    firstChunkMs: llmChatMessagesFirstChunkMs({ freeTierCascade }),
    totalMs: llmChatMessagesStreamTotalMs({ freeTierCascade }),
  };

  const releaseCompanionLlm = beginCompanionLlmTurn(userId);
  let releaseLocalSlot = async () => {};
  let open: { signal: AbortSignal; cancel: () => void } = {
    signal: new AbortController().signal,
    cancel: () => {},
  };
  try {
  if (!ownModelTurn && localLlmSlotEnabled()) {
    sse.pauseProgress();
    const grant = await waitForLocalChatSlot({
      turnId,
      onWaiting: (position) => {
        writeSse(res, { status: "waiting", queue_position: position });
      },
      shouldStop: () => clientLeft(),
    });
    releaseLocalSlot = grant.release;
    sse.resumeProgress();
  }

  telemetry.startGeneration();
    // First-token budget starts here, after the local slot is held.
    const generationStartedAt = Date.now();
    open = openStreamAbort(generationBudgetMs);
    const abandoned = armAbandonedGenerateAbort({
      res,
      startedAt: generationStartedAt,
      producingTokens: () => producingTokens,
      hardCapMs: llmProducingGenerateHardCapMs(),
      hasWaiter: async () => {
        if (chatTurnFlightWaiters(turnId) > 0) return true;
        return chatTurnHasRemoteWaiter(turnId, userId);
      },
    });
    const generateSignal = combineAbortSignals(open.signal, abandoned.signal);
    try {
    if (ownModelTurn) {
      usedProvider = "own";
      usedBrand = "own";
      usedTier = "standard";
      const version = Number(body.own_model_version);
      usedModel = Number.isInteger(version) && version > 0 ? `${OWN_MODEL_ID} v${version}` : OWN_MODEL_ID;
      sse.setPhase("generating");
      // A tiny model sometimes closes its turn at once. Keep the bubble so
      // it can still be taught what to say there.
      fullResponse = finalizeAssistantReply(ownModelReply ?? "") || OWN_MODEL_EMPTY_REPLY;
      emitDelta(fullResponse);
    } else if (isLocalEnsembleEnabled()) {
      writeSse(res, { status: "ensemble", phase: "gathering", minds: [] });
      const drafts = await draftLocalMinds({
        tier: routed.tier,
        maxTokens: replyMaxTokens,
        messages,
        signal: generateSignal,
      });
      if (!drafts.length) {
        throw new Error("The companion returned an empty reply. Please try again.");
      }
      ensembleMinds = drafts.map((d) => d.label);

      if (drafts.length === 1) {
        // Only one mind produced anything usable — nothing to combine.
        usedModel = drafts[0]!.model;
        usedBrand = "anima";
        fullResponse = finalizeAssistantReply(drafts[0]!.content);
        telemetry.markFirstToken();
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
          maxTokens: replyMaxTokens,
          signal: generateSignal,
        });
        usedModel = completion.model;
        usedTier = completion.tier;
        usedProvider = completion.provider;
        usedBrand = completion.brand;
        failedOver = completion.failedOver;
        ensembleCombined = true;

        const streamed = await consumeLlmStream(completion.stream, consumeOpts);
        fullResponse = streamed.timedOut
          ? trimToLastCompleteSentence(streamed.content)
          : streamed.content;
      }
    } else {
      sse.setPhase("waking");
      let completion;
      try {
        completion = await createChatStreamWithFailover({
          tier: routed.tier,
          model: routed.model,
          maxTokens: replyMaxTokens,
          messages,
          temperature: COMPANION_CHAT_TEMPERATURE,
          signal: generateSignal,
        });
      } finally {
        // Headers are in. The open timer must not cut a slow prefill once
        // bytes are flowing. Disconnect grace still aborts an abandoned slot.
        open.cancel();
      }
      sse.setPhase("generating");
      usedModel = completion.model;
      usedTier = completion.tier;
      usedProvider = completion.provider;
      usedBrand = completion.brand;
      failedOver = completion.failedOver;

      // Local Ollama: hold the opening of the reply. A copy of an earlier
      // turn, or a stock assistant line, stops the generate in the first
      // ~40 characters instead of waiting out a 200-token decode. The user
      // is not shown that text. Hosted providers still stream as they go.
      const localHost = usedProvider === "local";
      const priorReplies = recentAssistantReplies(recentMessages);
      const personaParts = [
        activeChar?.personality,
        activeChar?.backstory,
        activeChar?.speaking_style,
      ];
      const replyIsStock = (text: unknown) => isStockAssistantLine(text, personaParts);
      let held = "";
      let flushed = false;
      let cutReason: "repeat" | "stock" | null = null;
      const streamed = await consumeLlmStream(completion.stream, {
        ...consumeOpts,
        onDelta: (delta) => {
          if (!localHost) {
            emitDelta(delta);
            return;
          }
          held += delta;
          if (cutReason || held.trim().length < LOCAL_REPEAT_DETECT_CHARS) return;
          if (visiblePrefixRepeatsHistory(held, priorReplies)) {
            cutReason = "repeat";
            return;
          }
          if (replyIsStock(held)) {
            cutReason = "stock";
            return;
          }
          if (!flushed) {
            flushed = true;
            emitDelta(held);
            return;
          }
          emitDelta(delta);
        },
        stopWhen: () => cutReason !== null,
      });
      // A stalled or over-budget stream stops mid-word. `done.visible`
      // repaints the bubble, so the saved and shown reply both end cleanly.
      fullResponse = finalizeAssistantReply(
        streamed.stoppedEarly
          ? streamed.content
          : streamed.timedOut
            ? trimToLastCompleteSentence(streamed.content)
            : streamed.content,
      );
      if (localHost && !flushed && !cutReason && held && !fullResponse) {
        fullResponse = held;
      }

      const retryBudgetMs = repeatRetryBudgetMs(Date.now() - requestStartedAt);
      const copiedReply =
        matchingRepeatedReply(fullResponse, priorReplies) ||
        (cutReason === "repeat" ? matchingRepeatedReply(held, priorReplies) : null);
      const repeated = Boolean(copiedReply) || isRepeatedReply(fullResponse, priorReplies);
      const stockLine =
        cutReason === "stock" || replyIsStock(fullResponse) || replyIsStock(held);
      let otherWorkQueued = false;
      const wantsExtra =
        (repeated || stockLine) &&
        retryBudgetMs > 0 &&
        !generateSignal.aborted &&
        !streamed.timedOut;
      if (wantsExtra) {
        otherWorkQueued = companionTurnsOpenForUser(userId) > 1;
        if (!otherWorkQueued) {
          try {
            otherWorkQueued = await userHasOtherPendingChatTurn(userId, turnId);
          } catch (error) {
            logger.warn(
              { error, turnId },
              "Could not check queued turns; skipping extra regenerate",
            );
            otherWorkQueued = true;
          }
        }
      }
      // One extra generation per turn, shared by the repeat retry and the
      // stock-assistant retry. Repeat wins when both match: dropping the
      // copied line is the more specific fix, and a stock result still
      // deflects below without a second generate.
      let extraGenerationUsed = false;
      const canRegenerate = wantsExtra && !otherWorkQueued;
      if (
        canRegenerate &&
        shouldRegenerateRepeatedReply({
          retryBudgetMs,
          aborted: generateSignal.aborted,
          timedOut: Boolean(streamed.timedOut),
          repeated,
          otherWorkQueued,
        })
      ) {
        extraGenerationUsed = true;
        logger.warn(
          { turnId, retryBudgetMs, localHost },
          "Companion reply repeated recent history; regenerating once",
        );
        // Local restarts from the first ~40 characters and caps the retry
        // near 80 tokens. Hosted still uses the caller's token cap. Deltas
        // stay silent; `done.visible` is the only text the user keeps.
        const retryOpen = openStreamAbort(retryBudgetMs);
        try {
          const retry = await createChatStreamWithFailover({
            tier: routed.tier,
            model: routed.model,
            maxTokens: localHost
              ? Math.min(replyMaxTokens, LOCAL_EXTRA_GENERATION_MAX_TOKENS)
              : replyMaxTokens,
            messages: messagesForRepeatRetry(messages, copiedReply || fullResponse),
            temperature: OLLAMA_MAX_TEMPERATURE,
            signal: combineAbortSignals(retryOpen.signal, abandoned.signal),
          });
          const retried = await consumeLlmStream(retry.stream, {
            ...consumeOpts,
            onDelta: () => {},
            onReasoning: () => {},
            firstChunkMs: Math.min(consumeOpts.firstChunkMs, retryBudgetMs),
            totalMs: Math.min(consumeOpts.totalMs, retryBudgetMs),
          });
          const retriedText = finalizeAssistantReply(
            retried.timedOut
              ? trimToLastCompleteSentence(retried.content)
              : retried.content,
          );
          if (
            retriedText.trim() &&
            !isRepeatedReply(retriedText, [fullResponse, copiedReply || ""])
          ) {
            fullResponse = retriedText;
            flushed = false;
            usedModel = retry.model;
            usedTier = retry.tier;
            usedProvider = retry.provider;
            usedBrand = retry.brand;
            failedOver = retry.failedOver;
          }
        } catch (error) {
          // Keep the first reply. A repeat beats an error bubble.
          logger.warn({ error, turnId }, "Repeat regenerate failed; keeping first reply");
        } finally {
          retryOpen.cancel();
        }
      } else if (canRegenerate && stockLine && !extraGenerationUsed) {
        extraGenerationUsed = true;
        noteStockAssistantLine("retry");
        logger.warn(
          { turnId, metric: "stock_assistant_line", kind: "retry" },
          "stock assistant line guard fired",
        );
        const retryOpen = openStreamAbort(retryBudgetMs);
        try {
          const retry = await createChatStreamWithFailover({
            tier: routed.tier,
            model: routed.model,
            maxTokens: localHost
              ? Math.min(replyMaxTokens, LOCAL_EXTRA_GENERATION_MAX_TOKENS)
              : replyMaxTokens,
            messages: appendFinalUserReminder(
              messages,
              inCharacterRetryReminder(activeChar?.name),
            ),
            temperature: COMPANION_CHAT_TEMPERATURE,
            signal: combineAbortSignals(retryOpen.signal, abandoned.signal),
          });
          const retried = await consumeLlmStream(retry.stream, {
            ...consumeOpts,
            onDelta: () => {},
            onReasoning: () => {},
            firstChunkMs: Math.min(consumeOpts.firstChunkMs, retryBudgetMs),
            totalMs: Math.min(consumeOpts.totalMs, retryBudgetMs),
          });
          const retriedText = finalizeAssistantReply(
            retried.timedOut
              ? trimToLastCompleteSentence(retried.content)
              : retried.content,
          );
          if (retriedText.trim() && !replyIsStock(retriedText)) {
            fullResponse = retriedText;
            flushed = false;
            usedModel = retry.model;
            usedTier = retry.tier;
            usedProvider = retry.provider;
            usedBrand = retry.brand;
            failedOver = retry.failedOver;
          }
        } catch (error) {
          logger.warn({ error, turnId }, "Stock-assistant regenerate failed");
        } finally {
          retryOpen.cancel();
        }
      }
      const unresolvedStock =
        replyIsStock(fullResponse) ||
        (cutReason === "stock" &&
          replyIsStock(held) &&
          !String(fullResponse || "").trim());
      if (unresolvedStock) {
        const personaPronoun = pronounFromPersona([
          activeChar?.personality,
          activeChar?.backstory,
          activeChar?.speaking_style,
        ]);
        fullResponse = stockAssistantDeflection(activeChar?.name, personaPronoun);
        flushed = false;
        noteStockAssistantLine("deflect");
        logger.warn(
          { turnId, metric: "stock_assistant_line", kind: "deflect" },
          "stock assistant line guard fired",
        );
      }
      if (localHost && !flushed && fullResponse.trim()) {
        emitDelta(fullResponse);
      }
    }
    } finally {
      open.cancel();
      abandoned.cancel();
      clientWatch.cancel();
      releaseCompanionLlm();
      void releaseLocalSlot();
    }
  } finally {
    releaseCompanionLlm();
    void releaseLocalSlot();
  }

    // An empty completion used to look like a successful turn on the client
    // (thinking/typing cleared, no visible reply). Fail loudly instead.
    // Unclosed / think-only DeepSeek R1 output is recovered by finalizeAssistantReply.
    if (!String(fullResponse).trim()) {
      throw new Error("The companion returned an empty reply. Please try again.");
    }

    streamSucceeded = true;
    const evolvedCompanion = companionAffect
      ? evolveCompanionAffectFromCompanion(companionAffect, fullResponse)
      : null;
    const evolvedAffectSnapshot = evolvedCompanion
      ? toCompanionAffectSnapshot(
          evolvedCompanion,
          synchroState
            ? synchroStrengthFromEmotionalState(serializeSynchroState(synchroState))
            : null,
        )
      : null;
    const evolvedMoodSelfState = evolvedCompanion
      ? serializeCompanionAffect(evolvedCompanion)
      : null;
    const generatedMetadata = {
      ...(body.metadata ?? {}),
      mode,
      session_title: String(sessionData.title || "New session"),
      character_ids: characterIds,
      active_character_id: activeCharacterId,
      active_character_name: activeCharacterName,
      is_crossover: isCrossover,
      is_continue: Boolean(body.is_continue),
      model: usedModel,
      tier: usedTier,
      provider: usedProvider,
      brand: usedBrand,
      // POST /model/auto-lesson only learns from own-model turns marked here:
      // never therapy, adult, or continuation turns.
      own_model_learnable:
        usedBrand === "own" && !therapyActive && !adultActive && !body.is_continue,
      failed_over: failedOver,
      ensemble_minds: ensembleMinds,
      ensemble_combined: ensembleCombined,
      companion_affect: evolvedAffectSnapshot,
      mood_self_state: evolvedMoodSelfState,
    };
    try {
      await telemetry.measure(
        "turn_checkpoint_ms",
        checkpointGeneratedTurn({
          id: turnId,
          userId,
          assistantContent: fullResponse,
          metadata: generatedMetadata,
        }),
      );
    } catch (error) {
      // The model already replied. A Hyperdrive blip here must not replace
      // the answer with "Database unavailable" — leftover-turn repair retries.
      logger.warn(
        { error, turnId },
        "Generated-turn checkpoint failed; delivering the reply anyway",
      );
    }
    // Close the SSE as soon as the model is done. Persistence / evolution LLM
    // calls used to run before `done`, so the Chat page stayed on Processing...
    // until those finished (or hung).
    writeSse(res, {
      done: true,
      visible: fullResponse,
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
      turn_id: turnId,
      user_message_id: turnStart.turn.userMessageId,
      assistant_message_id: turnStart.turn.assistantMessageId,
      persistence_status: "generated",
      persistence_owner: persistenceOwner,
      companion_affect: evolvedAffectSnapshot,
    });
    flight.resolve({
      content: fullResponse,
      done: {
        done: true,
        visible: fullResponse,
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
        turn_id: turnId,
        user_message_id: turnStart.turn.userMessageId,
        assistant_message_id: turnStart.turn.assistantMessageId,
        persistence_status: "generated",
        persistence_owner: persistenceOwner,
        companion_affect: evolvedAffectSnapshot,
        joined: true,
      },
    });
    telemetry.report("completed", {
      provider: usedProvider,
      fallback_provider: failedOver ? usedProvider : null,
      model: usedModel,
      stream_stalled: false,
      persistence_status: "generated",
    });
  } catch (err) {
    logger.error({ err }, "Chat message stream failed");
    flight.fail(err);
    await markTurnFailed(turnId, userId, err).catch(() => {});
    writeSse(res, { error: streamErrorMessage(err) });
    telemetry.report("failed", {
      provider: usedProvider,
      model: usedModel,
      stream_timeout: err instanceof LlmStreamTimeoutError,
    });
  } finally {
    clearInterval(leaseHeartbeat);
    stopHeartbeat();
    try {
      if (!res.writableEnded) res.end();
    } catch {
      // The browser already left. Persistence below still saves the reply.
    }
  }

  void (async () => {
    try {
      try {
        await preStreamPersist;
      } catch (error) {
        logger.warn({ error, turnId }, "Pre-stream chat persistence failed");
      }
      if (!streamSucceeded || !String(fullResponse).trim()) return;

      const lateClient = clientLeft();
      const serverPersist = persistenceOwner === "server" && shouldPersist;
      if (serverPersist || lateClient) {
      const persistenceStartedAt = Date.now();
      try {
        const generatedTurn = await readChatTurn(turnId, userId);
        if (!generatedTurn) throw new Error("Generated turn checkpoint is missing");
        await retryTurnPersistence(generatedTurn);
        logger.info(
          {
            event: "chat_persistence",
            turn_id: turnId,
            session_id: sessionId,
            persistence_ms: Date.now() - persistenceStartedAt,
            persistence_status: "committed",
            retry_count: generatedTurn.retryCount,
          },
          "Chat turn committed",
        );
      } catch (error) {
        logger.warn(
          {
            error,
            turnId,
            sessionId,
            persistence_ms: Date.now() - persistenceStartedAt,
          },
          "Post-stream chat persistence failed; turn remains retryable",
        );
        return;
      }
    }
    if (!(persistenceOwner === "server" && shouldPersist) && !clientLeft()) return;

    // Save intimacy profile and scene updates if intimacy engine ran
    if (intimacyProfile) {
      void saveIntimacyProfile(intimacyProfile).catch((e) => logger.warn({ error: e }, "Failed to save intimacy profile"));
    }
    if (intimacyScene) {
      void saveIntimacyScene(intimacyScene).catch((e) => logger.warn({ error: e }, "Failed to save intimacy scene"));
    }

    // Relationship/evolution is derived state. Message + memory durability is
    // committed first; failures here are observable and can be rebuilt without
    // risking duplicate visible chat rows.
    try {
      const hiddenLife = body.metadata?.hidden_sequences as
        | { learned_life?: unknown[] }
        | undefined;
      await applyRelationshipPostProcess({
        userId,
        sessionId,
        turnId,
        characterIds,
        activeCharacterId,
        content,
        assistantContent: fullResponse,
        mode,
        isVoidTurn: mode === "void" || Boolean(body.deep_mode),
        significantExperienceCount: Array.isArray(hiddenLife?.learned_life)
          ? hiddenLife.learned_life.length
          : 0,
        synchroState,
        companionAffect,
      });
    } catch (postProcessError) {
      logger.warn(
        { postProcessError, turnId, sessionId },
        "Chat relationship/evolution post-processing failed",
      );
    }
    } finally {
      releaseBackground();
    }
  })();
});

export default router;
