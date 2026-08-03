import { createClerkClient } from "@clerk/backend";

// Backend client used to provision/cleanup throwaway test users. Sign-in
// itself happens in-browser via clerk.signIn (ticket strategy), so these users
// never need passwords or email verification — but Clerk requires a password
// at creation unless skipped.
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export type TestUser = { id: string; email: string };

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Creates an isolated Clerk user. The `+clerk_test` local-part marks it as a
// Clerk test identity (no real email is ever sent).
export async function createTestUser(label: string): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const email = `anima-e2e-${label}-${suffix}+clerk_test@example.com`;
  const user = await clerkClient.users.createUser({
    emailAddress: [email],
    password: `E2e-${suffix}-${Math.random().toString(36).slice(2, 10)}!`,
    skipPasswordChecks: true,
    firstName: label.toUpperCase(),
    lastName: "E2E",
  });
  return { id: user.id, email };
}

// Best-effort cleanup — never let teardown failures fail the suite.
export async function deleteTestUser(id: string | undefined): Promise<void> {
  if (!id) return;
  try {
    await clerkClient.users.deleteUser(id);
  } catch {
    // ignore: user may already be gone
  }
}
