import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_ONLY_HEALTH_RETRY_MS,
  ensureLocalOnlyLlmChainProbed,
  isLocalOnlyLlmChain,
  resetLocalOnlyLlmChainForTests,
} from "./localOnlyLlm.js";

afterEach(() => {
  resetLocalOnlyLlmChainForTests();
  vi.restoreAllMocks();
  delete global.fetch;
});

describe("ensureLocalOnlyLlmChainProbed", () => {
  it("retries a non-OK health response after a short cache", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chain: ["workersai"] }),
      });
    global.fetch = fetchMock;

    expect(await ensureLocalOnlyLlmChainProbed()).toBe(true);
    expect(await ensureLocalOnlyLlmChainProbed()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += LOCAL_ONLY_HEALTH_RETRY_MS;
    expect(isLocalOnlyLlmChain()).toBe(true);
    expect(await ensureLocalOnlyLlmChainProbed()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await ensureLocalOnlyLlmChainProbed()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
