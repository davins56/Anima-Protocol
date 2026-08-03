import { test, expect, type Page, type Browser } from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { createTestUser, deleteTestUser, type TestUser } from "./clerk-backend";

// A starter every BRAND-NEW (empty) account is seeded with on first sign-in. We
// wait for it before restoring so the restore genuinely runs against a NON-empty
// account (the /restore path, not the empty-only /import path), and we re-check
// it afterwards: merge must KEEP it, replace must WIPE it.
const STARTER_CHARACTER = "Korra";

// Unique per run so concurrent/repeated runs can't collide on names or ids.
const rand = Math.random().toString(36).slice(2, 8);

// Build a backup payload in the exact shape /export produces and parseBackup
// accepts: { version, exported_at, entities, profile }. The ChatSession is in
// the LEGACY shape — its `messages` live as an inline blob on the session
// record (NOT as separate ChatMessage rows). The server preserves that blob on
// restore and lazily splits it into ChatMessage rows the first time the session
// is read (GET /messages -> migrateSessionMessages). So a rendered message
// proves the conversation — not just the character — came back through restore.
function makeBackup(tag: string) {
  const charId = `restore-char-${tag}-${rand}`;
  const charName = `RestoredHero ${tag} ${rand}`;
  const sessionId = `restore-session-${tag}-${rand}`;
  const userMessage = `RestoredUserMsg ${tag} ${rand}`;
  const assistantMessage = `RestoredReplyMsg ${tag} ${rand}`;
  const backup = {
    version: 1,
    exported_at: "2024-02-02T10:00:00.000Z",
    entities: {
      Character: [
        {
          id: charId,
          name: charName,
          universe: "Backup Saga",
          category: "warrior",
          status: "online",
          avatar_url: "",
          personality: "A character that lived only inside a backup file.",
          backstory: "Exported long ago, restored from a JSON backup.",
          speaking_style: "Plain.",
        },
      ],
      ChatSession: [
        {
          id: sessionId,
          title: `Chat with ${charName}`,
          character_id: charId,
          mode: "solo",
          created_date: "2024-02-02T09:00:00.000Z",
          updated_date: "2024-02-02T09:05:00.000Z",
          messages: [
            {
              id: `restore-msg-user-${tag}-${rand}`,
              role: "user",
              content: userMessage,
              timestamp: "2024-02-02T09:01:00.000Z",
            },
            {
              id: `restore-msg-assistant-${tag}-${rand}`,
              role: "assistant",
              content: assistantMessage,
              character_name: charName,
              timestamp: "2024-02-02T09:02:00.000Z",
            },
          ],
        },
      ],
    },
    profile: { display_name: `Restored ${tag}` },
  };
  return { charId, charName, sessionId, userMessage, assistantMessage, backup };
}

let userMerge: TestUser;
let userReplace: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Re-run clerkSetup inside the worker process so this process's env
  // (CLERK_FAPI / CLERK_TESTING_TOKEN) is populated for setupClerkTestingToken.
  await clerkSetup();
  userMerge = await createTestUser("restore-merge");
  userReplace = await createTestUser("restore-replace");
});

test.afterAll(async () => {
  await deleteTestUser(userMerge?.id);
  await deleteTestUser(userReplace?.id);
});

// The analytics consent banner is persisted via mixpanel (not localStorage), so
// it can reappear; dismiss it if present.
async function dismissOverlays(page: Page): Promise<void> {
  const consentAccept = page
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  if (await consentAccept.isVisible().catch(() => false)) {
    await consentAccept.click();
  }
}

// A fresh context that pre-accepts the AI disclaimer (z-999 modal that would
// otherwise intercept clicks) and hides the Replit dev banner. The disclaimer
// is set in localStorage BEFORE any app code runs; the banner style is deferred
// to DOMContentLoaded and appended to <head> — touching document.documentElement
// inside an init script corrupts the streamed document and yields an empty page.
async function newReadyContext(browser: Browser) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ai_disclaimer_accepted", "true");
    } catch {
      /* ignore storage errors */
    }
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "#replit-dev-banner{display:none!important;pointer-events:none!important;}";
      document.head.appendChild(style);
    });
  });
  return context;
}

function characterHeading(page: Page, name: string) {
  return page.getByRole("heading", { name, exact: true });
}

async function signIn(page: Page, user: TestUser): Promise<void> {
  // Install the Clerk testing token BEFORE the first navigation so the initial
  // bot-protected Frontend API requests are tokenized (otherwise Clerk never
  // finishes loading and clerk.signIn's "loaded" wait times out).
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
}

// Navigate to /characters and wait for the named character heading. Bootstrap
// (migration + seeding) runs asynchronously after sign-in and the page's own
// cross-device poller suppresses its self-writes, so a FRESH navigation is what
// surfaces newly-written server data. Each attempt waits for the lazy route
// chunk AND the heading before retrying (a count right after goto would just
// see the Suspense "Loading..." fallback).
async function openCharactersAndWaitFor(
  page: Page,
  name: string,
  attempts = 4,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    await page.goto("/characters");
    await dismissOverlays(page);
    try {
      await expect(characterHeading(page, name)).toBeVisible({
        timeout: 20_000,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Open a conversation directly by its (preserved) session id and wait for the
// named message to render. Opening the session is what triggers the server's
// lazy split of the legacy inline `messages` blob into ChatMessage rows AND
// re-fetches them, so a visible message proves the history reached the account
// server-side via restore, not just a stale local cache.
async function openSessionAndWaitFor(
  page: Page,
  sessionId: string,
  messageText: string,
  attempts = 4,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    await page.goto(`/chat/${sessionId}`);
    await dismissOverlays(page);
    try {
      await expect(page.getByText(messageText, { exact: false })).toBeVisible({
        timeout: 20_000,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Drive the REAL user restore flow in Settings: open Data & Privacy, upload the
// backup file, then confirm merge or replace. This exercises the user-facing
// /store/restore path (not the one-time /import migration), including replace's
// two-step "Replace Everything" confirmation.
async function restoreViaSettings(
  page: Page,
  backup: unknown,
  mode: "merge" | "replace",
): Promise<void> {
  await page.goto("/settings");
  await dismissOverlays(page);

  await page.getByRole("button", { name: /Data & Privacy/i }).click();

  // The file input is hidden inside a <label>; setInputFiles works on it anyway.
  await page.locator('input[type="file"]').setInputFiles({
    name: "anima-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });

  // The staged-restore dialog appears once the file parses.
  await expect(
    page.getByRole("heading", { name: /Restore Backup/i }),
  ).toBeVisible({ timeout: 10_000 });

  if (mode === "merge") {
    await page.getByRole("button", { name: /Merge Into Current Data/i }).click();
    await expect(page.getByText(/Merged in \d+ record/i)).toBeVisible({
      timeout: 20_000,
    });
  } else {
    // First "Replace Everything" advances to the confirm step; the second
    // (in the confirm step) actually performs the destructive restore.
    await page.getByRole("button", { name: /^Replace Everything$/ }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /^Replace Everything$/ }).click();
    await expect(page.getByText(/Replaced everything with \d+ record/i)).toBeVisible(
      { timeout: 20_000 },
    );
  }
}

test("merge restore brings back a backup's chat conversation without wiping existing data", async ({
  browser,
}) => {
  const context = await newReadyContext(browser);
  const page = await context.newPage();
  try {
    const b = makeBackup("merge");
    await signIn(page, userMerge);

    // Wait until the account is actually NON-empty (its seeded starter is
    // present) so this genuinely exercises restore-into-non-empty.
    await openCharactersAndWaitFor(page, STARTER_CHARACTER);

    await restoreViaSettings(page, b.backup, "merge");

    // The restored conversation comes back: opening the session by its preserved
    // id renders both sides of the legacy inline-blob chat.
    await openSessionAndWaitFor(page, b.sessionId, b.assistantMessage);
    await expect(page.getByText(b.userMessage, { exact: false })).toBeVisible();

    // It is real server state, not a transient artifact of the restore call.
    await page.reload();
    await dismissOverlays(page);
    await expect(page.getByText(b.assistantMessage, { exact: false })).toBeVisible(
      { timeout: 20_000 },
    );

    // Merge keeps records the backup never mentioned: the seeded starter and the
    // restored backup character both exist.
    await openCharactersAndWaitFor(page, b.charName);
    await expect(characterHeading(page, STARTER_CHARACTER)).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("replace restore wipes existing data then brings back the backup's chat conversation", async ({
  browser,
}) => {
  const context = await newReadyContext(browser);
  const page = await context.newPage();
  try {
    const b = makeBackup("replace");
    await signIn(page, userReplace);

    // Confirm the account is non-empty (seeded starter present) before wiping.
    await openCharactersAndWaitFor(page, STARTER_CHARACTER);

    await restoreViaSettings(page, b.backup, "replace");

    // The restored conversation comes back after the wipe+insert.
    await openSessionAndWaitFor(page, b.sessionId, b.assistantMessage);
    await expect(page.getByText(b.userMessage, { exact: false })).toBeVisible();

    // It survives a reload — committed server state, not in-memory.
    await page.reload();
    await dismissOverlays(page);
    await expect(page.getByText(b.assistantMessage, { exact: false })).toBeVisible(
      { timeout: 20_000 },
    );

    // Replace truly wiped first: the restored character is present, but the
    // pre-restore seeded starter is gone.
    await openCharactersAndWaitFor(page, b.charName);
    await expect(characterHeading(page, STARTER_CHARACTER)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
