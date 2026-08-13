import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  ensureSchemaOnce,
  proactiveMessagePreferences,
  pushSubscriptions,
} from "@workspace/db";
import {
  PROACTIVE_FREQUENCIES,
  normalizeProactiveFrequency,
  proactivePushConfigured,
  runProactiveMessageBatch,
  vapidPublicKey,
} from "../lib/proactiveMessages";
import { logger } from "../lib/logger";

const router = Router();

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

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 4096) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 4096;
}

router.get("/preferences", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const [[preference], [subscriptionCount]] = await Promise.all([
    db
      .select()
      .from(proactiveMessagePreferences)
      .where(eq(proactiveMessagePreferences.userId, userId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId)),
  ]);
  res.json({
    configured: proactivePushConfigured(),
    vapid_public_key: vapidPublicKey(),
    enabled: preference?.enabled ?? false,
    frequency_hours: normalizeProactiveFrequency(preference?.frequencyHours),
    subscribed: Number(subscriptionCount?.count ?? 0) > 0,
    last_sent_at: preference?.lastSentAt?.toISOString() ?? null,
  });
});

router.put("/preferences", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const enabled = req.body?.enabled === true;
  const requestedFrequency = Number(req.body?.frequency_hours);
  if (
    req.body?.frequency_hours !== undefined &&
    !PROACTIVE_FREQUENCIES.includes(
      requestedFrequency as (typeof PROACTIVE_FREQUENCIES)[number],
    )
  ) {
    res.status(400).json({ error: "Unsupported proactive message frequency" });
    return;
  }
  const frequencyHours = normalizeProactiveFrequency(requestedFrequency);
  if (enabled && !proactivePushConfigured()) {
    res.status(503).json({
      error: "Push notifications are not configured on this deployment",
      code: "push_not_configured",
    });
    return;
  }
  if (enabled) {
    const [subscriptionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (Number(subscriptionCount?.count ?? 0) === 0) {
      res.status(409).json({
        error: "Enable notifications on this device first",
        code: "subscription_required",
      });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(proactiveMessagePreferences)
    .where(eq(proactiveMessagePreferences.userId, userId))
    .limit(1);
  const cadenceChanged =
    existing && existing.frequencyHours !== frequencyHours;
  const nextMessageAt = enabled
    ? !existing?.enabled || cadenceChanged || !existing.nextMessageAt
      ? new Date(Date.now() + frequencyHours * 60 * 60 * 1000)
      : existing.nextMessageAt
    : null;
  const [saved] = await db
    .insert(proactiveMessagePreferences)
    .values({
      userId,
      enabled,
      frequencyHours,
      nextMessageAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: proactiveMessagePreferences.userId,
      set: {
        enabled,
        frequencyHours,
        nextMessageAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({
    enabled: saved.enabled,
    frequency_hours: saved.frequencyHours,
    next_message_at: saved.nextMessageAt?.toISOString() ?? null,
  });
});

router.post("/subscriptions", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const endpoint = req.body?.endpoint;
  const p256dh = req.body?.keys?.p256dh;
  const auth = req.body?.keys?.auth;
  if (!validEndpoint(endpoint) || !validKey(p256dh) || !validKey(auth)) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh, auth, updatedAt: new Date() },
    });
  res.status(201).json({ subscribed: true });
});

router.delete("/subscriptions", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const endpoint = req.body?.endpoint;
  if (!validEndpoint(endpoint)) {
    res.status(400).json({ error: "Invalid push subscription endpoint" });
    return;
  }
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  if (Number(remaining?.count ?? 0) === 0) {
    await db
      .update(proactiveMessagePreferences)
      .set({ enabled: false, nextMessageAt: null, updatedAt: new Date() })
      .where(eq(proactiveMessagePreferences.userId, userId));
  }
  res.json({ subscribed: false });
});

router.get("/proactive/run", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    res.status(503).json({ error: "CRON_SECRET is not configured" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const results = await runProactiveMessageBatch();
  const summary = results.reduce(
    (counts, result) => {
      counts[result.status] += 1;
      if (result.status === "sent") counts.delivered += result.delivered;
      return counts;
    },
    { sent: 0, skipped: 0, failed: 0, delivered: 0 },
  );
  if (summary.failed > 0) {
    logger.warn({ summary }, "Proactive message cron completed with failures");
  } else {
    logger.info({ summary }, "Proactive message cron completed");
  }
  res.json(summary);
});

export default router;
