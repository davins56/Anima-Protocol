import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chargeUsage,
  deepModeAllowed,
  freeAllowance,
  refundUsage,
  ttsUnitsForText,
} from "../src/lib/billing/meter";
import { InsufficientEntitlementError, refundEntitlement } from "../src/lib/billing/ledger";
import { createMemoryUserLimiter } from "../src/lib/usage/userRateLimit";

const env = (extra: Record<string, string> = {}) => ({
  ANIMA_FREE_PHOTOS_PER_DAY: "1",
  ANIMA_RL_PHOTO_PER_MIN: "100",
  ANIMA_RL_PHOTO_PER_DAY: "100",
  ...extra,
});

function deps(extra: Record<string, unknown> = {}) {
  return {
    limiter: createMemoryUserLimiter(),
    consume: vi.fn(async () => 5),
    refund: vi.fn(async () => true),
    env: env(),
    ...extra,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("chargeUsage", () => {
  it("uses the free daily allowance first, then purchased credits with a server key", async () => {
    const d = deps();
    const first = await chargeUsage({ userId: "u1", kind: "photo" }, d);
    expect(first).toMatchObject({ ok: true, charge: { source: "free" } });
    expect(d.consume).not.toHaveBeenCalled();

    const second = await chargeUsage({ userId: "u1", kind: "photo" }, d);
    expect(second).toMatchObject({ ok: true, charge: { source: "ledger" } });
    expect(d.consume).toHaveBeenCalledTimes(1);
    const call = (d.consume.mock.calls[0] as unknown[])[0] as { idempotencyKey: string; entitlement: string; units: number };
    expect(call.entitlement).toBe("photo_credits");
    expect(call.units).toBe(1);
    expect(call.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers 402 when free use is spent and there are no credits (or no ledger table)", async () => {
    const d = deps({ consume: vi.fn(async () => { throw new InsufficientEntitlementError("no"); }) });
    await chargeUsage({ userId: "u2", kind: "photo" }, d);
    const denied = await chargeUsage({ userId: "u2", kind: "photo" }, d);
    expect(denied).toMatchObject({
      ok: false,
      denied: { status: 402, body: { code: "insufficient_entitlement", entitlement: "photo_credits", free_per_day: 1 } },
    });

    const missing = deps({ consume: vi.fn(async () => { throw Object.assign(new Error("relation"), { code: "42P01" }); }) });
    await chargeUsage({ userId: "u3", kind: "photo" }, missing);
    expect((await chargeUsage({ userId: "u3", kind: "photo" }, missing)) as { denied?: { status: number } }).toMatchObject({
      denied: { status: 402 },
    });
  });

  it("fails closed with 503 when the ledger errors otherwise", async () => {
    const d = deps({ env: env({ ANIMA_FREE_PHOTOS_PER_DAY: "0" }), consume: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await chargeUsage({ userId: "u4", kind: "photo" }, d)).toMatchObject({
      ok: false,
      denied: { status: 503, body: { code: "metering_unavailable" } },
    });
  });

  it("enforces the burst limit before anything else", async () => {
    const d = deps({ env: env({ ANIMA_RL_PHOTO_PER_MIN: "1" }) });
    await chargeUsage({ userId: "u5", kind: "photo" }, d);
    const limited = await chargeUsage({ userId: "u5", kind: "photo" }, d);
    expect(limited).toMatchObject({ ok: false, denied: { status: 429 } });
    expect(d.consume).not.toHaveBeenCalled();
  });

  it("honours the kill switch and exempt users", async () => {
    const off = deps({ env: env({ ANIMA_METERING: "off", ANIMA_FREE_PHOTOS_PER_DAY: "0" }) });
    expect(await chargeUsage({ userId: "u6", kind: "photo" }, off)).toMatchObject({ ok: true, charge: { source: "exempt" } });
    const exempt = deps({ env: env({ ANIMA_METERING_EXEMPT_USER_IDS: "user_steward", ANIMA_FREE_PHOTOS_PER_DAY: "0" }) });
    expect(await chargeUsage({ userId: "user_steward", kind: "photo" }, exempt)).toMatchObject({ ok: true, charge: { source: "exempt" } });
    expect(exempt.consume).not.toHaveBeenCalled();
  });
});

describe("refundUsage", () => {
  it("returns a free unit so the next call is free again", async () => {
    const d = deps();
    const first = await chargeUsage({ userId: "r1", kind: "photo" }, d);
    if (!first.ok) throw new Error("expected ok");
    await refundUsage(first.charge, d);
    await refundUsage(first.charge, d); // second call is a no-op
    expect(await chargeUsage({ userId: "r1", kind: "photo" }, d)).toMatchObject({ ok: true, charge: { source: "free" } });
  });

  it("writes a ledger refund for the same key", async () => {
    const d = deps({ env: env({ ANIMA_FREE_PHOTOS_PER_DAY: "0" }) });
    const paid = await chargeUsage({ userId: "r2", kind: "photo", units: 2 }, d);
    if (!paid.ok) throw new Error("expected ok");
    await refundUsage(paid.charge, d);
    expect(d.refund).toHaveBeenCalledWith({
      userId: "r2",
      entitlement: "photo_credits",
      units: 2,
      idempotencyKey: paid.charge.key,
    });
  });
});

describe("refundEntitlement", () => {
  it("appends an idempotent 'refund' row tied to the original use", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "r" }] }));
    expect(
      await refundEntitlement({ userId: "u", entitlement: "voice_minutes", units: 3, idempotencyKey: "k1" }, { query } as never),
    ).toBe(true);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/'refund'/);
    expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/);
    expect(values).toEqual(["u", "voice_minutes", 3, "refund:use:k1", "use:k1"]);
  });
});

describe("deep mode and helpers", () => {
  it("allows deep mode only with an active pass", async () => {
    const active = { photo_credits: 0, voice_minutes: 0, deep_mode_active_until: "2099-01-01T00:00:00Z" };
    const none = { ...active, deep_mode_active_until: null };
    expect(await deepModeAllowed("u", { env: {}, balances: async () => active })).toBe(true);
    expect(await deepModeAllowed("u", { env: {}, balances: async () => none })).toBe(false);
    expect(await deepModeAllowed("u", { env: {}, balances: async () => { throw new Error("x"); } })).toBe(false);
    expect(await deepModeAllowed("u", { env: { ANIMA_METERING: "off" }, balances: async () => none })).toBe(true);
  });

  it("sizes TTS and free allowances", () => {
    expect(ttsUnitsForText("hi")).toBe(1);
    expect(ttsUnitsForText("x".repeat(1801))).toBe(3);
    expect(freeAllowance("photo", {})).toBe(10);
    expect(freeAllowance("voice", { ANIMA_FREE_VOICE_UNITS_PER_DAY: "5" })).toBe(5);
  });
});
