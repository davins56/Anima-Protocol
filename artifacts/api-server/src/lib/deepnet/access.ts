/**
 * Deepnet (working name) access, decided on the server only (#757).
 *
 *   ANIMA_DEEPNET            on|1|true|yes enables the feature. Unset/anything else = off,
 *                            and every /api/deepnet route answers 404 (invisible).
 *   ANIMA_DEEPNET_USER_IDS   comma-separated Clerk user ids allowed in. Dàvīn sets it to his
 *                            own id; it is never committed. Empty = nobody.
 *
 * The client only displays what these return; it never decides access.
 */
export type DeepnetAccessReason = "flag_off" | "signed_out" | "not_allowlisted" | "ok";

export function deepnetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|on|true|yes)$/i.test(String(env.ANIMA_DEEPNET ?? "").trim());
}

export function deepnetAllowlist(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    String(env.ANIMA_DEEPNET_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^user_[A-Za-z0-9]+$/.test(s)),
  );
}

export function decideDeepnetAccess(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { allowed: boolean; reason: DeepnetAccessReason } {
  if (!deepnetEnabled(env)) return { allowed: false, reason: "flag_off" };
  if (!userId) return { allowed: false, reason: "signed_out" };
  if (!deepnetAllowlist(env).has(userId)) return { allowed: false, reason: "not_allowlisted" };
  return { allowed: true, reason: "ok" };
}
