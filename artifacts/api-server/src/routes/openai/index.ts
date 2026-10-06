import { Router, type Request, type Response } from "express";
import { db, conversations, messages } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../../lib/rateLimit";
import { routeModel } from "../../lib/modelRouter";
import {
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
  usesFreeTierOpenBudget,
} from "../../lib/llmFailover";
import {
  consumeLlmStream,
  LlmStreamTimeoutError,
} from "../../lib/consumeLlmStream";
import {
  capBackgroundNumPredict,
  combineAbortSignals,
  LLM_BACKGROUND_WALL_MS,
  llmOpenTimeoutMs,
  openStreamAbort,
} from "../../lib/chatTimeouts";
import { shouldSkipSidecarLlm } from "../../lib/sidecarLlm";
import { acquireLocalLlmBackground } from "../../lib/localLlmSlot";
import { visibleAssistantReply } from "../../lib/visibleAssistantReply";

const router = Router();

router.use(createRateLimit({ name: "openai-chat", max: 60 }));

const SSE_HEARTBEAT_MS = 8_000;

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

function requireUserId(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

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

function openaiStreamError(err: unknown): string {
  if (err instanceof LlmStreamTimeoutError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);
  if (/aborted|abort/i.test(raw)) {
    return "The companion took too long to reply. Please try again.";
  }
  if (/workers ai|deepseek/i.test(raw)) return raw;
  return raw || "The companion could not reply. Please try again.";
}

function beginSse(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

function resolveMaxTokens(
  requested: unknown,
  ceiling: number,
): number {
  return typeof requested === "number" &&
    Number.isFinite(requested) &&
    requested > 0
    ? Math.min(requested, ceiling)
    : ceiling;
}

function lastUserText(chatMessages: ChatMessage[]): string {
  for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
    if (chatMessages[i]?.role === "user") return chatMessages[i]!.content;
  }
  return "";
}

async function streamSignedInCompletion(
  res: Response,
  opts: {
    chatMessages: ChatMessage[];
    deepMode?: boolean;
    conversationDepth?: number;
    requestedMaxTokens?: number;
    signal?: AbortSignal;
    onComplete?: (
      fullResponse: string,
      meta: {
        model: string;
        tier: string;
        provider: string;
        failedOver: boolean;
      },
    ) => Promise<void>;
  },
): Promise<void> {
  beginSse(res);
  const stopHeartbeat = startSseHeartbeat(res);
  try {
    const routed = routeModel(lastUserText(opts.chatMessages), {
      deepMode: opts.deepMode,
      conversationDepth: opts.conversationDepth ?? opts.chatMessages.length,
    });
    const maxTokens = opts.signal
      ? capBackgroundNumPredict(resolveMaxTokens(opts.requestedMaxTokens, routed.maxTokens))
      : resolveMaxTokens(opts.requestedMaxTokens, routed.maxTokens);
    const open = openStreamAbort(
      opts.signal
        ? LLM_BACKGROUND_WALL_MS
        : llmOpenTimeoutMs({ freeTierCascade: usesFreeTierOpenBudget() }),
    );
    let completion;
    try {
      completion = await createChatStreamWithFailover({
        tier: routed.tier,
        model: routed.model,
        maxTokens,
        messages: opts.chatMessages,
        signal: opts.signal ? combineAbortSignals(open.signal, opts.signal) : open.signal,
        localOnly: Boolean(opts.signal),
      });
    } finally {
      open.cancel();
    }

    const streamed = await consumeLlmStream(completion.stream, {
      onDelta: (delta) => writeSse(res, { content: delta }),
      onReasoning: () => writeSse(res, { status: "thinking" }),
    });
    const fullResponse = visibleAssistantReply(streamed.content);
    if (!String(fullResponse).trim()) {
      throw new Error("The companion returned an empty reply. Please try again.");
    }

    await opts.onComplete?.(fullResponse, {
      model: completion.model,
      tier: completion.tier,
      provider: completion.provider,
      failedOver: completion.failedOver,
    });

    writeSse(res, {
      done: true,
      model: completion.model,
      tier: completion.tier,
      provider: completion.provider,
      failed_over: completion.failedOver,
    });
  } catch (err) {
    writeSse(res, { error: openaiStreamError(err) });
  } finally {
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }
}

/**
 * Book of Echoes and Serenity ambient replies are post-turn sidecar
 * completions. Local-only chat skips them with the same gate as emotion
 * and memory extraction so they do not take the single Ollama slot.
 */
function respondSkippedSidecar(res: Response, stream: boolean): void {
  if (!stream) {
    res.json({
      id: "chatcmpl-anima",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
      skipped: true,
    });
    return;
  }
  beginSse(res);
  writeSse(res, { done: true, skipped: true });
  res.end();
}

function jsonSystemPrompt(
  systemPrompt: string | undefined,
  responseJsonSchema: Record<string, unknown> | undefined,
): string | undefined {
  if (!responseJsonSchema) return systemPrompt;
  return `${systemPrompt ? `${systemPrompt}\n\n` : ""}Respond with ONLY a single valid JSON object — no markdown code fences, no commentary before or after — matching this JSON schema:\n${JSON.stringify(responseJsonSchema)}`;
}

router.get("/conversations", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const rows = await db.select().from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(conversations.createdAt);
  res.json(rows);
});

router.post("/conversations", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { title } = req.body as { title?: string };
  const [row] = await db.insert(conversations).values({ userId, title: title || "New conversation" }).returning();
  res.status(201).json(row);
});

router.get("/conversations/:id", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json({ ...conv, messages: msgs });
});

router.delete("/conversations/:id", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).send();
});

router.get("/conversations/:id/messages", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/conversations/:id/messages", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  const {
    content,
    systemPrompt,
    deepMode,
    responseJsonSchema,
    maxTokens: requestedMaxTokens,
  } = req.body as {
    content: string;
    systemPrompt?: string;
    deepMode?: boolean;
    responseJsonSchema?: Record<string, unknown>;
    maxTokens?: number;
  };

  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  const effectiveSystemPrompt = jsonSystemPrompt(systemPrompt, responseJsonSchema);

  const chatMessages: ChatMessage[] = [];
  if (effectiveSystemPrompt) chatMessages.push({ role: "system", content: effectiveSystemPrompt });
  chatMessages.push(
    ...history.slice(-14).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))
  );

  await streamSignedInCompletion(res, {
    chatMessages,
    deepMode,
    conversationDepth: history.length,
    requestedMaxTokens,
    onComplete: async (fullResponse) => {
      await db.insert(messages).values({
        conversationId: id,
        role: "assistant",
        content: fullResponse,
      });
    },
  });
});

/**
 * Authenticated OpenAI-shaped chat completions used by InvokeLLM / Chat
 * follow-ups. Clerk Bearer is required — `/api/ai/chat` staying 200 without
 * a session does not prove this path.
 */
router.post("/v1/chat/completions", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const body = req.body as {
    messages?: Array<{ role?: string; content?: unknown }>;
    content?: string;
    systemPrompt?: string;
    system_prompt?: string;
    deepMode?: boolean;
    deep_mode?: boolean;
    responseJsonSchema?: Record<string, unknown>;
    response_json_schema?: Record<string, unknown>;
    max_tokens?: number;
    maxTokens?: number;
    stream?: boolean;
    sidecar?: boolean;
  };

  if (body.sidecar === true && shouldSkipSidecarLlm()) {
    respondSkippedSidecar(res, body.stream !== false);
    return;
  }
  const background = await acquireLocalLlmBackground(
    body.sidecar === true ? "openai-sidecar" : "openai-user",
    { job: body.sidecar === true ? "sidecar" : "openai-user" },
  );
  if (!background) {
    if (body.sidecar === true) {
      respondSkippedSidecar(res, body.stream !== false);
      return;
    }
    res.status(429).json({
      error: "The companion is using the model. Try again in a moment.",
      code: "llm_busy",
    });
    return;
  }

  const systemPrompt = jsonSystemPrompt(
    body.systemPrompt || body.system_prompt,
    body.responseJsonSchema || body.response_json_schema,
  );
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const chatMessages: ChatMessage[] = [];
  if (systemPrompt) chatMessages.push({ role: "system", content: systemPrompt });
  for (const message of incoming) {
    const role = message?.role;
    if (role !== "system" && role !== "user" && role !== "assistant") continue;
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    chatMessages.push({ role, content });
  }
  if (typeof body.content === "string" && body.content.trim()) {
    chatMessages.push({ role: "user", content: body.content });
  }

  if (!chatMessages.some((message) => message.role === "user")) {
    await background?.release();
    res.status(400).json({ error: "messages or content is required" });
    return;
  }

  const requestedMaxTokens = body.max_tokens ?? body.maxTokens;
  const deepMode = Boolean(body.deepMode ?? body.deep_mode);
  const stream = body.stream !== false;

  if (!stream) {
    try {
      const routed = routeModel(lastUserText(chatMessages), {
        deepMode,
        conversationDepth: chatMessages.length,
      });
      const completion = await createChatCompletionWithFailover({
        tier: routed.tier,
        model: routed.model,
        maxTokens: background.maxTokens(resolveMaxTokens(requestedMaxTokens, routed.maxTokens)),
        messages: chatMessages,
        signal: background.signal,
        localOnly: true,
      });
      const content = visibleAssistantReply(completion.content);
      if (!String(content).trim()) {
        throw new Error("The companion returned an empty reply. Please try again.");
      }
      res.json({
        id: "chatcmpl-anima",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        model: completion.model,
        provider: completion.provider,
      });
    } catch (err) {
      res.status(502).json({ error: openaiStreamError(err) });
    } finally {
      await background?.release();
    }
    return;
  }

  try {
  await streamSignedInCompletion(res, {
    chatMessages,
    deepMode,
    conversationDepth: chatMessages.length,
    requestedMaxTokens,
    signal: background.signal,
  });
  } finally {
    await background?.release();
  }
});

export default router;
