import { Router } from "express";
import { db, conversations, messages } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../../lib/rateLimit";
import { routeModel } from "../../lib/modelRouter";
import { createChatStreamWithFailover } from "../../lib/llmFailover";

const router = Router();

router.use(createRateLimit({ name: "openai-chat", max: 60 }));

router.get("/conversations", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(conversations.createdAt);
  res.json(rows);
});

router.post("/conversations", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { title } = req.body as { title?: string };
  const [row] = await db.insert(conversations).values({ userId, title: title || "New conversation" }).returning();
  res.status(201).json(row);
});

router.get("/conversations/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json({ ...conv, messages: msgs });
});

router.delete("/conversations/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).send();
});

router.get("/conversations/:id/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/conversations/:id/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
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

  // When the caller wants structured output, append a strict JSON-only
  // instruction (with the schema inlined) to the system prompt rather than
  // adding a second system message — providers vary in how many system turns
  // they honor, but all of them respect one combined instruction block.
  const effectiveSystemPrompt = responseJsonSchema
    ? `${systemPrompt ? `${systemPrompt}\n\n` : ""}Respond with ONLY a single valid JSON object — no markdown code fences, no commentary before or after — matching this JSON schema:\n${JSON.stringify(responseJsonSchema)}`
    : systemPrompt;

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (effectiveSystemPrompt) chatMessages.push({ role: "system", content: effectiveSystemPrompt });
  chatMessages.push(
    ...history.slice(-14).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    // Pick the model from the latest message's stakes plus per-conversation
    // context: an explicit deep-mode toggle, and how deep this thread already is
    // (history includes the user message we just inserted).
    const routed = routeModel(content, { deepMode, conversationDepth: history.length });
    // Callers (e.g. structured-output helpers) may ask for a smaller budget
    // than the tier default; never let it exceed the tier's ceiling.
    const maxTokens =
      typeof requestedMaxTokens === "number" &&
      Number.isFinite(requestedMaxTokens) &&
      requestedMaxTokens > 0
        ? Math.min(requestedMaxTokens, routed.maxTokens)
        : routed.maxTokens;
    const completion = await createChatStreamWithFailover({
      tier: routed.tier,
      model: routed.model,
      maxTokens,
      messages: chatMessages,
    });

    for await (const chunk of completion.stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullResponse });
    res.write(
      `data: ${JSON.stringify({
        done: true,
        model: completion.model,
        tier: completion.tier,
        provider: completion.provider,
        failed_over: completion.failedOver,
      })}\n\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }

  res.end();
});

export default router;
