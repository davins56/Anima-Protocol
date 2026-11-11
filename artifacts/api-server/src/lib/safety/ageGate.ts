/**
 * Age gate for adult mode. Server-enforced: chat ignores the client's
 * adult flag unless the latest age_attestations row is `attested`.
 *
 * Providers are pluggable. Today only `self_declared_dob` exists (the user
 * enters a date of birth; we check it is a real date and ≥ 18). A
 * third-party verifier (ID/selfie/age estimation) implements
 * AgeVerificationProvider and is selected with ANIMA_AGE_PROVIDER — see
 * docs/safety-gates.md.
 */
import { getPool } from "@workspace/db";

export const MIN_ADULT_AGE = 18;

export type AttestationStatus = "attested" | "rejected" | "revoked";
export type AttestationRow = {
  status: AttestationStatus;
  method: "self_declared_dob" | "provider";
  provider: string | null;
  birth_year: number | null;
  age_years: number | null;
  attested_at: string | Date;
};

export class AgeInputError extends Error {
  code = "invalid_dob";
}

/** Pure: parse a strict YYYY-MM-DD date that exists on the calendar. */
export function parseDob(raw: unknown): { year: number; month: number; day: number } {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  if (!m) throw new AgeInputError("Enter your date of birth as YYYY-MM-DD.");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new AgeInputError("That date doesn't exist.");
  }
  return { year, month, day };
}

/** Pure: completed years on `now` (UTC). Throws for future / implausible dates. */
export function ageOn(dob: { year: number; month: number; day: number }, now = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  let age = y - dob.year;
  if (m < dob.month || (m === dob.month && d < dob.day)) age -= 1;
  if (age < 0) throw new AgeInputError("Date of birth is in the future.");
  if (age > 120) throw new AgeInputError("Please check the year.");
  return age;
}

export type ProviderResult =
  | { status: "attested" | "rejected"; birthYear: number | null; ageYears: number | null; providerRef?: string | null };

export interface AgeVerificationProvider {
  id: string;
  method: AttestationRow["method"];
  verify(input: { userId: string; dob?: unknown }, now?: Date): Promise<ProviderResult>;
}

export const selfDeclaredDobProvider: AgeVerificationProvider = {
  id: "self_declared_dob",
  method: "self_declared_dob",
  async verify({ dob }, now = new Date()) {
    const parsed = parseDob(dob);
    const age = ageOn(parsed, now);
    return { status: age >= MIN_ADULT_AGE ? "attested" : "rejected", birthYear: parsed.year, ageYears: age };
  },
};

const PROVIDERS: Record<string, AgeVerificationProvider> = {
  [selfDeclaredDobProvider.id]: selfDeclaredDobProvider,
};

/** Register a third-party verifier (e.g. at boot, behind its own env keys). */
export function registerAgeProvider(p: AgeVerificationProvider): void {
  PROVIDERS[p.id] = p;
}

export function activeAgeProvider(env = process.env): AgeVerificationProvider {
  return PROVIDERS[env.ANIMA_AGE_PROVIDER?.trim() || ""] ?? selfDeclaredDobProvider;
}

/** Pure: is this latest row a valid adult attestation? */
export function isAdultAttested(row: Pick<AttestationRow, "status" | "age_years"> | null | undefined): boolean {
  if (!row || row.status !== "attested") return false;
  return row.age_years == null || row.age_years >= MIN_ADULT_AGE;
}

/**
 * Pure: a self-declared under-age result locks self-declaration; only a
 * provider check can lift it (stops "try another birthday").
 */
export function selfDeclarationLocked(history: Array<Pick<AttestationRow, "status" | "method">>): boolean {
  return history.some((r) => r.status === "rejected" && r.method === "self_declared_dob");
}

export type Queryable = {
  query: <R = any>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

export async function latestAttestation(userId: string, db: Queryable = getPool() as any): Promise<AttestationRow | null> {
  const { rows } = await db.query<AttestationRow>(
    `SELECT status, method, provider, birth_year, age_years, attested_at
       FROM public.age_attestation_latest WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function attestationHistory(userId: string, db: Queryable = getPool() as any): Promise<AttestationRow[]> {
  const { rows } = await db.query<AttestationRow>(
    `SELECT status, method, provider, birth_year, age_years, attested_at
       FROM public.age_attestations WHERE user_id = $1 ORDER BY attested_at DESC LIMIT 50`,
    [userId],
  );
  return rows;
}

export async function appendAttestation(
  row: { userId: string; status: AttestationStatus; method: AttestationRow["method"]; provider?: string | null; providerRef?: string | null; birthYear?: number | null; ageYears?: number | null },
  db: Queryable = getPool() as any,
): Promise<AttestationRow> {
  const { rows } = await db.query<AttestationRow>(
    `INSERT INTO public.age_attestations (user_id, status, method, provider, provider_ref, birth_year, age_years, min_age)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING status, method, provider, birth_year, age_years, attested_at`,
    [row.userId, row.status, row.method, row.provider ?? null, row.providerRef ?? null, row.birthYear ?? null, row.ageYears ?? null, MIN_ADULT_AGE],
  );
  invalidateAdultCache(row.userId);
  return rows[0];
}

const CACHE_MS = 60_000;
const adultCache = new Map<string, { ok: boolean; at: number }>();

/** Hot-path check for chat (cached 60 s; invalidated on every new row). Fails closed. */
export async function userIsAdultAttested(userId: string, db?: Queryable): Promise<boolean> {
  const hit = adultCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  let ok = false;
  try {
    ok = isAdultAttested(await latestAttestation(userId, db));
  } catch {
    ok = false;
  }
  adultCache.set(userId, { ok, at: Date.now() });
  return ok;
}

export function invalidateAdultCache(userId?: string): void {
  if (userId) adultCache.delete(userId);
  else adultCache.clear();
}
