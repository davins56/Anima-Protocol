import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_UI_TIMEOUT_MS,
  STORE_AUTH_WAIT_MS,
  STORE_FETCH_TIMEOUT_MS,
  STORE_LIST_RETRY_LIMIT,
  STORE_LIST_TIMEOUT_MS,
  STORE_SESSION_CREATE_RETRY_LIMIT,
  STORE_SESSION_CREATE_TIMEOUT_MS,
  STORE_TOKEN_TIMEOUT_MS,
  STORE_TOPIC_CREATE_RETRY_LIMIT,
  STORE_TOPIC_CREATE_TIMEOUT_MS,
  STORE_COMPANION_CREATE_RETRY_LIMIT,
  STORE_COMPANION_CREATE_TIMEOUT_MS,
  withStoreTimeout,
} from "./storeTimeouts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("store fail-fast budget", () => {
  it("caps store fetch, auth wait, and bootstrap UI at 8s", () => {
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
    expect(STORE_AUTH_WAIT_MS).toBe(8000);
    expect(BOOTSTRAP_UI_TIMEOUT_MS).toBe(8000);
    expect(STORE_TOKEN_TIMEOUT_MS).toBe(4000);
    expect(STORE_TOKEN_TIMEOUT_MS).toBeLessThan(STORE_FETCH_TIMEOUT_MS);
  });

  it("wires the budget into the store client and bootstrap waits", () => {
    const client = readFileSync(join(srcRoot, "api/base44Client.js"), "utf8");
    const auth = readFileSync(join(srcRoot, "api/authBridge.js"), "utf8");
    const bootstrap = readFileSync(join(srcRoot, "lib/syncBootstrap.js"), "utf8");
    const state = readFileSync(join(srcRoot, "lib/bootstrapState.js"), "utf8");

    const topicCreate = readFileSync(join(srcRoot, "lib/createTherapyTopic.js"), "utf8");
    const companionCreate = readFileSync(join(srcRoot, "lib/createCompanion.js"), "utf8");
    const therapyPage = readFileSync(join(srcRoot, "pages/Therapy.jsx"), "utf8");
    const generator = readFileSync(join(srcRoot, "pages/CompanionGenerator.jsx"), "utf8");

    expect(client).toContain("STORE_FETCH_TIMEOUT_MS");
    expect(client).toContain("STORE_SESSION_CREATE_TIMEOUT_MS");
    expect(client).toContain("STORE_COMPANION_CREATE_TIMEOUT_MS");
    expect(client).toContain("STORE_LIST_TIMEOUT_MS");
    expect(client).toMatch(
      /export \{[\s\S]*STORE_LIST_RETRY_LIMIT[\s\S]*STORE_SESSION_CREATE_TIMEOUT_MS/,
    );
    expect(client).toContain("timeoutMs: opts.timeoutMs");
    expect(client).toContain("AbortSignal.timeout");
    expect(client).toContain("createStoreAbortSignal");
    expect(client).toContain("isRetryableStoreReset");
    expect(client).toContain("retryOnTimeout: true");
    expect(client).toContain("STORE_LIST_RETRY_LIMIT");
    expect(client).toContain("waitForAuth: false");
    expect(client).toMatch(/Auth wait is NOT covered by AbortSignal\.timeout/);
    expect(topicCreate).toContain("STORE_TOPIC_CREATE_TIMEOUT_MS");
    expect(companionCreate).toContain("STORE_COMPANION_CREATE_TIMEOUT_MS");
    expect(therapyPage).toContain("createTherapyTopic(");
    expect(generator).toContain("createCompanionRecord(");
    expect(auth).toContain("STORE_AUTH_WAIT_MS");
    expect(auth).toContain("STORE_TOKEN_TIMEOUT_MS");
    expect(auth).toContain("withStoreTimeout");
    expect(bootstrap).toContain("BOOTSTRAP_UI_TIMEOUT_MS");
    expect(state).toContain("BOOTSTRAP_UI_TIMEOUT_MS");

    const meditation = readFileSync(join(srcRoot, "pages/Meditation.jsx"), "utf8");
    expect(meditation).toContain("BOOTSTRAP_UI_TIMEOUT_MS");
    expect(meditation).toContain("withStoreTimeout");
    expect(meditation).toContain("loadAffirmations");
    expect(meditation).toContain("seedDefaultAffirmations");
    expect(meditation).not.toContain("loadAndSeedAffirmations");
  });

  it("rejects a hung promise at the wall-clock budget", async () => {
    await expect(
      withStoreTimeout(new Promise(() => {}), 20, "budget exceeded"),
    ).rejects.toMatchObject({ message: "budget exceeded", code: "timeout" });
  });

  it("documents a longer targeted budget for Init, TherapyTopic, and companion create", () => {
    expect(STORE_SESSION_CREATE_TIMEOUT_MS).toBe(20000);
    expect(STORE_SESSION_CREATE_RETRY_LIMIT).toBe(1);
    expect(STORE_TOPIC_CREATE_TIMEOUT_MS).toBe(STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(STORE_TOPIC_CREATE_RETRY_LIMIT).toBe(STORE_SESSION_CREATE_RETRY_LIMIT);
    expect(STORE_COMPANION_CREATE_TIMEOUT_MS).toBe(STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(STORE_COMPANION_CREATE_RETRY_LIMIT).toBe(STORE_SESSION_CREATE_RETRY_LIMIT);
    expect(STORE_SESSION_CREATE_TIMEOUT_MS).toBeGreaterThan(STORE_FETCH_TIMEOUT_MS);
  });

  it("keeps the global 8s fetch cap and a longer roster list budget", () => {
    expect(STORE_LIST_RETRY_LIMIT).toBe(1);
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
    expect(STORE_LIST_TIMEOUT_MS).toBe(20000);
    expect(STORE_LIST_TIMEOUT_MS).toBe(STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(STORE_SESSION_CREATE_TIMEOUT_MS).toBeGreaterThan(STORE_FETCH_TIMEOUT_MS);
  });
});
