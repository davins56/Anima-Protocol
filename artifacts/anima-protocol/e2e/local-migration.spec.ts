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

// The one-time local->server migration flag (see src/lib/syncBootstrap.js).
// It is GLOBAL to the browser, not per-account: whichever account signs in
// first claims the local data, and it is never re-imported afterwards.
const MIGRATION_KEY = "anima_server_migration_v1";

// A starter every BRAND-NEW (empty) account is seeded with — but a returning
// account that already had data is deliberately NOT given the starter roster
// (seeding skips any non-empty account). So Korra is the signal for "this was
// a fresh account that got seeded".
const STARTER_CHARACTER = "Korra";

// A character that exists ONLY in this browser's pre-sync localStorage. It is
// never seeded, so its presence on the server proves the migration ran, and
// its absence for a second account proves the migration runs exactly once.
const localCharacter = `LegacyLocal ${Math.random().toString(36).slice(2, 8)}`;

let userA: TestUser;
let userB: TestUser;
// ONE shared context for both accounts. The migration flag and the legacy
// local data live in this context's localStorage, so signing a SECOND account
// into the SAME context is what actually exercises the "migrate exactly once
// per browser" guarantee — separate contexts each start with clean storage and
// could never catch a re-import.
let context: BrowserContext;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Re-run clerkSetup inside the worker process so this process's env
  // (CLERK_FAPI / CLERK_TESTING_TOKEN) is populated for setupClerkTestingToken.
  await clerkSetup();
  userA = await createTestUser("mig-a");
  userB = await createTestUser("mig-b");

  context = await browser.newContext();
  await context.addInitScript(
    ({ entityKey, migrationKey, character }) => {
      try {
        localStorage.setItem("ai_disclaimer_accepted", "true");
        // Seed the pre-sync local data BEFORE any app/Clerk code runs, but only
        // while the migration hasn't completed — once the flag is set the data
        // has already been (correctly) consumed, and we must not resurrect it.
        if (!localStorage.getItem(migrationKey)) {
          localStorage.setItem(entityKey, JSON.stringify([character]));
          // The legacy local identity blob the migration reads its profile from.
          sessionStorage.setItem(
            "anima_auth_user",
            JSON.stringify({
              id: "legacy-id",
              email: "legacy@example.com",
              full_name: "Legacy User",
              selected_mode: "story",
            }),
          );
        }
      } catch {
        /* ignore storage errors */
      }
      // NB: inject the style on DOMContentLoaded — touching
      // document.documentElement during the init script (before the HTML parser
      // runs) corrupts the parsed document and yields an empty page.
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          "#replit-dev-banner{display:none!important;pointer-events:none!important;}";
        document.head.appendChild(style);
      });
    },
    {
      entityKey: "anima_entity_Character",
      migrationKey: MIGRATION_KEY,
      character: {
        id: `local-${Math.random().toString(36).slice(2, 10)}`,
        name: localCharacter,
        universe: "Pre-Sync Local Saga",
        category: "warrior",
        status: "online",
        avatar_url: "",
        personality: "A character saved in the browser before sync existed.",
        backstory: "Stored locally long before this account ever signed in.",
        speaking_style: "Plain.",
      },
    },
  );
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await deleteTestUser(userA?.id);
  await deleteTestUser(userB?.id);
});

// The analytics consent banner is persisted via mixpanel (not localStorage),
// so it can reappear; dismiss it if present.
async function dismissOverlays(p: Page): Promise<void> {
  const consentAccept = p
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  if (await consentAccept.isVisible().catch(() => false)) {
    await consentAccept.click();
  }
}

function characterHeading(p: Page, name: string) {
  return p.getByRole("heading", { name, exact: true });
}

async function signIn(user: TestUser): Promise<void> {
  // Install the Clerk testing token BEFORE the first navigation so the initial
  // bot-protected Frontend API requests are tokenized (otherwise Clerk never
  // finishes loading and clerk.signIn's "loaded" wait times out).
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
}

// Open /characters and wait for the named character to render. Bootstrap
// (migration + seeding) runs asynchronously after sign-in, and the page's own
// cross-device poller suppresses its self-writes (so it won't auto-refresh
// promptly). We therefore re-navigate to force a fresh server fetch, but each
// attempt waits long enough for the lazy route chunk to load AND the heading
// to appear before retrying — counting immediately after goto() would just see
// the Suspense "Loading..." fallback.
async function openCharactersAndWaitFor(
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

test("first sign-in lifts the browser's pre-sync local data into the account", async () => {
  await signIn(userA);
  await page.goto("/characters");
  await dismissOverlays(page);

  // The one-time migration completes (flag is set at the END of the import).
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY), {
      timeout: 45_000,
    })
    .toBe("1");

  // The pre-sync local character now lives server-side (a fresh navigation
  // re-fetches it from the server, proving it wasn't just a local cache).
  await openCharactersAndWaitFor(localCharacter);

  // A returning user with existing data must NOT get the starter roster dumped
  // on top — seeding skips any account that already has characters.
  await expect(characterHeading(page, STARTER_CHARACTER)).toHaveCount(0);
});

test("a second account in the same browser does NOT re-import the first account's local data", async () => {
  // Sign account A out and account B in — same context, so the migration flag
  // and the legacy local data are still present in localStorage.
  await page.goto("/");
  await clerk.signOut({ page });
  await signIn(userB);

  // B is a brand-new empty account, so it DOES get its own starter roster...
  await openCharactersAndWaitFor(STARTER_CHARACTER);

  // ...but it must NOT inherit account A's migrated local character.
  await expect(characterHeading(page, localCharacter)).toHaveCount(0);

  // The one-time flag is unchanged — the migration never ran a second time.
  const flag = await page.evaluate(
    (k) => localStorage.getItem(k),
    MIGRATION_KEY,
  );
  expect(flag).toBe("1");
});
