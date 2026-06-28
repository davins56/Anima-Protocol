import { clerkSetup } from "@clerk/testing/playwright";
import type { FullConfig } from "@playwright/test";
import { assertValidClerkE2EEnv } from "../src/lib/clerkE2EEnv";

// Runs once before the suite. clerkSetup() fetches a "testing token" from the
// Clerk Backend API and stores it on process.env (CLERK_FAPI /
// CLERK_TESTING_TOKEN). Playwright workers are spawned AFTER global setup, so
// they inherit these vars. setupClerkTestingToken() (called internally by
// clerk.signIn) then appends the token to Frontend API requests, which is what
// lets us bypass the sign-up/sign-in bot protection (CAPTCHA).
async function globalSetup(_config: FullConfig) {
  assertValidClerkE2EEnv(process.env);
  await clerkSetup();
}

export default globalSetup;
