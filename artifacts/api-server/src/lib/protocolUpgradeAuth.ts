import { createClerkClient } from "@clerk/express";
import { logger } from "./logger";
import {
  emailFromSessionClaims,
  isProtocolSteward,
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
    logger.warn({ err }, "Failed to resolve Clerk email for protocol upgrade");
    return null;
  }
}

export async function callerIsProtocolSteward(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<{ allowed: boolean; email: string | null }> {
  if (isProtocolSteward({ userId: input.userId, email: null })) {
    return { allowed: true, email: emailFromSessionClaims(input.sessionClaims) };
  }
  const email = await resolveCallerEmail(input);
  return { allowed: isProtocolSteward({ userId: input.userId, email }), email };
}
