import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { createTestUser, deleteTestUser, type TestUser } from "./clerk-backend";

// Task #91 added a toast that appears when a returning user's first-sign-in
// migration of their pre-sync local data fails to confirm. The outcome logic is
// unit-tested (src/lib/syncBootstrap.test.js); this spec verifies the actual
// user-visible behavior in the running app: the notice shows on failure, stays
// hidden on the success / nothing-to-migrate paths, and "Retry" reloads.

// The one-time local->server migration flag (see src/lib/syncBootstrap.js). For
// the negative tests it doubles as a deterministic "bootstrap finished" signal:
// both the "migrated" and "skipped" paths set it to "1".
const MIGRATION_KEY = "anima_server_migration_v1";

// The exact endpoint bulkImport() posts to (base44Client storeFetch -> /import).
// Intercepting it lets us force each migration outcome regardless of server
// state, so the test never depends on whether the throwaway account is empty.
const IMPORT_ROUTE = "**/api/store/import";

// The substring shown in the failed-sync toast (App.full.jsx bootstrap effect).
const NOTICE_RE = /your saved data hasn't synced to your account yet/i;

const rand = Math.random().toString(36).slice(2, 8);
// A character that exists ONLY in this browser's pre-sync localStorage, so the
// migration has real data to attempt to lift (otherwise it short-circuits to
// "skipped" and never tries the import we want to fail).
const localCharacter = {
  id: `local-char-${rand}`,
  name: `LegacyLocal ${rand}`,
  universe: "Pre-Sync Local Saga",
  category: "warrior",
  status: "online",
  avatar_url: "",
  personality: "Saved in the browser before sync existed.",
  backstory: "Stored locally long before this account ever signed in.",
  speaking_style: "Plain.",
};

let userFailed: TestUser;
let userMigrated: TestUser;
let userNotEmpty: TestUser;
let userSkipped: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Re-run clerkSetup inside the worker so this process's env
  // (CLERK_FAPI / CLERK_TESTING_TOKEN) is populated for setupClerkTestingToken.
  await clerkSetup();
  userFailed = await createTestUser("sync-fail");
  userMigrated = await createTestUser("sync-ok");
  userNotEmpty = await createTestUser("sync-nonempty");
  userSkipped = await createTestUser("sync-skip");
});

test.afterAll(async () => {
  await deleteTestUser(userFailed?.id);
  await deleteTestUser(userMigrated?.id);
  await deleteTestUser(userNotEmpty?.id);
  await deleteTestUser(userSkipped?.id);
});

// Hide the Replit dev banner and pre-accept the AI disclaimer. NB: never touch
// document.documentElement during the init script (before the HTML parser runs)
// — it corrupts the parsed document and yields an empty page. Defer to
// DOMContentLoaded.
function baseInit(p: Page): Promise<void> {
  return p.addInitScript(() => {
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
}

// Seed the pre-sync local character BEFORE any app/Clerk code runs, but only
// while the migration flag is unset — once it's set the data has already been
// (correctly) consumed and must not be resurrected.
function seedLocalData(p: Page): Promise<void> {
  return p.addInitScript(
    ({ entityKey, migrationKey, character }) => {
      try {
        if (!localStorage.getItem(migrationKey)) {
          localStorage.setItem(entityKey, JSON.stringify([character]));
        }
      } catch {
        /* ignore storage errors */
      }
    },
    {
      entityKey: "anima_entity_Character",
      migrationKey: MIGRATION_KEY,
      character: localCharacter,
    },
  );
}

// The analytics consent banner is persisted via mixpanel (not localStorage),
// so it can reappear; dismiss it if present.
async function dismissOverlays(p: Page): Promise<void> {
  const consentAccept = p
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  // The banner is a bottom-fixed bar that shares space with the bottom tab bar,
  // so a positional click can be intercepted. Dispatch the click directly on the
  // button to fire its onClick regardless of overlap.
  if (await consentAccept.isVisible().catch(() => false)) {
    await consentAccept.dispatchEvent("click");
  }
}

async function signIn(p: Page, user: TestUser): Promise<void> {
  // Install the Clerk testing token BEFORE the first navigation so the initial
  // bot-protected Frontend API requests are tokenized.
  await setupClerkTestingToken({ page: p });
  await p.goto("/");
  await clerk.signIn({ page: p, emailAddress: user.email });
}

// Force every /import call to resolve with a fixed body, deterministically
// driving the migration outcome ("failed" when imported:false, "migrated" when
// imported:true) without depending on server account state.
async function stubImport(
  p: Page,
  body: Record<string, unknown>,
): Promise<void> {
  await p.route(IMPORT_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("shows the failed-sync notice when the first-sign-in import does not confirm", async ({
  browser,
}) => {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await baseInit(page);
  await seedLocalData(page);
  // An import that resolves WITHOUT confirming success -> outcome "failed".
  await stubImport(page, { imported: false });

  await signIn(page, userFailed);
  await dismissOverlays(page);

  // The user-visible notice appears (bootstrap + seeding run async after sign-in,
  // so allow generous headroom).
  await expect(page.getByText(NOTICE_RE)).toBeVisible({ timeout: 45_000 });

  // The failed migration was NOT marked done, so it will retry next load.
  const flag = await page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY);
  expect(flag).toBeNull();

  // Exercise the "Retry" action: it calls window.location.reload(). A sentinel
  // on window is wiped by the reload, proving the click reloaded the page.
  await page.evaluate(() => {
    (window as unknown as { __preRetry?: boolean }).__preRetry = true;
  });
  await page.getByRole("button", { name: /^Retry$/ }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __preRetry?: boolean }).__preRetry === true,
        ),
      { timeout: 30_000 },
    )
    .toBe(false);

  // After the reload the user is still signed in (session cookie persists) and
  // the still-stubbed import fails again, so the notice comes back — confirming
  // Retry genuinely re-runs the sync flow rather than dismissing it.
  await dismissOverlays(page);
  await expect(page.getByText(NOTICE_RE)).toBeVisible({ timeout: 45_000 });

  await context.close();
});

test("does NOT show the notice when the import confirms success (migrated)", async ({
  browser,
}) => {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await baseInit(page);
  await seedLocalData(page);
  // A confirmed import -> outcome "migrated" -> no notice.
  await stubImport(page, { imported: true, count: 1 });

  await signIn(page, userMigrated);
  await dismissOverlays(page);

  // A confirmed migration marks the one-time flag done — use that as the
  // "bootstrap finished" signal so we don't assert absence prematurely.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY), {
      timeout: 45_000,
    })
    .toBe("1");

  // Give the post-migration toast effect a moment to (not) fire, then assert the
  // notice never appeared.
  await page.waitForTimeout(2_000);
  await expect(page.getByText(NOTICE_RE)).toHaveCount(0);

  await context.close();
});

test("does NOT show the notice for a returning user whose account already has data", async ({
  browser,
}) => {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await baseInit(page);
  await seedLocalData(page);
  // The real-world regression: a returning user signs in on a fresh browser that
  // still has leftover pre-sync local data. The server refuses the one-time
  // import because the account already has data ({imported:false,
  // reason:"account_not_empty"}). That is NOT a failure — the data is already
  // safe on the account — so no notice should appear and the migration is marked
  // done (it must not retry/false-alarm on every load).
  await stubImport(page, { imported: false, reason: "account_not_empty" });

  await signIn(page, userNotEmpty);
  await dismissOverlays(page);

  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY), {
      timeout: 45_000,
    })
    .toBe("1");

  await page.waitForTimeout(2_000);
  await expect(page.getByText(NOTICE_RE)).toHaveCount(0);

  await context.close();
});

test("does NOT show the notice when there is nothing to migrate (skipped)", async ({
  browser,
}) => {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await baseInit(page);
  // No local data seeded -> migration short-circuits to "skipped". The import
  // endpoint should never be called; fail loudly if it is.
  let importCalled = false;
  await page.route(IMPORT_ROUTE, async (route) => {
    importCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ imported: true, count: 0 }),
    });
  });

  await signIn(page, userSkipped);
  await dismissOverlays(page);

  // "skipped" also sets the one-time flag, so wait for it as the bootstrap-done
  // signal.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY), {
      timeout: 45_000,
    })
    .toBe("1");

  await page.waitForTimeout(2_000);
  await expect(page.getByText(NOTICE_RE)).toHaveCount(0);
  expect(importCalled).toBe(false);

  await context.close();
});
