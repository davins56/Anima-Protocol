import { expect, test, type Page } from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { createTestUser, deleteTestUser, type TestUser } from "./clerk-backend";

type ChatRequest = {
  content?: string;
  mode?: string;
  assistant_character_id?: string | null;
  assistant_character_name?: string | null;
  metadata?: {
    therapy_mode?: boolean;
    adult_mode?: boolean;
  };
  region?: Record<string, unknown>;
  turn_id?: string;
};

type MockState = {
  requests: ChatRequest[];
  commitCount: number;
  retryCount: number;
  failedPersistence: boolean;
};

let user: TestUser;
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await clerkSetup();
  user = await createTestUser("chat-lifecycle");
});

test.afterAll(async () => {
  await deleteTestUser(user?.id);
});

function installBaseInit(page: Page): Promise<void> {
  return page.addInitScript(() => {
    try {
      localStorage.setItem("ai_disclaimer_accepted", "true");
    } catch {
      // Ignore storage restrictions in hardened browser contexts.
    }
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "#replit-dev-banner{display:none!important;pointer-events:none!important;}";
      document.head.appendChild(style);
    });
  });
}

/**
 * Playwright route.fulfill() buffers and closes response bodies, so it cannot
 * reproduce an SSE transport that stays open after `done`. Patch fetch inside
 * the real browser instead and return a genuine ReadableStream.
 */
function installChatTransport(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const encoder = new TextEncoder();
    const originalFetch = window.fetch.bind(window);
    const state = {
      requests: [],
      commitCount: 0,
      retryCount: 0,
      failedPersistence: false,
    };
    (
      window as typeof window & {
        __chatLifecycleMock?: typeof state;
      }
    ).__chatLifecycleMock = state;

    const responseFor = (content: string) => {
      if (content === "e2e-stream") {
        return ["First token", " completes response."];
      }
      if (content === "e2e-open-sse") {
        return ["Resolved before transport closed."];
      }
      if (content === "e2e-persist-failure") {
        return ["Visible despite persistence failure."];
      }
      if (content === "e2e-therapy-boundary") {
        return ["Therapy boundary held."];
      }
      if (content === "e2e-region-opt-out") {
        return ["Privacy boundary held."];
      }
      if (content.includes("e2e-group-speaker")) {
        return ["Group speaker selected."];
      }
      if (content === "e2e-refresh") {
        return ["Persisted after refresh."];
      }
      return ["Deterministic browser reply."];
    };

    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    window.fetch = async (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(requestUrl, window.location.origin);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.pathname === "/api/chat/messages" && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as ChatRequest;
        state.requests.push(body);
        const content = String(body.content || "");
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (content === "e2e-timeout") {
              window.setTimeout(() => {
                controller.enqueue(
                  sse({
                    error: "The companion took too long to reply. Please try again.",
                  }),
                );
                controller.close();
              }, 80);
              return;
            }

            const chunks = responseFor(content);
            window.setTimeout(() => {
              controller.enqueue(sse({ content: chunks[0] }));
            }, 80);
            window.setTimeout(() => {
              if (chunks[1]) controller.enqueue(sse({ content: chunks[1] }));
              controller.enqueue(
                sse({
                  done: true,
                  turn_id: body.turn_id,
                  persistence_status: "generated",
                  persistence_owner: "client",
                  assistant_character_id: body.assistant_character_id,
                  assistant_character_name: body.assistant_character_name,
                }),
              );
              // Deliberately leave this transport open. The UI must resolve on
              // the terminal event, not on the HTTP connection closing.
              if (content !== "e2e-open-sse") controller.close();
            }, chunks[1] ? 420 : 120);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (/^\/api\/chat\/turns\/[^/]+\/commit$/.test(url.pathname)) {
        state.commitCount += 1;
        return new Response(
          JSON.stringify({ persistence_status: "committed" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (/^\/api\/chat\/turns\/[^/]+\/retry$/.test(url.pathname)) {
        state.retryCount += 1;
        return new Response(
          JSON.stringify({ persistence_status: "committed" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.pathname === "/api/store/messages" && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as {
          message?: { content?: string };
        };
        if (
          body.message?.content === "e2e-persist-failure" &&
          !state.failedPersistence
        ) {
          state.failedPersistence = true;
          return new Response(JSON.stringify({ error: "forced persistence failure" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return originalFetch(input, init);
    };
  });
}

async function dismissConsent(page: Page): Promise<void> {
  const accept = page
    .getByRole("dialog", { name: /Analytics consent/i })
    .getByRole("button", { name: /^Accept$/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.dispatchEvent("click");
  }
}

async function browserApi<T>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  return page.evaluate(
    async ({ apiPath, requestInit }) => {
      const clerkGlobal = (
        window as typeof window & {
          Clerk?: { session?: { getToken?: () => Promise<string | null> } };
        }
      ).Clerk;
      const token = await clerkGlobal?.session?.getToken?.();
      const response = await fetch(apiPath, {
        method: requestInit.method || "GET",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(requestInit.body === undefined
          ? {}
          : { body: JSON.stringify(requestInit.body) }),
      });
      if (!response.ok) {
        throw new Error(
          `${requestInit.method || "GET"} ${apiPath} failed: ${response.status} ${await response.text()}`,
        );
      }
      return response.json();
    },
    { apiPath: path, requestInit: init },
  ) as Promise<T>;
}

async function signIn(page: Page): Promise<void> {
  await installBaseInit(page);
  await installChatTransport(page);
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await browserApi(page, "/api/store/profile", {
    method: "PUT",
    body: {
      full_name: "Chat Lifecycle E2E",
      selected_mode: "serenity",
      settings: {
        adult_content_enabled: true,
        user_profile: {
          share_region: false,
          city: "Never Transmit City",
          country: "Never Transmit Country",
          timezone: "Antarctica/Troll",
          locale: "xx-PRIVATE",
        },
      },
    },
  });
  await page.reload();
  await dismissConsent(page);
}

async function seedCharacters(
  page: Page,
  characters: Array<Record<string, unknown>>,
): Promise<void> {
  await browserApi(page, "/api/store/Character/bulk-upsert", {
    method: "POST",
    body: { items: characters },
  });
}

async function createSession(
  page: Page,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return browserApi(page, "/api/store/ChatSession", {
    method: "POST",
    body: {
      title: `Lifecycle ${suffix}`,
      messages: [],
      ...data,
    },
  });
}

async function openSession(
  page: Page,
  data: Record<string, unknown> = {},
): Promise<{ session: Record<string, unknown>; characterId: string }> {
  const characterId = `e2e-char-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
  await seedCharacters(page, [
    {
      id: characterId,
      name: "Aria E2E",
      universe: "Protocol Tests",
      personality: "Warm, concise, and deterministic.",
      speaking_style: "Short direct sentences.",
    },
  ]);
  const session = await createSession(page, {
    mode: "solo",
    character_id: characterId,
    ...data,
  });
  await page.goto(`/chat/${String(session.id)}`);
  await dismissConsent(page);
  await expect(page.getByPlaceholder(/Message\.\.\./i)).toBeVisible({
    timeout: 45_000,
  });
  return { session, characterId };
}

async function send(page: Page, content: string): Promise<void> {
  const input = page.getByPlaceholder(/Message\.\.\./i);
  await input.fill(content);
  await input.press("Enter");
}

async function mockState(page: Page): Promise<MockState> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __chatLifecycleMock: MockState;
        }
      ).__chatLifecycleMock,
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("send message paints the first token and completes the response", async ({
  page,
}) => {
  await openSession(page);
  await send(page, "e2e-stream");

  await expect(page.getByText("First token", { exact: true })).toBeVisible();
  await expect(page.getByText("First token completes response.")).toBeVisible();
  await expect(page.getByText("Processing...")).toHaveCount(0);
});

test("an LLM stall resolves with a graceful timeout", async ({ page }) => {
  await openSession(page);
  await send(page, "e2e-timeout");

  await expect(
    page.getByText("The companion took too long to reply. Please try again."),
  ).toBeVisible();
  await expect(page.getByText("Processing...")).toHaveCount(0);
});

test("a terminal SSE event resolves while the transport remains open", async ({
  page,
}) => {
  await openSession(page);
  await send(page, "e2e-open-sse");

  await expect(page.getByText("Resolved before transport closed.")).toBeVisible();
  await expect(page.getByText("Processing...")).toHaveCount(0);
});

test("a persistence failure keeps the turn visible and requests retry", async ({
  page,
}) => {
  await openSession(page);
  await send(page, "e2e-persist-failure");

  await expect(page.getByText("e2e-persist-failure")).toBeVisible();
  await expect(page.getByText("Visible despite persistence failure.")).toBeVisible();
  await expect
    .poll(async () => (await mockState(page)).retryCount)
    .toBeGreaterThan(0);
});

test("therapy mode suppresses the adult overlay in the transmitted contract", async ({
  page,
}) => {
  await openSession(page, {
    therapy_mode: true,
    companion_mode: "therapy",
  });
  await send(page, "e2e-therapy-boundary");
  await expect(page.getByText("Therapy boundary held.")).toBeVisible();

  const request = (await mockState(page)).requests.at(-1);
  expect(request?.metadata).toMatchObject({
    therapy_mode: true,
    adult_mode: false,
  });
});

test("regional opt-out transmits no location fields", async ({ page }) => {
  await openSession(page);
  await send(page, "e2e-region-opt-out");
  await expect(page.getByText("Privacy boundary held.")).toBeVisible();

  const request = (await mockState(page)).requests.at(-1);
  expect(request?.region).toEqual({ share_region: false });
  expect(JSON.stringify(request)).not.toContain("Never Transmit");
  expect(JSON.stringify(request)).not.toContain("Antarctica/Troll");
});

test("group chat transmits the selected speaker identity", async ({ page }) => {
  const alphaId = `e2e-alpha-${suffix}`;
  const betaId = `e2e-beta-${suffix}`;
  await seedCharacters(page, [
    {
      id: alphaId,
      name: "Alpha E2E",
      universe: "One",
      personality: "Measured.",
    },
    {
      id: betaId,
      name: "Beta E2E",
      universe: "Two",
      personality: "Decisive.",
    },
  ]);
  const session = await createSession(page, {
    mode: "group",
    group_character_ids: [alphaId, betaId],
  });
  await page.goto(`/chat/${String(session.id)}`);
  await dismissConsent(page);
  await expect(page.getByPlaceholder(/Message\.\.\./i)).toBeVisible({
    timeout: 45_000,
  });

  await send(page, "@Beta E2E e2e-group-speaker");
  await expect(page.getByText("Group speaker selected.")).toBeVisible();

  const request = (await mockState(page)).requests.at(-1);
  expect(request?.assistant_character_id).toBe(betaId);
  expect(request?.assistant_character_name).toBe("Beta E2E");
});

test("refresh restores the completed turn from durable message rows", async ({
  page,
}) => {
  await openSession(page);
  await send(page, "e2e-refresh");
  await expect(page.getByText("Persisted after refresh.")).toBeVisible();
  await expect
    .poll(async () => (await mockState(page)).commitCount)
    .toBeGreaterThan(0);

  await page.reload();
  await dismissConsent(page);
  await expect(page.getByText("e2e-refresh")).toBeVisible();
  await expect(page.getByText("Persisted after refresh.")).toBeVisible();
});
