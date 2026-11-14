/**
 * Server-side admin / steward role for the signed-in account.
 *
 * The client used to decide "admin" from a hardcoded email list plus the
 * build-time VITE_ADMIN_EMAILS, which shipped those addresses in the public
 * bundle (security audit 2026-11-14, L3). The allowlist now lives on the
 * server only; the client asks `GET /api/account/role`.
 *
 * - The Protocol steward (lib/protocolUpgradeAuth.ts) is always an admin.
 * - ANIMA_ADMIN_USER_IDS: comma-separated Clerk user ids (preferred).
 * - ANIMA_ADMIN_EMAILS: comma-separated emails, matched against the caller's
 *   Clerk primary email. Server env only — never a VITE_ variable.
 *
 * The role only shapes UI. Every privileged route still checks on its own.
 */
import { parseCsvEnv } from "./protocolUpgrade";
import { callerIsProtocolSteward, resolveCallerEmail } from "./protocolUpgradeAuth";

export type AccountRole = {
  role: "admin" | "user";
  isSteward: boolean;
};

export function adminUserIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseCsvEnv(env.ANIMA_ADMIN_USER_IDS);
}

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseCsvEnv(env.ANIMA_ADMIN_EMAILS);
}

export async function resolveAccountRole(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<AccountRole> {
  const steward = await callerIsProtocolSteward(input);
  if (steward.allowed) return { role: "admin", isSteward: true };

  const userId = input.userId.trim().toLowerCase();
  if (userId && adminUserIds().includes(userId)) return { role: "admin", isSteward: false };

  const emails = adminEmails();
  if (emails.length) {
    const email = steward.email ?? (await resolveCallerEmail(input));
    if (email && emails.includes(email.trim().toLowerCase())) {
      return { role: "admin", isSteward: false };
    }
  }
  return { role: "user", isSteward: false };
}
