import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type Browser,
} from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { createTestUser, deleteTestUser, type TestUser } from "./clerk-backend";

// The one-time local->server migration flag (see src/lib/syncBootstrap.js).
// It is GLOBAL to the browser, not per-account. The returning-user merge prompt
// only appears while it is UNSET and the account is already non-empty.
const MIGRATION_KEY = "anima_server_migration_v1";

// The localStorage key the migration reads pre-sync entity data from.
const CHARACTER_ENTITY_KEY = "anima_entity_Character";

// A starter every BRAND-NEW (empty) account is seeded with. We use a first
// sign-in (no local data) to make each account non-empty — that "returning user
// with existing data" state is the precondition for the merge prompt (the
// one-time import deliberately refuses non-empty accounts).
const STARTER_CHARACTER = "Korra";

let userAccept: TestUser;
let userDecline: TestUser;

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The analytics consent banner is persisted via mixpanel (not localStorage),
// so it can reappear; dismiss it if present. dispatchEvent fires the React
// onClick directly, immune to the BottomTabBar overlapping its bottom strip.
async function dismissOverlays(p: Page): Promise<void> {
  const consentAccept = p
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  if (await consentAccept.isVisible().catch(() => false)) {
    await consentAccept.dispatchEvent("click");
  }
}

function characterHeading(p: Page, name: string) {
  return p.getByRole("heading", { name, exact: true });
}

// The returning-user merge prompt toast (App.full.jsx, outcome
// "local_data_available"): its title and the two action buttons.
function mergePromptTitle(p: Page) {
  return p.getByText("We found data saved on this device.", { exact: false });
}
function addToAccountButton(p: Page) {
  return p.getByRole("button", { name: "Add to my account" });
}
function notNowButton(p: Page) {
  return p.getByRole("button", { name: "Not now" });
}

async function signIn(p: Page, user: TestUser): Promise<void> {
  // Install the Clerk testing token BEFORE the first navigation so the initial
  // bot-protected Frontend API requests are tokenized (otherwise Clerk never
  // finishes loading and clerk.signIn's "loaded" wait times out).
  await setupClerkTestingToken({ page: p });
  await p.goto("/");
  await clerk.signIn({ page: p, emailAddress: user.email });
}

// Open /characters and wait for the named character to render. Bootstrap runs
// asynchronously and the page's cross-device poller suppresses its self-writes,
// so re-navigate to force a fresh server fetch — each attempt waiting long
// enough for the lazy route chunk AND heading to appear (counting right after
// goto would just see the Suspense "Loading..." fallback).
async function openCharactersAndWaitFor(
  p: Page,
  name: string,
  attempts = 4,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    await p.goto("/characters");
    await dismissOverlays(p);
    try {
      await expect(characterHeading(p, name)).toBeVisible({ timeout: 20_000 });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// A fresh context with the disclaimer pre-accepted and the dev banner hidden,
// but NO pre-sync local data yet (so the first sign-in primes the account to be
// non-empty WITHOUT triggering an import). The leftover local data is injected
// later, after priming, via stageLeftoverLocalData.
async function newCleanContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ai_disclaimer_accepted", "true");
    } catch {
      /* ignore */
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
  });
  const page = await context.newPage();
  return { context, page };
}

// Sign in on a fresh account so seeding makes it non-empty (the returning-user
// precondition). With no local data, the one-time migration is a no-op that
// sets the flag, then seeding adds the starter roster.
async function primeAccount(p: Page, user: TestUser): Promise<void> {
  await signIn(p, user);
  await p.goto("/characters");
  await dismissOverlays(p);
  await expect
    .poll(() => p.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY), {
      timeout: 45_000,
    })
    .toBe("1");
  await openCharactersAndWaitFor(p, STARTER_CHARACTER);
}

// Now that the account is non-empty, plant the browser's leftover pre-sync local
// data (a unique custom character that is never auto-seeded, so it can only
// reach the account via the merge) and CLEAR the one-time flag so the next page
// load re-runs the migration — which now hits a non-empty account and surfaces
// the "local_data_available" merge prompt.
async function stageLeftoverLocalData(
  p: Page,
  localCharacter: string,
  localCharacterId: string,
): Promise<void> {
  await p.evaluate(
    ({ flagKey, entityKey, character }) => {
      localStorage.removeItem(flagKey);
      localStorage.setItem(entityKey, JSON.stringify([character]));
    },
    {
      flagKey: MIGRATION_KEY,
      entityKey: CHARACTER_ENTITY_KEY,
      character: {
        id: localCharacterId,
        name: localCharacter,
        universe: "Pre-Sync Local Saga",
        category: "warrior",
        status: "online",
        avatar_url: "",
        personality: "A character saved on this device before sync existed.",
        backstory: "Stored locally long before this account ever signed in.",
        speaking_style: "Plain.",
      },
    },
  );
  // Reload so bootstrap re-runs with the flag unset and the local data present.
  await p.reload();
  await dismissOverlays(p);
}

// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  // Re-run clerkSetup inside the worker process so this process's env
  // (CLERK_FAPI / CLERK_TESTING_TOKEN) is populated for setupClerkTestingToken.
  await clerkSetup();
  userAccept = await createTestUser("merge-accept");
  userDecline = await createTestUser("merge-decline");
});

test.afterAll(async () => {
  await deleteTestUser(userAccept?.id);
  await deleteTestUser(userDecline?.id);
});

test("accepting the prompt merges this device's data onto the account", async ({
  browser,
}) => {
  const rand = Math.random().toString(36).slice(2, 8);
  const localCharacter = `DeviceLocal Accept ${rand}`;
  const localCharacterId = `device-accept-${rand}`;
  const { context, page } = await newCleanContext(browser);

  try {
    await primeAccount(page, userAccept);
    await stageLeftoverLocalData(page, localCharacter, localCharacterId);

    // The returning-user merge prompt appears (account already non-empty, so the
    // one-time import couldn't bring this device's leftover local data over).
    await expect(mergePromptTitle(page)).toBeVisible({ timeout: 45_000 });

    // Accept it — this routes the stashed local data through a non-destructive
    // MERGE restore and confirms with a success toast.
    await addToAccountButton(page).click();
    await expect(
      page.getByText("Your device's data was added to your account.", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 30_000 });

    // The migration flag is set again — we stop offering the merge.
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY))
      .toBe("1");

    // The device's character now lives on the account (a fresh navigation
    // re-fetches it from the server)...
    await openCharactersAndWaitFor(page, localCharacter);
    // ...and the account's pre-existing starter was NOT clobbered by the merge.
    await expect(characterHeading(page, STARTER_CHARACTER)).toHaveCount(1);

    // The merge survives a full reload (it is account state on the server) and
    // does NOT re-prompt (the flag is set, so the migration is skipped).
    await page.goto("/");
    await dismissOverlays(page);
    await expect(mergePromptTitle(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("declining the prompt leaves the account unchanged and stops re-prompting", async ({
  browser,
}) => {
  const rand = Math.random().toString(36).slice(2, 8);
  const localCharacter = `DeviceLocal Decline ${rand}`;
  const localCharacterId = `device-decline-${rand}`;
  const { context, page } = await newCleanContext(browser);

  try {
    await primeAccount(page, userDecline);
    await stageLeftoverLocalData(page, localCharacter, localCharacterId);

    await expect(mergePromptTitle(page)).toBeVisible({ timeout: 45_000 });

    // Decline it — the local data is dropped and the account is left untouched.
    await notNowButton(page).click();

    // The migration flag is set again, so we stop asking on every load.
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), MIGRATION_KEY))
      .toBe("1");

    // The device's character was NOT added to the account — a fresh fetch shows
    // only the account's pre-existing starter, never the declined local char.
    await openCharactersAndWaitFor(page, STARTER_CHARACTER);
    await expect(characterHeading(page, localCharacter)).toHaveCount(0);

    // Reloading does NOT re-surface the prompt (migration is now skipped).
    await page.goto("/");
    await dismissOverlays(page);
    await expect(mergePromptTitle(page)).toHaveCount(0);
    await expect(characterHeading(page, localCharacter)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
