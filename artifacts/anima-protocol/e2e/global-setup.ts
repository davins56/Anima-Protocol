import { clerkSetup } from "@clerk/testing/playwright";
import type { FullConfig } from "@playwright/test";

// Runs once before the suite. clerkSetup() fetches a "testing token" from the
// Clerk Backend API and stores it on process.env (CLERK_FAPI /
// CLERK_TESTING_TOKEN). Playwright workers are spawned AFTER global setup, so
// they inherit these vars. setupClerkTestingToken() (called internally by
// clerk.signIn) then appends the token to Frontend API requests, which is what
// lets us bypass the sign-up/sign-in bot protection (CAPTCHA).
async function globalSetup(_config: FullConfig) {
  const missing = [
    "CLERK_SECRET_KEY",
    "CLERK_PUBLISHABLE_KEY",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    throw new Error(
      `Cannot run the Anima e2e suite: missing env var(s) ${missing.join(
        ", ",
      )}. These are required for programmatic Clerk auth.`,
    );
  }

  await clerkSetup();
}

export default globalSetup;
