import { Router } from "express";
import { db, conversations, messages } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../../lib/rateLimit";
import { isModelUnavailableError, resolveModel, routeModel } from "../../lib/modelRouter";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();

router.use(rateLimit);

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
  const { content, systemPrompt, deepMode } = req.body as { content: string; systemPrompt?: string; deepMode?: boolean };

  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (systemPrompt) chatMessages.push({ role: "system", content: systemPrompt });
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
    const standard = resolveModel("standard");
    let usedModel = routed.model;
    let usedTier = routed.tier;

    let stream;
    try {
      stream = await openai.chat.completions.create({
        model: routed.model,
        max_tokens: routed.maxTokens,
        messages: chatMessages,
        stream: true,
      });
    } catch (modelErr) {
      // Only fall back when the routed model itself is unavailable to this
      // account; quota / rate-limit / transient errors surface as-is so we don't
      // burn a second call or hide the real cause.
      if (routed.model !== standard.model && isModelUnavailableError(modelErr)) {
        usedModel = standard.model;
        usedTier = standard.tier;
        stream = await openai.chat.completions.create({
          model: standard.model,
          max_tokens: standard.maxTokens,
          messages: chatMessages,
          stream: true,
        });
      } else {
        throw modelErr;
      }
    }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullResponse });
    res.write(`data: ${JSON.stringify({ done: true, model: usedModel, tier: usedTier })}\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }

  res.end();
});

export default router;
