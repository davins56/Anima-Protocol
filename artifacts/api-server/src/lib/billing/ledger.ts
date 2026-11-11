/**
 * Append-only entitlement ledger + idempotent Stripe webhook handling.
 * Tables: billing_stripe_events (PK event_id), entitlement_ledger
 * (UNIQUE idempotency_key). Nothing here updates or deletes a row.
 */
import type Stripe from "stripe";
import { getPool } from "@workspace/db";
import { isOfferId, offerCatalog, type OfferId } from "./catalog";

export type Queryable = {
  query: <R = any>(text: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;
};
type Client = Queryable & { release?: () => void };
type PoolLike = { connect: () => Promise<Client> };

const DAY_MS = 86_400_000;

export type Grant = {
  userId: string;
  entitlement: OfferId;
  delta: number;
  idempotencyKey: string;
  checkoutSessionId: string;
};

/** Pure: what a paid Checkout Session grants, or null (unpaid / unknown / tampered). */
export function grantForSession(
  session: Pick<Stripe.Checkout.Session, "id" | "payment_status" | "metadata" | "client_reference_id">,
  catalog = offerCatalog(),
): Grant | null {
  if (session.payment_status !== "paid") return null;
  const userId = session.metadata?.user_id || "";
  const offer = session.metadata?.offer;
  if (!userId || !isOfferId(offer)) return null;
  // client_reference_id is set server-side at creation; both must agree.
  if (session.client_reference_id && session.client_reference_id !== userId) return null;
  return {
    userId,
    entitlement: offer,
    delta: catalog[offer].units,
    idempotencyKey: `checkout:${session.id}`,
    checkoutSessionId: session.id,
  };
}

/** Pure: deep mode extends from the later of now and the current expiry. */
export function nextActiveUntil(current: Date | null, days: number, now = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * DAY_MS);
}

export type WebhookOutcome = "duplicate" | "granted" | "recorded" | "ignored_livemode";

const FULFILL = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * Handle one verified event exactly once. Runs in a transaction: the event
 * row and any grant commit together, so a crash mid-way lets Stripe retry.
 */
export async function handleStripeEvent(event: Stripe.Event, pool: PoolLike = getPool() as any): Promise<WebhookOutcome> {
  if (event.livemode) return "ignored_livemode";
  const session =
    FULFILL.has(event.type) ? (event.data.object as Stripe.Checkout.Session) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO public.billing_stripe_events (event_id, event_type, livemode, user_id, checkout_session_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id, event.type, event.livemode, session?.metadata?.user_id ?? null, session?.id ?? null],
    );
    if (!inserted.rows.length) {
      await client.query("COMMIT");
      return "duplicate";
    }
    const grant = session ? grantForSession(session) : null;
    if (!grant) {
      await client.query("COMMIT");
      return "recorded";
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`entitlement:${grant.userId}`]);
    let activeUntil: Date | null = null;
    if (grant.entitlement === "deep_mode") {
      const cur = await client.query<{ active_until: Date | null }>(
        `SELECT MAX(active_until) AS active_until FROM public.entitlement_ledger
          WHERE user_id = $1 AND entitlement = 'deep_mode'`,
        [grant.userId],
      );
      activeUntil = nextActiveUntil(cur.rows[0]?.active_until ?? null, grant.delta);
    }
    // completed + async_payment_succeeded for one session grant once (unique key).
    await client.query(
      `INSERT INTO public.entitlement_ledger
         (user_id, entitlement, delta, reason, active_until, stripe_event_id, checkout_session_id, idempotency_key)
       VALUES ($1, $2, $3, 'purchase', $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [grant.userId, grant.entitlement, grant.delta, activeUntil, event.id, grant.checkoutSessionId, grant.idempotencyKey],
    );
    await client.query("COMMIT");
    return "granted";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release?.();
  }
}

export type Balances = {
  photo_credits: number;
  voice_minutes: number;
  deep_mode_active_until: string | null;
};

export async function entitlementBalances(userId: string, db: Queryable = getPool() as any): Promise<Balances> {
  const { rows } = await db.query<{ entitlement: string; balance: number; active_until: Date | null }>(
    `SELECT entitlement, balance, active_until FROM public.entitlement_balances WHERE user_id = $1`,
    [userId],
  );
  const out: Balances = { photo_credits: 0, voice_minutes: 0, deep_mode_active_until: null };
  for (const r of rows) {
    if (r.entitlement === "photo_credits") out.photo_credits = Number(r.balance) || 0;
    if (r.entitlement === "voice_minutes") out.voice_minutes = Number(r.balance) || 0;
    if (r.entitlement === "deep_mode" && r.active_until && new Date(r.active_until).getTime() > Date.now()) {
      out.deep_mode_active_until = new Date(r.active_until).toISOString();
    }
  }
  return out;
}

export class InsufficientEntitlementError extends Error {
  code = "insufficient_entitlement";
}

/**
 * Spend units (photo credits / voice minutes) as a negative ledger row.
 * The idempotency key makes a retried use free.
 */
export async function consumeEntitlement(
  input: { userId: string; entitlement: "photo_credits" | "voice_minutes"; units: number; idempotencyKey: string },
  pool: PoolLike = getPool() as any,
): Promise<number> {
  if (!Number.isInteger(input.units) || input.units <= 0) throw new Error("units must be a positive integer");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`entitlement:${input.userId}`]);
    const { rows } = await client.query<{ balance: number }>(
      `SELECT COALESCE(SUM(delta), 0)::integer AS balance FROM public.entitlement_ledger
        WHERE user_id = $1 AND entitlement = $2`,
      [input.userId, input.entitlement],
    );
    const balance = Number(rows[0]?.balance) || 0;
    const prior = await client.query(`SELECT 1 FROM public.entitlement_ledger WHERE idempotency_key = $1`, [
      `use:${input.idempotencyKey}`,
    ]);
    if (prior.rows.length) {
      await client.query("COMMIT");
      return balance;
    }
    if (balance < input.units) throw new InsufficientEntitlementError("Not enough credits.");
    await client.query(
      `INSERT INTO public.entitlement_ledger (user_id, entitlement, delta, reason, idempotency_key)
       VALUES ($1, $2, $3, 'use', $4)`,
      [input.userId, input.entitlement, -input.units, `use:${input.idempotencyKey}`],
    );
    await client.query("COMMIT");
    return balance - input.units;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release?.();
  }
}
