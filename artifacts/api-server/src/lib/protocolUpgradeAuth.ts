import { createClerkClient } from "@clerk/express";
import { logger } from "./logger";
import {
  emailFromSessionClaims,
  isProtocolSteward,
  stewardUserIds,
} from "./protocolUpgrade";

type ClerkLikeUser = {
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id?: string; emailAddress?: string }>;
};

export function primaryEmailFromClerkUser(user: ClerkLikeUser | null | undefined): string | null {
  if (!user?.emailAddresses?.length) return null;
  const primary = user.emailAddresses.find(
    (entry) => entry.id && entry.id === user.primaryEmailAddressId,
  );
  const email = primary?.emailAddress || user.emailAddresses[0]?.emailAddress;
  return email ? email.trim().toLowerCase() : null;
}

/**
 * The caller's email (session claim, else the Clerk Backend API). Used for
 * display labels and non-steward checks; it never makes anyone the steward.
 */
export async function resolveCallerEmail(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<string | null> {
  const fromClaims = emailFromSessionClaims(input.sessionClaims);
  if (fromClaims) return fromClaims;

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;

  try {
    const client = createClerkClient({ secretKey });
    const user = await client.users.getUser(input.userId);
    return primaryEmailFromClerkUser(user);
  } catch (err) {
    logger.warn({ err }, "Failed to resolve Clerk email");
    return null;
  }
}

let warnedUnconfigured = false;

/**
 * Steward gate shared by protocol upgrades, safety, repo codespace, own-model
 * and tutor routes. Authorizes by Clerk user id only (PROTOCOL_STEWARD_USER_IDS
 * / PROTOCOL_UPGRADE_ADMIN_USER_IDS). `email` is returned as a display label
 * from the session claims when present; it never grants access.
 */
export async function callerIsProtocolSteward(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<{ allowed: boolean; email: string | null }> {
  if (!stewardUserIds().length && !warnedUnconfigured) {
    warnedUnconfigured = true;
    logger.warn(
      "No steward configured: set PROTOCOL_STEWARD_USER_IDS to the steward's Clerk user id. Steward-only routes refuse everyone until then.",
    );
  }
  return {
    allowed: isProtocolSteward({ userId: input.userId }),
    email: emailFromSessionClaims(input.sessionClaims),
  };
}
