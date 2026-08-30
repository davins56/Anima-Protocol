import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_UI_TIMEOUT_MS,
  STORE_AUTH_WAIT_MS,
  STORE_FETCH_TIMEOUT_MS,
} from "./storeTimeouts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("store fail-fast budget", () => {
  it("caps store fetch, auth wait, and bootstrap UI at 8s", () => {
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
    expect(STORE_AUTH_WAIT_MS).toBe(8000);
    expect(BOOTSTRAP_UI_TIMEOUT_MS).toBe(8000);
  });

  it("wires the budget into the store client and bootstrap waits", () => {
    const client = readFileSync(join(srcRoot, "api/base44Client.js"), "utf8");
    const auth = readFileSync(join(srcRoot, "api/authBridge.js"), "utf8");
    const bootstrap = readFileSync(join(srcRoot, "lib/syncBootstrap.js"), "utf8");
    const state = readFileSync(join(srcRoot, "lib/bootstrapState.js"), "utf8");

    expect(client).toContain("STORE_FETCH_TIMEOUT_MS");
    expect(client).toContain("AbortSignal.timeout");
    expect(auth).toContain("STORE_AUTH_WAIT_MS");
    expect(bootstrap).toContain("BOOTSTRAP_UI_TIMEOUT_MS");
    expect(state).toContain("BOOTSTRAP_UI_TIMEOUT_MS");
  });
});
