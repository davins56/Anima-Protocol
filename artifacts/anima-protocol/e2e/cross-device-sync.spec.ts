import { test, expect, type Page } from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { createTestUser, deleteTestUser, type TestUser } from "./clerk-backend";

// A character every new account is seeded with (see src/lib/seedCharacters.js).
// Rendered in an <h3>; CSS-uppercased but the accessible name keeps original
// case, and getByRole name matching is case-insensitive.
const STARTER_CHARACTER = "Korra";

let userA: TestUser;
let userB: TestUser;
// Unique so it can never collide with a seeded starter name.
const customCharacter = `ZephyrE2E ${Math.random().toString(36).slice(2, 8)}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Re-run clerkSetup inside the worker process: it populates this process's
  // env (CLERK_FAPI / CLERK_TESTING_TOKEN), which setupClerkTestingToken needs
  // to tokenize Frontend API requests. The global-setup run happens in a
  // different process whose env workers may not inherit.
  await clerkSetup();
  userA = await createTestUser("a");
  userB = await createTestUser("b");
});

test.afterAll(async () => {
  await deleteTestUser(userA?.id);
  await deleteTestUser(userB?.id);
});

// A fresh context with overlays neutralized BEFORE app code runs:
//  - pre-accept the AI disclaimer (a z-999 modal that otherwise intercepts
//    clicks and renders async, so it can't be reliably dismissed after load);
//  - hide the Replit dev banner (dev-only overlay that intercepts pointer
//    events; absent in CI/production).
async function newAppContext(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ai_disclaimer_accepted", "true");
    } catch {
      /* ignore */
    }
    // NB: inject the style on DOMContentLoaded — touching document.documentElement
    // during the init script (before the HTML parser runs) corrupts the parsed
    // document and yields an empty page.
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "#replit-dev-banner{display:none!important;pointer-events:none!important;}";
      document.head.appendChild(style);
    });
  });
  return context;
}

// The analytics consent banner (bottom bar) is persisted via mixpanel, not
// localStorage, so it still appears on a fresh context. Dismiss it if present.
async function dismissOverlays(page: Page): Promise<void> {
  const consentAccept = page
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  if (await consentAccept.isVisible().catch(() => false)) {
    await consentAccept.click();
  }
}

async function signInAndOpenCharacters(
  page: Page,
  user: TestUser,
): Promise<void> {
  // Install the Clerk testing token BEFORE the first navigation so the initial
  // (bot-protected) Frontend API requests are tokenized — otherwise Clerk never
  // finishes loading and clerk.signIn's "loaded" wait times out.
  await setupClerkTestingToken({ page });
  // Must load a page that mounts Clerk before signing in.
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/characters");
  await dismissOverlays(page);
}

function characterHeading(page: Page, name: string) {
  return page.getByRole("heading", { name, exact: true });
}

test("account A: a custom character persists across reload", async ({
  browser,
}) => {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  try {
    await signInAndOpenCharacters(page, userA);

    // Per-account seeding is async after first sign-in; wait for a starter.
    await expect(characterHeading(page, STARTER_CHARACTER)).toBeVisible({
      timeout: 45_000,
    });

    // Create a custom character.
    await page.getByRole("button", { name: /New Character/i }).first().click();
    await expect(page.getByText("// New Character")).toBeVisible();
    await page.getByPlaceholder("e.g. Serenity").fill(customCharacter);
    await page.getByRole("button", { name: /^Create$/i }).click();

    // It should appear in the roster...
    await expect(characterHeading(page, customCharacter)).toBeVisible();

    // ...and survive a full reload (i.e. it was persisted server-side).
    await page.reload();
    await dismissOverlays(page);
    await expect(characterHeading(page, customCharacter)).toBeVisible({
      timeout: 45_000,
    });
    // Starters still present too.
    await expect(characterHeading(page, STARTER_CHARACTER)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("account B: sees its own seeded roster but NONE of account A's data", async ({
  browser,
}) => {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  try {
    await signInAndOpenCharacters(page, userB);

    // B gets its own freshly-seeded starter roster.
    await expect(characterHeading(page, STARTER_CHARACTER)).toBeVisible({
      timeout: 45_000,
    });

    // Critical isolation check: A's custom character must NOT leak to B.
    await expect(characterHeading(page, customCharacter)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
